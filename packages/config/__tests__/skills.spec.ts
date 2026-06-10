import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig, resetConfigCache } from '#~/load.js'

describe('skills config loading', () => {
  it('loads top-level skills arrays with embedded registry and version metadata', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-skills-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            skills: [
              'frontend-design',
              {
                name: 'design-review',
                registry: 'https://registry.example.com',
                source: 'example-source/default/public',
                version: '1.0.3',
                rename: 'internal-review'
              }
            ],
            skillRegistries: [
              {
                source: 'example-source/default/public',
                title: 'Team Tools',
                registry: 'https://registry.example.com'
              }
            ],
            skillsMeta: {
              registries: ['https://registry.example.com'],
              sources: ['example-source/default/public']
            }
          },
          null,
          2
        )
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig?.skills).toEqual([
        'frontend-design',
        {
          name: 'design-review',
          registry: 'https://registry.example.com',
          source: 'example-source/default/public',
          version: '1.0.3',
          rename: 'internal-review'
        }
      ])
      expect(projectConfig?.skillRegistries).toEqual([
        {
          source: 'example-source/default/public',
          title: 'Team Tools',
          registry: 'https://registry.example.com'
        }
      ])
      expect(projectConfig?.skillsMeta).toEqual({
        registries: ['https://registry.example.com'],
        sources: ['example-source/default/public']
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('keeps loading legacy skills.install aliases', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-skills-legacy-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            skills: {
              install: [
                'frontend-design'
              ]
            }
          },
          null,
          2
        )
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig?.skills).toEqual(['frontend-design'])
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
