import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { updateConfigFile } from '#~/update.js'

describe('appearance config updates', () => {
  it('writes appearance section updates into global config without dropping unrelated config', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-appearance-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-appearance-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir

      const configPath = path.join(realHomeDir, '.oneworks', '.oo.config.json')
      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify(
          {
            defaultModel: 'gpt-5.4',
            appearance: {
              historyTimelineMode: 'event-line',
              iconBackground: 'transparent',
              primaryColor: '#E23F12',
              themeMode: 'light',
              themePack: 'default',
              themePacks: {
                'china-red': {
                  overrides: {
                    colors: { backgrounds: true, borders: true }
                  },
                  showBanner: true
                }
              }
            }
          },
          null,
          2
        )
      )

      const result = await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'global',
        section: 'appearance',
        value: {
          historyTimelineMode: 'node',
          primaryColor: '#00B454',
          themeMode: 'dark',
          themePack: 'china-red',
          themePacks: {
            'china-red': {
              overrides: {
                colors: { backgrounds: false, borders: true },
                components: { buttons: false },
                layout: { padding: { enabled: true, value: 12 } }
              },
              showBanner: false
            }
          }
        }
      })

      expect(result.configPath).toBe(configPath)
      expect(result.updatedConfig.defaultModel).toBe('gpt-5.4')
      expect(result.updatedConfig.appearance).toEqual({
        historyTimelineMode: 'node',
        primaryColor: '#00B454',
        themeMode: 'dark',
        themePack: 'china-red',
        themePacks: {
          'china-red': {
            overrides: {
              colors: { backgrounds: false, borders: true },
              components: { buttons: false },
              layout: { padding: { enabled: true, value: 12 } }
            },
            showBanner: false
          }
        }
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written).toEqual({
        defaultModel: 'gpt-5.4',
        appearance: {
          historyTimelineMode: 'node',
          primaryColor: '#00B454',
          themeMode: 'dark',
          themePack: 'china-red',
          themePacks: {
            'china-red': {
              overrides: {
                colors: { backgrounds: false, borders: true },
                components: { buttons: false },
                layout: { padding: { enabled: true, value: 12 } }
              },
              showBanner: false
            }
          }
        }
      })
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(realHomeDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('rejects project appearance writes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-appearance-project-'))

    try {
      await expect(updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'appearance',
        value: {
          primaryColor: '#00B454'
        }
      })).rejects.toThrow('Config section "appearance" can only be written to global config.')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves supported appearance fields during partial updates', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-appearance-partial-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-appearance-partial-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir

      const configPath = path.join(realHomeDir, '.oneworks', '.oo.config.json')
      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(
        configPath,
        JSON.stringify(
          {
            appearance: {
              historyTimelineMode: 'event-line',
              primaryColor: '#3F7E8F',
              themePack: 'china-red',
              themePacks: {
                'china-red': { showBanner: false }
              }
            }
          },
          null,
          2
        )
      )

      await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'global',
        section: 'appearance',
        value: {
          themeMode: 'dark'
        }
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written.appearance).toEqual({
        historyTimelineMode: 'event-line',
        primaryColor: '#3F7E8F',
        themeMode: 'dark',
        themePack: 'china-red',
        themePacks: {
          'china-red': { showBanner: false }
        }
      })
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(realHomeDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
