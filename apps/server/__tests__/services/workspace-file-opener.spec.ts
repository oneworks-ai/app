/* eslint-disable import/first -- hoisted Vitest mocks must be declared before importing the service */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HttpError } from '#~/utils/http.js'

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: childProcessMocks.execFile,
  spawn: childProcessMocks.spawn
}))

import {
  getWorkspacePathActionCapabilities,
  revealWorkspacePathInFileManager
} from '#~/services/workspace/file-manager.js'
import { listWorkspaceFileOpeners, openWorkspaceFileInExternalOpener } from '#~/services/workspace/file-opener.js'
import { openWorkspaceInExternalOpener } from '#~/services/workspace/workspace-opener.js'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

const findExecFileCallback = (values: unknown[]): ExecFileCallback | undefined => (
  values.find((value): value is ExecFileCallback => typeof value === 'function')
)

describe('workspace file opener service', () => {
  let availableCommands: Map<string, string>
  let workspaceDir: string

  beforeEach(async () => {
    availableCommands = new Map()
    workspaceDir = await mkdtemp(join(tmpdir(), 'ow-workspace-opener-'))
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceDir)

    await mkdir(join(workspaceDir, 'src'), { recursive: true })
    await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export const value = 1\n')

    childProcessMocks.execFile.mockReset()
    childProcessMocks.spawn.mockReset()
    childProcessMocks.spawn.mockReturnValue({ unref: vi.fn() })
    childProcessMocks.execFile.mockImplementation(
      (command: string, args?: unknown, options?: unknown, callback?: unknown) => {
        const query = Array.isArray(args) ? String(args.at(-1)) : ''
        const done = findExecFileCallback([callback, options, args])
        if (done == null) {
          return
        }

        const resolvedCommand = availableCommands.get(query)
        if ((command === 'which' || command === 'where.exe') && resolvedCommand != null) {
          done(null, `${resolvedCommand}\n`, '')
          return
        }

        done(new Error('command not found'), '', '')
      }
    )
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(workspaceDir, { recursive: true, force: true })
  })

  it('detects supported workspace file openers from command lookup', async () => {
    availableCommands.set('code', '/usr/local/bin/code')

    const result = await listWorkspaceFileOpeners()
    expect(result.defaultOpener).toBe('vscode')
    expect(result.openers).toContainEqual(expect.objectContaining({
      available: true,
      id: 'vscode',
      source: 'path',
      title: 'Visual Studio Code'
    }))
  })

  it('opens a workspace file in the auto-detected app with line and column', async () => {
    availableCommands.set('code', '/usr/local/bin/code')

    await expect(
      openWorkspaceFileInExternalOpener('src/index.ts', { line: 12, column: 3, opener: 'auto' })
    ).resolves.toMatchObject({
      ok: true,
      opener: {
        id: 'vscode',
        source: 'path'
      },
      path: 'src/index.ts'
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/code',
      ['--reuse-window', workspaceDir, '--goto', `${join(workspaceDir, 'src', 'index.ts')}:12:3`],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
    )
  })

  it('opens with the requested app when it is available', async () => {
    availableCommands.set('cursor', '/usr/local/bin/cursor')

    await expect(
      openWorkspaceFileInExternalOpener('src/index.ts', { line: '7', opener: 'cursor' })
    ).resolves.toMatchObject({
      opener: {
        id: 'cursor',
        source: 'path'
      }
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/cursor',
      ['--reuse-window', workspaceDir, '--goto', `${join(workspaceDir, 'src', 'index.ts')}:7`],
      expect.objectContaining({ detached: true })
    )
  })

  it('opens the workspace folder in the requested app', async () => {
    availableCommands.set('code', '/usr/local/bin/code')

    await expect(openWorkspaceInExternalOpener({ opener: 'vscode' })).resolves.toMatchObject({
      ok: true,
      opener: {
        id: 'vscode',
        source: 'path'
      },
      path: ''
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/code',
      ['--reuse-window', workspaceDir],
      expect.objectContaining({ detached: true })
    )
  })

  it('opens the workspace folder in the platform file manager', async () => {
    availableCommands.set('xdg-open', '/usr/bin/xdg-open')

    await expect(openWorkspaceInExternalOpener({ opener: 'fileManager' })).resolves.toMatchObject({
      ok: true,
      opener: {
        available: true
      },
      path: ''
    })

    const expectedCommand = process.platform === 'darwin'
      ? { command: 'open', args: [workspaceDir] }
      : process.platform === 'win32'
      ? { command: 'explorer.exe', args: [workspaceDir] }
      : { command: 'xdg-open', args: [workspaceDir] }
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      expectedCommand.command,
      expectedCommand.args,
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
    )
  })

  it('reveals workspace paths in the platform file manager', async () => {
    availableCommands.set('xdg-open', '/usr/bin/xdg-open')

    await expect(getWorkspacePathActionCapabilities()).resolves.toMatchObject({
      fileManager: { available: true }
    })

    await expect(revealWorkspacePathInFileManager('src/index.ts')).resolves.toMatchObject({
      ok: true,
      path: 'src/index.ts'
    })

    const filePath = join(workspaceDir, 'src', 'index.ts')
    const expectedCommand = process.platform === 'darwin'
      ? { command: 'open', args: ['-R', filePath] }
      : process.platform === 'win32'
      ? { command: 'explorer.exe', args: [`/select,${filePath}`] }
      : { command: 'xdg-open', args: [join(workspaceDir, 'src')] }
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      expectedCommand.command,
      expectedCommand.args,
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
    )
  })

  it('rejects unsupported app choices', async () => {
    await expect(openWorkspaceFileInExternalOpener('src/index.ts', { opener: 'unknown' })).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_file_opener_unsupported'
      } satisfies Partial<HttpError>
    )
  })
})
