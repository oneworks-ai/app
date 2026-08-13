import { describe, expect, it } from 'vitest'

import {
  buildPluginRouteSidebarGroups,
  resolvePluginSourceGroup
} from '../src/components/plugins/PluginStoreSidebarControls'
import { buildPluginListItems } from '../src/components/plugins/plugin-runtime-list-items'
import type { PluginRuntimeInstance } from '../src/plugins/plugin-manifest'
import {
  projectPluginNotificationActions,
  projectPluginNotificationInput
} from '../src/plugins/plugin-notification-presentation'
import {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  buildPluginPresentationInstanceConfig,
  getPluginPresentationSearchText,
  projectPluginPresentationValue,
  resolvePluginDisplayName,
  resolvePluginPresentationIcon,
  resolvePluginRequestDisplay,
  resolvePluginRootDisplay,
  sanitizePluginAssetReference,
  sanitizePluginIconRef,
  sanitizePluginPresentationData,
  sanitizePluginPresentationValue
} from '../src/plugins/plugin-presentation'

const createPlugin = (
  overrides: Partial<PluginRuntimeInstance> & { pluginRoot?: string; rootDir?: string } = {}
): PluginRuntimeInstance => ({
  scope: 'logger',
  requestId: 'logger',
  enabled: true,
  ...overrides
} as PluginRuntimeInstance)

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
    expect(resolvePluginPresentationIcon(createPlugin({ icon: 'assets\\icon.svg' }), 'http://localhost:3000'))
      .toEqual({
        alt: '',
        src: 'http://localhost:3000/api/plugins/logger/readme/assets/assets%5Cicon.svg',
        type: 'image'
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

  it('keeps public runtime paths and credential URLs out of every shared presentation model', () => {
    const privateSentinel = 'presentation-private-sentinel'
    const privatePath = ['', 'private', privateSentinel, 'managed', 'oneworks'].join('/')
    const plugin = createPlugin({
      description: `Installed from ${privatePath}`,
      displayName: `Runtime ${privatePath}`,
      name: privatePath,
      options: { installRoot: privatePath },
      pluginRoot: privatePath,
      requestId: privatePath,
      scope: 'airtable-runtime'
    })

    expect(resolvePluginDisplayName(plugin, 'en')).toBe('airtable-runtime')
    expect(resolvePluginRequestDisplay(plugin)).toBe('airtable-runtime')
    expect(resolvePluginRootDisplay(plugin)).toBeUndefined()
    expect(getPluginPresentationSearchText(plugin, 'en')).not.toContain(privateSentinel)
    expect(JSON.stringify(buildPluginPresentationInstanceConfig(plugin))).not.toContain(privateSentinel)

    const sidebarGroups = buildPluginRouteSidebarGroups(
      [plugin],
      'enabled',
      key => key,
      'en'
    )
    expect(JSON.stringify(sidebarGroups)).not.toContain(privateSentinel)
    expect(sidebarGroups[0]?.items[0]?.label).toBe('airtable-runtime')

    const listPresentation = buildPluginListItems({
      language: 'en',
      nativePlugins: [],
      plugins: [plugin]
    }).map(item => ({ name: item.name, searchText: item.searchText }))
    expect(JSON.stringify(listPresentation)).not.toContain(privateSentinel)
    expect(listPresentation[0]?.name).toBe('airtable-runtime')

    expect(sanitizePluginPresentationValue('./plugins/airtable')).toBe('./plugins/airtable')
    expect(sanitizePluginPresentationValue('https://example.invalid/plugins/airtable')).toBe(
      'https://example.invalid/plugins/airtable'
    )
    expect(sanitizePluginPresentationValue(`root:${privatePath}`)).toBeUndefined()
    expect(sanitizePluginPresentationValue('https://private-user:secret@example.invalid/plugin')).toBeUndefined()
  })

  it('fails closed for every local-path and credential URL shape while retaining safe URLs', () => {
    const sentinel = 'private-projection-sentinel'
    const unsafeValues = [
      `/${sentinel}/plugin`,
      `installed at (/${sentinel}/plugin)`,
      `C:\\Users\\${sentinel}\\plugin`,
      `source=C:/Users/${sentinel}/plugin`,
      `\\\\host\\${sentinel}\\plugin`,
      `~${sentinel}/plugins/tool`,
      '~/plugins/tool',
      `file:///${sentinel}/plugin`,
      `file:%2F%2F%2F${sentinel}%2Fplugin`,
      `</Users/${sentinel}/private-plugin>`,
      `failed at </Users/${sentinel}/private-plugin>; retry`,
      `//${sentinel}:secret@example.invalid/plugin`,
      `ftp://${sentinel}:secret@example.invalid/plugin`
    ]

    for (const value of unsafeValues) {
      expect(sanitizePluginPresentationValue(value), value).toBeUndefined()
      expect(projectPluginPresentationValue(value), value).toContain(PRIVATE_PLUGIN_PRESENTATION_VALUE)
      expect(projectPluginPresentationValue(value), value).not.toContain(sentinel)
    }
    expect(sanitizePluginPresentationValue('//example.invalid/plugins/tool')).toBe(
      '//example.invalid/plugins/tool'
    )
    expect(sanitizePluginPresentationValue('ftp://example.invalid/plugins/tool')).toBe(
      'ftp://example.invalid/plugins/tool'
    )
    expect(sanitizePluginPresentationValue('./plugins/tool')).toBe('./plugins/tool')
    expect(sanitizePluginPresentationValue('中文文档/安装指南')).toBe('中文文档/安装指南')
    expect(sanitizePluginPresentationValue('1 / 2')).toBe('1 / 2')
    expect(sanitizePluginPresentationValue('<code>docs/guide.md</code>')).toBe(
      '<code>docs/guide.md</code>'
    )
    expect(sanitizePluginPresentationValue('</code>')).toBe('</code>')
    expect(sanitizePluginPresentationValue('[Guide](/docs/getting-started.md)')).toBe(
      '[Guide](/docs/getting-started.md)'
    )
    expect(sanitizePluginPresentationValue('https://example.invalid/docs/a(b,c);d')).toBe(
      'https://example.invalid/docs/a(b,c);d'
    )
    expect(sanitizePluginAssetReference('https://example.invalid/icon.svg')).toBe(
      'https://example.invalid/icon.svg'
    )
    expect(sanitizePluginAssetReference('/docs/getting-started.md')).toBe('/docs/getting-started.md')
    expect(sanitizePluginAssetReference('/assets/plugin-icon.svg')).toBe('/assets/plugin-icon.svg')
    expect(sanitizePluginAssetReference('/plugins/airtable/icon.svg')).toBe('/plugins/airtable/icon.svg')
    expect(sanitizePluginAssetReference('./assets/plugin-icon.svg')).toBe('./assets/plugin-icon.svg')
    expect(sanitizePluginAssetReference('icons/plugin%20icon.svg')).toBe('icons/plugin%20icon.svg')
    expect(sanitizePluginAssetReference('assets%5Cicon.svg')).toBe('assets%5Cicon.svg')
    expect(sanitizePluginAssetReference('..%5Cprivate%5Cicon.svg')).toBeUndefined()
    expect(sanitizePluginAssetReference(
      'https://example.invalid/assets/plugin%20icon.svg?theme=dark#public-v2'
    )).toBe('https://example.invalid/assets/plugin%20icon.svg?theme=dark#public-v2')
    expect(sanitizePluginAssetReference('/assets/plugin.svg?ratio=1%20%2F%202#public')).toBe(
      '/assets/plugin.svg?ratio=1%20%2F%202#public'
    )
    expect(sanitizePluginAssetReference(`file:%2F%2F%2F${sentinel}%2Ficon.svg`)).toBeUndefined()
    const traversalAssets = [
      `/plugins/%2e%2e/${sentinel}/icon.svg`,
      `/assets/%252e%252e/${sentinel}/icon.svg`,
      `%2e%2e/%2e%2e/${sentinel}/icon.svg`,
      `/docs/safe%2F..%2F${sentinel}/icon.svg`,
      `https://example.invalid/assets/%2e%2e/${sentinel}/icon.svg`
    ]
    for (const asset of traversalAssets) {
      expect(sanitizePluginAssetReference(asset), asset).toBeUndefined()
      expect(sanitizePluginIconRef({ kind: 'url', url: asset }), asset).toBeUndefined()
    }
    const hostileAssetSuffixes = [
      `/assets/icon.svg?next=ssh%3A%2F%2Fcredential-user%3Asecret%40example.invalid%2F${sentinel}`,
      `https://example.invalid/plugins/icon.svg#source%3D%2F${sentinel}%2Fmanaged%2Fplugin`,
      `//example.invalid/assets/icon.svg?source=file%3A%2F%2F%2F${sentinel}%2Ficon.svg`,
      `/assets/icon.svg?source=%3C%2F${sentinel}%2Fmanaged%3E`,
      `/plugins/icon.svg#source=%3C%2F${sentinel}%2Fmanaged%3E`
    ]
    for (const asset of hostileAssetSuffixes) {
      expect(sanitizePluginAssetReference(asset), asset).toBeUndefined()
      expect(sanitizePluginIconRef({ kind: 'url', url: asset }), asset).toBeUndefined()
    }
    expect(sanitizePluginIconRef({ kind: 'url', url: `file:%2F%2F%2F${sentinel}%2Ficon.svg` }))
      .toBeUndefined()
    expect(projectPluginPresentationValue(`Failed at /${sentinel}/plugin; retry`)).toBe(
      `Failed at ${PRIVATE_PLUGIN_PRESENTATION_VALUE}; retry`
    )
    expect(projectPluginPresentationValue(
      `Fetch (ftp://${sentinel}:secret@example.invalid/docs/a(b,c);d), retry`
    )).toBe(`Fetch (${PRIVATE_PLUGIN_PRESENTATION_VALUE}), retry`)
    expect(projectPluginPresentationValue(`See file:%2F%2F%2F${sentinel}%2Fplugin then retry`)).toBe(
      `See ${PRIVATE_PLUGIN_PRESENTATION_VALUE} then retry`
    )
  })

  it('preserves array positions and applies depth, breadth, node and string budgets', () => {
    const sentinel = 'private-budget-sentinel'
    const privatePath = `/${sentinel}/plugin`
    expect(sanitizePluginPresentationData(['before', privatePath, 'after'])).toEqual([
      'before',
      PRIVATE_PLUGIN_PRESENTATION_VALUE,
      'after'
    ])

    const wide = Array.from({ length: 70 }, (_, index) => `value-${index}`)
    const projectedWide = sanitizePluginPresentationData(wide) as unknown[]
    expect(projectedWide).toHaveLength(65)
    expect(projectedWide.at(-1)).toBe(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    const wideObject = Object.fromEntries(wide.map((value, index) => [`key-${index}`, value]))
    expect(Object.keys(sanitizePluginPresentationData(wideObject) as object)).toHaveLength(65)

    let deep: unknown = 'leaf'
    for (let index = 0; index < 12; index += 1) deep = { next: deep }
    expect(JSON.stringify(sanitizePluginPresentationData(deep))).toContain(PRIVATE_PLUGIN_PRESENTATION_VALUE)

    const numerous = Array.from(
      { length: 64 },
      (_, outer) => Array.from({ length: 8 }, (_, inner) => `${outer}:${inner}`)
    )
    expect(JSON.stringify(sanitizePluginPresentationData(numerous))).toContain(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    expect(projectPluginPresentationValue('x'.repeat(4097))).toBe(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    expect(sanitizePluginPresentationData(new Date(0))).toBe(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    expect(JSON.stringify(sanitizePluginPresentationData({ [privatePath]: privatePath }))).not.toContain(sentinel)
  })

  it('uses own data descriptors without invoking array methods or accessors', () => {
    const values = ['before', 'middle', 'after']
    let methodCalled = false
    Object.defineProperty(values, 'slice', {
      enumerable: false,
      value: () => {
        methodCalled = true
        throw new Error('must not run')
      }
    })
    let getterCalled = false
    Object.defineProperty(values, '1', {
      enumerable: true,
      get: () => {
        getterCalled = true
        throw new Error('must not read')
      }
    })

    expect(sanitizePluginPresentationData(values)).toEqual([
      'before',
      PRIVATE_PLUGIN_PRESENTATION_VALUE,
      'after'
    ])
    expect(methodCalled).toBe(false)
    expect(getterCalled).toBe(false)

    const record: Record<string, unknown> = { safe: 'value' }
    Object.defineProperty(record, 'private', {
      enumerable: true,
      get: () => {
        getterCalled = true
        throw new Error('must not read')
      }
    })
    expect(sanitizePluginPresentationData(record)).toEqual({
      private: PRIVATE_PLUGIN_PRESENTATION_VALUE,
      safe: 'value'
    })
    expect(getterCalled).toBe(false)

    const tooManyHiddenKeys: Record<string, unknown> = {}
    for (let index = 0; index < 129; index += 1) {
      Object.defineProperty(tooManyHiddenKeys, `hidden-${index}`, { value: index })
    }
    expect(sanitizePluginPresentationData(tooManyHiddenKeys)).toBe(PRIVATE_PLUGIN_PRESENTATION_VALUE)

    let proxyTrapCalled = false
    const proxy = new Proxy({}, {
      getPrototypeOf: () => {
        proxyTrapCalled = true
        throw new Error('must fail closed')
      }
    })
    expect(sanitizePluginPresentationData(proxy)).toBe(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    expect(proxyTrapCalled).toBe(true)
  })

  it('projects notification presentation without changing action identity or invoking getters', () => {
    const sentinel = 'notification-private-sentinel'
    const privatePath = `/${sentinel}/plugin`
    const callback = () => undefined
    const actions = [{ id: 'open', onClick: callback, title: `Open ${privatePath}` }]
    Object.defineProperty(actions, 'map', {
      value: () => {
        throw new Error('must not run')
      }
    })

    const projectedActions = projectPluginNotificationActions(actions)
    expect(projectedActions?.[0]).toMatchObject({ id: 'open', onClick: callback })
    expect(projectedActions?.[0]?.title).toBe(`Open ${PRIVATE_PLUGIN_PRESENTATION_VALUE}`)

    let getterCalled = false
    const input = {
      dedupeKey: 'raw-dedupe-identity',
      id: 'raw-notification-identity',
      title: 'Safe title'
    }
    Object.defineProperty(input, 'description', {
      enumerable: true,
      get: () => {
        getterCalled = true
        throw new Error('must not read')
      }
    })
    expect(projectPluginNotificationInput(input)).toMatchObject({
      dedupeKey: 'raw-dedupe-identity',
      description: undefined,
      id: 'raw-notification-identity',
      title: 'Safe title'
    })
    expect(getterCalled).toBe(false)
  })
})
