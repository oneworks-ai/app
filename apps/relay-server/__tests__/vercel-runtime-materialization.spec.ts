import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { materializeVercelWorkspacePackage } from '../scripts/materialize-vercel-runtime.mjs'
import { prepareVercelOutput } from '../scripts/prepare-vercel-output.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true
      })
    )
  )
})

describe('vercel runtime workspace materialization', () => {
  it('materializes and copies the complete icon runtime closure without nested node_modules', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'oneworks-vercel-runtime-'))
    temporaryDirectories.push(fixtureRoot)
    const sourceDirectory = path.join(fixtureRoot, 'packages', 'icon')
    const shaderDirectory = path.join(fixtureRoot, 'dependencies', 'paper-shaders')
    const relayDirectory = path.join(fixtureRoot, 'apps', 'relay-server')
    const targetDirectory = path.join(relayDirectory, 'node_modules', '@oneworks', 'icon')
    const functionRoot = path.join(relayDirectory, '.vercel', 'output', 'functions', 'api', 'relay.func')
    const outputNodeModules = path.join(functionRoot, 'node_modules')

    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true })
    await mkdir(path.join(sourceDirectory, 'node_modules', '@paper-design'), { recursive: true })
    await mkdir(shaderDirectory, { recursive: true })
    await mkdir(path.dirname(targetDirectory), { recursive: true })
    await mkdir(functionRoot, { recursive: true })
    await writeFile(
      path.join(sourceDirectory, 'package.json'),
      '{"name":"@oneworks/icon","dependencies":{"@paper-design/shaders":"0.0.0"}}\n'
    )
    await writeFile(path.join(sourceDirectory, 'brand-profile.json'), '{"schemaVersion":1}\n')
    await writeFile(path.join(sourceDirectory, 'dist', 'brand-profile.js'), 'export const profile = 1\n')
    await writeFile(
      path.join(shaderDirectory, 'package.json'),
      '{"name":"@paper-design/shaders","main":"index.js"}\n'
    )
    await writeFile(path.join(shaderDirectory, 'index.js'), 'module.exports = {}\n')
    await writeFile(path.join(functionRoot, '.vc-config.json'), '{"filePathMap":{}}\n')
    await symlink(shaderDirectory, path.join(sourceDirectory, 'node_modules', '@paper-design', 'shaders'), 'dir')
    await symlink(sourceDirectory, targetDirectory, 'dir')

    await materializeVercelWorkspacePackage({
      packageName: '@oneworks/icon',
      relayDirectory,
      sourceDirectory
    })
    await prepareVercelOutput({
      packageRootOverrides: new Map([['@oneworks/icon', sourceDirectory]]),
      relayDirectory,
      runtimePackages: ['@oneworks/icon']
    })

    expect((await lstat(targetDirectory)).isSymbolicLink()).toBe(false)
    await expect(readFile(path.join(targetDirectory, 'dist', 'brand-profile.js'), 'utf8')).resolves
      .toBe('export const profile = 1\n')
    await expect(lstat(path.join(targetDirectory, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(sourceDirectory, 'brand-profile.json'), 'utf8')).resolves
      .toBe('{"schemaVersion":1}\n')
    expect((await lstat(path.join(sourceDirectory, 'node_modules', '@paper-design', 'shaders'))).isSymbolicLink())
      .toBe(true)
    await expect(readFile(path.join(outputNodeModules, '@oneworks', 'icon', 'brand-profile.json'), 'utf8'))
      .resolves.toBe('{"schemaVersion":1}\n')
    await expect(readFile(path.join(outputNodeModules, '@oneworks', 'icon', 'dist', 'brand-profile.js'), 'utf8'))
      .resolves.toBe('export const profile = 1\n')
    await expect(lstat(path.join(outputNodeModules, '@oneworks', 'icon', 'node_modules'))).rejects
      .toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(outputNodeModules, '@paper-design', 'shaders', 'index.js'), 'utf8'))
      .resolves.toBe('module.exports = {}\n')
  })
})
