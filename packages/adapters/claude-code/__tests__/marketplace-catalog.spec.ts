import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadMarketplaceCatalogFromSource } from '../src/plugins/marketplace-catalog'

const tempDirs: string[] = []

const createMarketplace = async (plugin: Record<string, unknown>, manifest?: Record<string, unknown>) => {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'claude-marketplace-catalog-'))
  tempDirs.push(rootDir)
  await fs.mkdir(path.join(rootDir, '.claude-plugin'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'plugins', 'demo', '.claude-plugin'), { recursive: true })
  await fs.writeFile(
    path.join(rootDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      metadata: { pluginRoot: './plugins' },
      plugins: [{ name: 'demo', source: 'demo', ...plugin }]
    })
  )
  if (manifest != null) {
    await fs.writeFile(
      path.join(rootDir, 'plugins', 'demo', '.claude-plugin', 'plugin.json'),
      JSON.stringify(manifest)
    )
  }
  return rootDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('claude marketplace catalog versions', () => {
  it('enriches a local catalog entry from the plugin manifest version', async () => {
    const rootDir = await createMarketplace({}, { name: 'demo', version: '1.2.3' })
    const loaded = await loadMarketplaceCatalogFromSource(
      path.join(rootDir, 'temp'),
      { source: 'directory', path: rootDir },
      'test',
      async () => rootDir
    )

    expect(loaded.catalog.plugins[0]?.version).toBe('1.2.3')
  })

  it('keeps the explicit catalog version ahead of the plugin manifest', async () => {
    const rootDir = await createMarketplace({ version: '4.5.6' }, { version: '1.2.3' })
    const loaded = await loadMarketplaceCatalogFromSource(
      path.join(rootDir, 'temp'),
      { source: 'directory', path: rootDir },
      'test',
      async () => rootDir
    )

    expect(loaded.catalog.plugins[0]?.version).toBe('4.5.6')
  })

  it('leaves the version absent when the plugin manifest has no usable version', async () => {
    const rootDir = await createMarketplace({}, { version: '  ' })
    const loaded = await loadMarketplaceCatalogFromSource(
      path.join(rootDir, 'temp'),
      { source: 'directory', path: rootDir },
      'test',
      async () => rootDir
    )

    expect(loaded.catalog.plugins[0]?.version).toBeUndefined()
  })

  it('rejects a plugin manifest symlink that escapes the marketplace root', async () => {
    const rootDir = await createMarketplace({})
    const outsideDir = await fs.mkdtemp(path.join(tmpdir(), 'outside-claude-plugin-'))
    tempDirs.push(outsideDir)
    const outsideManifest = path.join(outsideDir, 'plugin.json')
    await fs.writeFile(outsideManifest, JSON.stringify({ version: '9.9.9' }))
    await fs.symlink(
      outsideManifest,
      path.join(rootDir, 'plugins', 'demo', '.claude-plugin', 'plugin.json')
    )

    await expect(loadMarketplaceCatalogFromSource(
      path.join(rootDir, 'temp'),
      { source: 'directory', path: rootDir },
      'test',
      async () => rootDir
    )).rejects.toThrow(/manifest resolves outside the plugin root/i)
  })
})
