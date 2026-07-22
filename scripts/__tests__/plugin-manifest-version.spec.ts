import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('plugin package manifests', () => {
  it('keeps plugin.json versions aligned with their package versions', async () => {
    const pluginsRoot = path.join(process.cwd(), 'packages/plugins')
    const entries = await readdir(pluginsRoot, { withFileTypes: true })
    const mismatches: string[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packageRoot = path.join(pluginsRoot, entry.name)
      const [packageJson, pluginJson] = await Promise.all([
        readFile(path.join(packageRoot, 'package.json'), 'utf8').then(JSON.parse),
        readFile(path.join(packageRoot, 'plugin.json'), 'utf8').then(JSON.parse).catch(() => undefined)
      ])
      if (pluginJson != null && pluginJson.version !== packageJson.version) {
        mismatches.push(`${entry.name}: package=${packageJson.version}, plugin=${pluginJson.version}`)
      }
    }

    expect(mismatches).toEqual([])
  })
})
