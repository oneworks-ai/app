import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveConfiguredPluginInstances, resolvePluginConfigEntryPathForInstance } from '#~/plugin-resolver.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const writeRuntimePlugin = async (pluginRoot: string, name: string) => {
  await mkdir(join(pluginRoot, 'dist'), { recursive: true })
  await writeFile(
    join(pluginRoot, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', exports: { '.': './dist/index.js' } })
  )
  await writeFile(join(pluginRoot, 'dist/index.js'), 'module.exports = { __oneWorksPluginManifest: true }\n')
}

describe('plugin resolver filesystem identity', () => {
  it('preserves a directory-shaped plugin id and every manifest filesystem field', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-plugin-path-'))
    tempDirs.push(root)
    const exactRoot = join(root, 'plugin ')
    const adjacentRoot = join(root, 'plugin')
    await mkdir(join(exactRoot, 'runtime'), { recursive: true })
    await mkdir(adjacentRoot)
    await writeFile(join(adjacentRoot, 'plugin.json'), JSON.stringify({ name: 'adjacent' }))
    await writeFile(join(exactRoot, 'runtime/config.js '), 'module.exports = () => ({ exact: true })\n')
    await writeFile(
      join(exactRoot, 'plugin.json'),
      JSON.stringify({
        __oneWorksPluginManifest: true,
        configHook: { entry: './runtime/config.js ' },
        icon: './assets/icon.svg ',
        name: 'exact',
        plugin: {
          client: {
            devEntry: './client/dev.tsx ',
            entry: './client/index.js ',
            root: './client ',
            sourceRoot: './src '
          },
          server: { entry: './server/index.js ', roles: ['workspace'] }
        }
      })
    )

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: root,
      plugins: [{ id: './plugin ' }]
    })

    expect(instance?.rootDir).toBe(exactRoot)
    expect(instance?.manifest).toMatchObject({
      configHook: { entry: './runtime/config.js ' },
      icon: './assets/icon.svg ',
      plugin: {
        client: {
          devEntry: './client/dev.tsx ',
          entry: './client/index.js ',
          root: './client ',
          sourceRoot: './src '
        },
        server: { entry: './server/index.js ' }
      }
    })
    expect(resolvePluginConfigEntryPathForInstance(root, instance!)).toBe(join(exactRoot, 'runtime/config.js '))
  })

  it('loads package plugins only from the exact whitespace-bearing runtime package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-plugin-runtime-root-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const exactRuntime = join(root, 'runtime ')
    const adjacentRuntime = join(root, 'runtime')
    const packageName = '@oneworks/plugin-path-owner'
    await mkdir(workspace)
    await writeRuntimePlugin(join(exactRuntime, 'node_modules', ...packageName.split('/')), packageName)
    await writeRuntimePlugin(join(adjacentRuntime, 'node_modules', ...packageName.split('/')), packageName)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', exactRuntime)
    vi.stubEnv('__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__', 'false')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: packageName }]
    })

    expect(instance?.rootDir).toBe(join(exactRuntime, 'node_modules', ...packageName.split('/')))
  })

  it('does not fall back to an adjacent conventional config hook when an explicit entry is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-plugin-config-hook-'))
    tempDirs.push(root)
    const pluginRoot = join(root, 'plugin')
    await mkdir(pluginRoot)
    await writeFile(join(pluginRoot, 'config.js'), 'module.exports = () => ({ adjacent: true })\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolvePluginConfigEntryPathForInstance(root, {
      manifest: { configHook: { entry: './config.js ' } },
      rootDir: pluginRoot
    })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('config hook is unavailable'))

    expect(resolvePluginConfigEntryPathForInstance(root, {
      manifest: {},
      rootDir: pluginRoot
    })).toBe(join(pluginRoot, 'config.js'))
  })
})
