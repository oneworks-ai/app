import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createLauncherWorkspaceInDirectory,
  listLauncherDirectories,
  openLauncherWorkspace,
  resolveLauncherWorkspaceInstanceIdentity
} from '#~/services/launcher/manager.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'

describe('launcher manager raw workspace path identity', () => {
  let statusServer: http.Server | undefined
  let tempHome = ''

  beforeEach(async () => {
    tempHome = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ow-launcher-raw-path-')))
    vi.stubEnv('HOME', tempHome)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', 'manager')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (statusServer != null) {
      await new Promise<void>((resolve, reject) => {
        statusServer!.close(error => error == null ? resolve() : reject(error))
      })
      statusServer = undefined
    }
    await rm(tempHome, { force: true, recursive: true })
  })

  const startWorkspaceStatusServer = async () => {
    statusServer = http.createServer((request, response) => {
      if (request.url === '/api/auth/status') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => statusServer!.listen(0, '127.0.0.1', resolve))
    const address = statusServer.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to start status server')
    return `http://127.0.0.1:${address.port}`
  }

  it('preserves raw parent identity through directory list and create', async () => {
    const parentDirectory = path.join(tempHome, ' parent directory ')
    await mkdir(path.join(parentDirectory, 'existing'), { recursive: true })

    const directoryList = await listLauncherDirectories(parentDirectory)
    expect(directoryList.currentDirectory).toBe(await realpath(parentDirectory))
    expect(directoryList.directories).toContainEqual({
      name: 'existing',
      path: await realpath(path.join(parentDirectory, 'existing'))
    })

    const workspaceFolder = await createLauncherWorkspaceInDirectory(parentDirectory, 'created')
    expect(workspaceFolder).toBe(await realpath(path.join(parentDirectory, 'created')))
  })

  it('opens the exact raw workspace identity through the manager service boundary', async () => {
    const workspaceFolder = path.join(tempHome, ' workspace ')
    await mkdir(workspaceFolder)
    const serverBaseUrl = await startWorkspaceStatusServer()
    const identity = resolveLauncherWorkspaceInstanceIdentity(workspaceFolder)
    const statePath = resolveProjectHomePath(
      workspaceFolder,
      createWorkspaceRuntimeEnv(workspaceFolder, process.env),
      '.local',
      'server',
      'instance.json'
    )
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(
      statePath,
      `${
        JSON.stringify(
          {
            ...identity,
            pid: process.pid,
            protocolVersion: 1,
            serverBaseUrl,
            startedAt: new Date().toISOString(),
            workspaceFolder
          },
          null,
          2
        )
      }\n`
    )

    await expect(openLauncherWorkspace(workspaceFolder)).resolves.toMatchObject({
      serverBaseUrl,
      workspaceFolder: await realpath(workspaceFolder)
    })
  })

  it('uses the exact whitespace-bearing Git top-level for implementation identity', async () => {
    const adjacentRepository = path.join(tempHome, 'implementation')
    const repository = path.join(tempHome, 'implementation ')
    const packageDir = path.join(repository, 'apps', 'server')
    await Promise.all([mkdir(adjacentRepository), mkdir(packageDir, { recursive: true })])
    await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'fixture-root' }))
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@fixture/server' }))
    execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' })
    execFileSync('git', ['add', '.'], { cwd: repository, stdio: 'ignore' })
    execFileSync(
      'git',
      ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-m', 'fixture'],
      { cwd: repository, stdio: 'ignore' }
    )
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', packageDir)

    const identity = resolveLauncherWorkspaceInstanceIdentity(path.join(tempHome, 'workspace'))

    expect(identity.repoRoot).toBe(await realpath(repository))
    expect(identity.repoRoot).not.toBe(await realpath(adjacentRepository))
    expect(identity.implementationId).toMatch(/^git-runtime:/u)
    expect(identity.sourceVersionId).toMatch(/^git:[a-f0-9]{40}:clean$/u)
  })

  it.runIf(process.platform !== 'win32')(
    'preserves a terminal carriage return in the Git implementation root',
    async () => {
      const adjacentRepository = path.join(tempHome, 'implementation')
      const repository = path.join(tempHome, 'implementation\r')
      const packageDir = path.join(repository, 'apps', 'server')
      await Promise.all([mkdir(adjacentRepository), mkdir(packageDir, { recursive: true })])
      await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'fixture-root' }))
      await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@fixture/server' }))
      execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' })
      execFileSync('git', ['add', '.'], { cwd: repository, stdio: 'ignore' })
      execFileSync(
        'git',
        ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-m', 'fixture'],
        { cwd: repository, stdio: 'ignore' }
      )
      vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', packageDir)

      const identity = resolveLauncherWorkspaceInstanceIdentity(path.join(tempHome, 'workspace'))

      expect(identity.repoRoot).toBe(await realpath(repository))
      expect(identity.repoRoot).not.toBe(await realpath(adjacentRepository))
      expect(identity.implementationId).toMatch(/^git-runtime:/u)
    }
  )
})
