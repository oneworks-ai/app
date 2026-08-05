import { describe, expect, it } from 'vitest'

import { resolvePluginSourceGroup } from '../src/components/plugins/PluginStoreSidebarControls'
import type { PluginRuntimeInstance } from '../src/plugins/plugin-manifest'
import {
  getNativePluginPresentationSearchText,
  getPluginPresentationSearchText,
  resolveInstalledMarketplacePlugin,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon
} from '../src/plugins/plugin-presentation'

const createPlugin = (overrides: Partial<PluginRuntimeInstance> = {}): PluginRuntimeInstance => ({
  scope: 'logger',
  requestId: 'logger',
  enabled: true,
  ...overrides
})

describe('plugin presentation', () => {
  it('resolves localized names and indexes every declared translation', () => {
    const plugin = createPlugin({
      displayName: 'Logger',
      displayNameI18n: {
        en: 'Logger',
        'zh-Hans': '日志'
      },
      name: '@oneworks/plugin-logger'
    })

    expect(resolvePluginDisplayName(plugin, 'zh-CN')).toBe('日志')
    expect(resolvePluginDisplayName(plugin, 'fr')).toBe('Logger')
    expect(getPluginPresentationSearchText(plugin, 'en')).toContain('日志')
  })

  it('uses a served manifest icon and a neutral fallback otherwise', () => {
    expect(resolvePluginPresentationIcon(createPlugin({ icon: './assets/icon.svg' }), 'http://localhost:3000'))
      .toEqual({
        alt: '',
        src: 'http://localhost:3000/api/plugins/logger/readme/assets/assets/icon.svg',
        type: 'image'
      })

    expect(resolvePluginPresentationIcon(createPlugin())).toEqual({
      name: 'extension',
      type: 'material'
    })
  })

  it('trusts the server provenance and defaults missing legacy values to project', () => {
    expect(resolvePluginSourceGroup(createPlugin({ sourceGroup: 'global', watch: { enabled: true } }))).toBe('global')
    expect(resolvePluginSourceGroup(createPlugin({ packageId: '@oneworks/plugin-logger' }))).toBe('project')
  })

  it('presents legacy official packages with their product name and dedicated icon', () => {
    const logger = createPlugin({
      name: '@oneworks/plugin-logger',
      packageId: '@oneworks/plugin-logger'
    })

    expect(resolvePluginDisplayName(logger, 'zh-CN')).toBe('日志')
    expect(resolvePluginPresentationIcon(logger)).toMatchObject({ type: 'svg' })
    expect(getPluginPresentationSearchText(logger, 'en')).toContain('日志')
  })

  it('does not inject legacy names after an official plugin declares its own presentation', () => {
    const renamedLogger = createPlugin({
      displayName: 'Audit Trail',
      displayNameI18n: { en: 'Audit Trail', 'zh-Hans': '审计轨迹' },
      name: '@oneworks/plugin-logger',
      packageId: '@oneworks/plugin-logger'
    })

    expect(getPluginPresentationSearchText(renamedLogger, 'en')).not.toContain('Logger')
  })

  it('indexes root-free public plugin metadata and ignores native display paths', () => {
    const plugin = createPlugin({
      name: 'Codex Docs'
    })

    const searchText = getPluginPresentationSearchText(plugin, 'en')

    expect(searchText).toContain('Codex Docs')
    expect(plugin).not.toHaveProperty('pluginRoot')
    expect(plugin).not.toHaveProperty('rootDir')
    expect(getNativePluginPresentationSearchText({
      adapter: 'codex',
      capabilities: {
        disable: 'unsupported',
        discover: 'available',
        enable: 'unsupported',
        import: 'unsupported',
        install: 'unsupported',
        uninstall: 'unsupported',
        update: 'unsupported'
      },
      id: 'docs',
      name: 'Codex Docs',
      scope: 'user',
      source: {
        displayPath: '/Users/example/.codex/plugins/docs',
        kind: 'installed-copy'
      },
      state: 'enabled'
    })).toBe('Codex Docs docs codex user')
  })

  it('prefers the installed runtime identity for a marketplace detail without using a filesystem path', () => {
    const installed = createPlugin({
      displayName: 'Airtable',
      scope: 'adapter:codex:market:official:airtable',
      source: {
        adapter: 'codex',
        kind: 'marketplace',
        marketplace: 'official',
        plugin: 'airtable'
      }
    })
    const unrelated = createPlugin({
      scope: 'other',
      source: {
        adapter: 'codex',
        kind: 'marketplace',
        marketplace: 'official',
        plugin: 'calendar'
      }
    })

    expect(resolveInstalledMarketplacePlugin([unrelated, installed], {
      marketplace: 'official',
      plugin: 'airtable'
    })).toBe(installed)
  })
})
