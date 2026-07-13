import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginsRoot = join(repoRoot, 'packages/plugins')

describe('repository plugin presentation metadata', () => {
  it('requires every shipped plugin to provide bilingual names and a resolvable icon', async () => {
    const entries = await readdir(pluginsRoot, { withFileTypes: true })
    const pluginDirectories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()

    for (const directory of pluginDirectories) {
      const pluginRoot = join(pluginsRoot, directory)
      const pluginJsonPath = join(pluginRoot, 'plugin.json')
      const manifestPath = await stat(pluginJsonPath).then(() => pluginJsonPath).catch(() =>
        join(pluginRoot, 'package.json')
      )
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        displayName?: string
        displayNameI18n?: Record<string, string>
        icon?: string
      }

      expect(manifest.displayName?.trim(), `${directory} displayName`).toBeTruthy()
      expect(manifest.displayNameI18n?.en?.trim(), `${directory} displayNameI18n.en`).toBeTruthy()
      expect(manifest.displayNameI18n?.['zh-Hans']?.trim(), `${directory} displayNameI18n.zh-Hans`).toBeTruthy()
      expect(manifest.icon?.trim(), `${directory} icon`).toBeTruthy()
      expect(isAbsolute(manifest.icon!), `${directory} icon must be relative`).toBe(false)
      expect(manifest.icon!.replaceAll('\\', '/').split('/'), `${directory} icon must not traverse`).not.toContain('..')
      const iconStats = await stat(resolve(pluginRoot, manifest.icon!))
      expect(iconStats.isFile(), `${directory} icon asset`).toBe(true)
    }
  })
})
