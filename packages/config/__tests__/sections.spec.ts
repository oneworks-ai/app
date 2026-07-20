import { describe, expect, it } from 'vitest'

import type { Config } from '@oneworks/types'

import {
  getConfigSectionValueAtPath,
  setConfigSectionValueAtPath,
  unsetConfigSectionValueAtPath
} from '#~/section-path-value.js'
import { parseConfigSectionPath, resolveConfigSectionPath } from '#~/section-path.js'
import { buildConfigSections, hasConfigSectionValue } from '#~/sections.js'

describe('config sections helpers', () => {
  it('maps root config aliases onto section paths', () => {
    expect(resolveConfigSectionPath(parseConfigSectionPath('defaultModel'))).toEqual({
      input: ['defaultModel'],
      normalizedPath: 'general.defaultModel',
      section: 'general',
      sectionPath: ['defaultModel']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('mcpServers.docs.args.0'))).toEqual({
      input: ['mcpServers', 'docs', 'args', 0],
      normalizedPath: 'mcp.mcpServers.docs.args.0',
      section: 'mcp',
      sectionPath: ['mcpServers', 'docs', 'args', 0]
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('skills.0.rename'))).toEqual({
      input: ['skills', 0, 'rename'],
      normalizedPath: 'general.skills.0.rename',
      section: 'general',
      sectionPath: ['skills', 0, 'rename']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('messageLinks.imageLinkMode'))).toEqual({
      input: ['messageLinks', 'imageLinkMode'],
      normalizedPath: 'general.messageLinks.imageLinkMode',
      section: 'general',
      sectionPath: ['messageLinks', 'imageLinkMode']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('experiments.agentRoom'))).toEqual({
      input: ['experiments', 'agentRoom'],
      normalizedPath: 'experiments.agentRoom',
      section: 'experiments',
      sectionPath: ['agentRoom']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('appearance.primaryColor'))).toEqual({
      input: ['appearance', 'primaryColor'],
      normalizedPath: 'appearance.primaryColor',
      section: 'appearance',
      sectionPath: ['primaryColor']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('appearance.themePacks.china-red.showBanner'))).toEqual({
      input: ['appearance', 'themePacks', 'china-red', 'showBanner'],
      normalizedPath: 'appearance.themePacks.china-red.showBanner',
      section: 'appearance',
      sectionPath: ['themePacks', 'china-red', 'showBanner']
    })

    expect(
      resolveConfigSectionPath(
        parseConfigSectionPath('appearance.themePacks.china-red.overrides.components.buttons')
      )
    ).toEqual({
      input: ['appearance', 'themePacks', 'china-red', 'overrides', 'components', 'buttons'],
      normalizedPath: 'appearance.themePacks.china-red.overrides.components.buttons',
      section: 'appearance',
      sectionPath: ['themePacks', 'china-red', 'overrides', 'components', 'buttons']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('desktop.launcherShortcut'))).toEqual({
      input: ['desktop', 'launcherShortcut'],
      normalizedPath: 'desktop.launcherShortcut',
      section: 'desktop',
      sectionPath: ['launcherShortcut']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('voice.speechToText.defaultServiceId'))).toEqual({
      input: ['voice', 'speechToText', 'defaultServiceId'],
      normalizedPath: 'voice.speechToText.defaultServiceId',
      section: 'voice',
      sectionPath: ['speechToText', 'defaultServiceId']
    })
  })

  it('supports plugin list aliases and exact JSON-array paths', () => {
    expect(resolveConfigSectionPath(parseConfigSectionPath('plugins.0.id'))).toEqual({
      input: ['plugins', 0, 'id'],
      normalizedPath: 'plugins.plugins.0.id',
      section: 'plugins',
      sectionPath: ['plugins', 0, 'id']
    })

    expect(resolveConfigSectionPath(parseConfigSectionPath('["models","gpt-4.1","title"]'))).toEqual({
      input: ['models', 'gpt-4.1', 'title'],
      normalizedPath: 'models.gpt-4.1.title',
      section: 'models',
      sectionPath: ['gpt-4.1', 'title']
    })
  })

  it('reads and updates nested section values', () => {
    const sections = buildConfigSections({
      defaultModel: 'gpt-5',
      models: {
        'gpt-4.1': {
          title: 'GPT 4.1'
        }
      },
      plugins: [
        {
          id: 'demo'
        }
      ],
      messageLinks: {
        workspaceFileTarget: 'fileTab'
      },
      appearance: {
        historyTimelineMode: 'node',
        iconBackground: 'solid',
        primaryColor: '#00B454',
        themeMode: 'dark',
        themePack: 'china-red',
        themePacks: {
          'china-red': {
            overrides: {
              components: { buttons: false },
              layout: { padding: { enabled: true, value: 12 } }
            },
            showBanner: false
          }
        }
      } as Config['appearance'],
      disableGlobalConfig: true,
      experiments: {
        agentRoom: true
      },
      voice: {
        speechToText: {
          defaultServiceId: 'local-asr'
        }
      }
    })

    const modelTitlePath = resolveConfigSectionPath(parseConfigSectionPath('["models","gpt-4.1","title"]'))
    expect(getConfigSectionValueAtPath(sections, modelTitlePath)).toEqual({
      exists: true,
      value: 'GPT 4.1'
    })

    const pluginEnabledPath = resolveConfigSectionPath(parseConfigSectionPath('plugins.0.enabled'))
    const updatedSections = setConfigSectionValueAtPath(sections, pluginEnabledPath, true)
    expect(getConfigSectionValueAtPath(updatedSections, pluginEnabledPath)).toEqual({
      exists: true,
      value: true
    })

    const experimentPath = resolveConfigSectionPath(parseConfigSectionPath('experiments.agentRoom'))
    expect(getConfigSectionValueAtPath(sections, experimentPath)).toEqual({
      exists: true,
      value: true
    })

    const messageLinksPath = resolveConfigSectionPath(parseConfigSectionPath('messageLinks.workspaceFileTarget'))
    expect(getConfigSectionValueAtPath(sections, messageLinksPath)).toEqual({
      exists: true,
      value: 'fileTab'
    })

    const appearancePath = resolveConfigSectionPath(parseConfigSectionPath('appearance.primaryColor'))
    expect(getConfigSectionValueAtPath(sections, appearancePath)).toEqual({
      exists: true,
      value: '#00B454'
    })
    const appearanceThemePath = resolveConfigSectionPath(parseConfigSectionPath('appearance.themeMode'))
    expect(getConfigSectionValueAtPath(sections, appearanceThemePath)).toEqual({
      exists: true,
      value: 'dark'
    })
    const appearanceTimelinePath = resolveConfigSectionPath(parseConfigSectionPath('appearance.historyTimelineMode'))
    expect(getConfigSectionValueAtPath(sections, appearanceTimelinePath)).toEqual({
      exists: true,
      value: 'node'
    })
    const appearanceThemePackPath = resolveConfigSectionPath(parseConfigSectionPath('appearance.themePack'))
    expect(getConfigSectionValueAtPath(sections, appearanceThemePackPath)).toEqual({
      exists: true,
      value: 'china-red'
    })
    const appearanceThemeBannerPath = resolveConfigSectionPath(
      parseConfigSectionPath('appearance.themePacks.china-red.showBanner')
    )
    expect(getConfigSectionValueAtPath(sections, appearanceThemeBannerPath)).toEqual({
      exists: true,
      value: false
    })
    const appearanceThemeButtonPath = resolveConfigSectionPath(
      parseConfigSectionPath('appearance.themePacks.china-red.overrides.components.buttons')
    )
    expect(getConfigSectionValueAtPath(sections, appearanceThemeButtonPath)).toEqual({
      exists: true,
      value: false
    })
    const appearanceThemePaddingPath = resolveConfigSectionPath(
      parseConfigSectionPath('appearance.themePacks.china-red.overrides.layout.padding.value')
    )
    expect(getConfigSectionValueAtPath(sections, appearanceThemePaddingPath)).toEqual({
      exists: true,
      value: 12
    })
    const legacyAppearancePath = resolveConfigSectionPath(parseConfigSectionPath('appearance.iconBackground'))
    expect(getConfigSectionValueAtPath(sections, legacyAppearancePath)).toEqual({
      exists: false,
      value: undefined
    })

    const disableGlobalPath = resolveConfigSectionPath(parseConfigSectionPath('disableGlobalConfig'))
    expect(getConfigSectionValueAtPath(sections, disableGlobalPath)).toEqual({
      exists: true,
      value: true
    })

    const voiceDefaultPath = resolveConfigSectionPath(parseConfigSectionPath('voice.speechToText.defaultServiceId'))
    expect(getConfigSectionValueAtPath(sections, voiceDefaultPath)).toEqual({
      exists: true,
      value: 'local-asr'
    })
  })

  it('marks object keys as undefined and splices array items when unsetting', () => {
    const sections = buildConfigSections({
      permissions: {
        allow: ['Read'],
        deny: ['Write']
      },
      plugins: [
        {
          id: 'demo'
        },
        {
          id: 'extra'
        }
      ]
    })

    const permissionsPath = resolveConfigSectionPath(parseConfigSectionPath('general.permissions.allow'))
    const nextPermissionsSections = unsetConfigSectionValueAtPath(sections, permissionsPath)
    expect(nextPermissionsSections.general.permissions).toEqual({
      allow: undefined,
      deny: ['Write']
    })

    const pluginPath = resolveConfigSectionPath(parseConfigSectionPath('plugins.0'))
    const nextPluginSections = unsetConfigSectionValueAtPath(sections, pluginPath)
    expect(nextPluginSections.plugins.plugins).toEqual([
      {
        id: 'extra'
      }
    ])
  })

  it('detects whether a section has meaningful configured values', () => {
    const emptySections = buildConfigSections(undefined)
    expect(hasConfigSectionValue(emptySections.general)).toBe(false)
    expect(hasConfigSectionValue(emptySections.adapters)).toBe(false)

    const configuredSections = buildConfigSections({
      permissions: {
        allow: ['Read']
      },
      appearance: {
        primaryColor: '#00B454'
      },
      voice: {
        speechToText: {
          services: {
            local: {
              provider: 'custom-http',
              request: {
                url: 'http://127.0.0.1:7000/transcribe'
              }
            }
          }
        }
      }
    })
    expect(hasConfigSectionValue(configuredSections.general)).toBe(true)
    expect(hasConfigSectionValue(configuredSections.appearance)).toBe(true)
    expect(hasConfigSectionValue(configuredSections.voice)).toBe(true)
  })
})
