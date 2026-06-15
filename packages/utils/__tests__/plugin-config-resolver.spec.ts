import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveConfiguredPluginInstances, resolvePluginConfigEntryPathForInstance } from '#~/plugin-resolver.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('plugin config resolver', () => {
  it('falls back to legacy vibe-forge plugin package names from the workspace', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-legacy-'))
    tempDirs.push(tempDir)

    const realHome = join(tempDir, 'home')
    const pluginRoot = join(tempDir, 'node_modules', '@vibe-forge', 'plugin-legacy-only')
    await mkdir(join(pluginRoot, 'dist'), { recursive: true })
    await writeFile(
      join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@vibe-forge/plugin-legacy-only',
          version: '1.0.0',
          exports: {
            '.': './dist/index.js',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(join(pluginRoot, 'dist/index.js'), 'module.exports = { __oneWorksPluginManifest: true }\n')

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__', 'false')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: tempDir,
      plugins: [{ id: 'legacy-only' }]
    })

    expect(instance).toMatchObject({
      requestId: 'legacy-only',
      packageId: '@vibe-forge/plugin-legacy-only',
      rootDir: pluginRoot,
      resolvedBy: 'vibe-forge-prefix'
    })
  })

  it('resolves plugin config hook entries declared by the plugin manifest', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-manifest-config-'))
    tempDirs.push(tempDir)

    const pluginRoot = join(tempDir, 'node_modules', '@oneworks', 'plugin-relay')
    await mkdir(join(pluginRoot, 'runtime'), { recursive: true })
    await writeFile(
      join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@oneworks/plugin-relay',
          version: '1.0.0',
          exports: {
            '.': './index.js',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      join(pluginRoot, 'index.js'),
      'module.exports = { __oneWorksPluginManifest: true, configHook: { entry: "./runtime/config.js" } }\n'
    )
    await writeFile(join(pluginRoot, 'runtime/config.js'), 'module.exports = () => ({})\n')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: tempDir,
      plugins: [{ id: '@oneworks/plugin-relay' }]
    })

    expect(resolvePluginConfigEntryPathForInstance(tempDir, instance!)).toBe(
      join(pluginRoot, 'runtime/config.js')
    )
  })
})
