/* eslint-disable max-lines -- config form coverage is intentionally consolidated in one spec file */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { adapterConfigContribution as droidConfigContribution } from '@oneworks/adapter-droid/config-schema'
import type { ConfigUiSection } from '@oneworks/types'

import { SectionForm } from '#~/components/config/ConfigSectionForm'
import {
  parseConfigDetailRoute,
  resolveConfigDetailRouteMeta,
  serializeConfigDetailRoute
} from '#~/components/config/configDetail'
import { configGroupMeta, configGroupOrder, configSchema } from '#~/components/config/configSchema'
import { editableConfigSectionKeys } from '#~/components/config/editableConfigSections'
import {
  createProviderCopyFromModelService,
  promoteModelServiceToProvider
} from '#~/components/config/modelServiceProfileUtils'

vi.hoisted(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    })
  })
})

vi.mock('#~/i18n', () => ({
  appLanguageOptions: [
    { value: 'zh', label: 'config.options.language.zh' },
    { value: 'en', label: 'config.options.language.en' }
  ]
}))

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key

describe('config schema form', () => {
  it('treats experiments as an editable config section', () => {
    expect(editableConfigSectionKeys).toContain('experiments')
  })

  it('renders the Agent Room experiment switch as disabled by default', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='experiments'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(configSchema.experiments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['agentRoom'],
        type: 'boolean',
        defaultValue: false
      })
    ]))
    expect(html).toContain('config.fields.experiments.agentRoom.label')
    expect(html).toContain('config.fields.experiments.agentRoom.desc')
    expect(html).toContain('ant-switch')
    expect(html).not.toContain('ant-switch-checked')
  })

  it('groups explicitly related fields without grouping unrelated default fields', () => {
    const generalHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='general'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )
    const experimentsHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='experiments'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )
    const pluginsHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='plugins'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(generalHtml).toContain('config.sectionGroups.links')
    expect(generalHtml).toContain('config-view__field-list config-view__field-list--grouped')
    expect(experimentsHtml).not.toContain('config.sectionGroups.base')
    expect(experimentsHtml).not.toContain('config-view__field-list config-view__field-list--grouped')
    expect(pluginsHtml).toContain('config-view__field-list')
    expect(pluginsHtml).not.toContain('config-view__field-list config-view__field-list--grouped')
  })

  it('treats shortcut fields as one related default group', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='shortcuts'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('config-view__field-list config-view__field-list--grouped')
  })

  it('renders schema-driven adapter entries as a navigable summary list', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {
          codex: {
            fields: [
              {
                path: ['experimentalApi'],
                type: 'boolean',
                label: 'Experimental API',
                defaultValue: false
              },
              {
                path: ['maxOutputTokens'],
                type: 'number',
                label: 'Max Output Tokens',
                defaultValue: 4096
              }
            ]
          }
        },
        unknownSchema: {
          fields: [
            {
              path: ['defaultModel'],
              type: 'string',
              label: 'Default Model',
              defaultValue: ''
            }
          ]
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{
          codex: {
            experimentalApi: true,
            maxOutputTokens: 2048
          },
          'custom-adapter': {
            defaultModel: 'gpt-5.4'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('custom-adapter')
    expect(html).toContain('config-view__detail-list--adapter-grid')
    expect(html).toContain('config-view__adapter-summary-card')
    expect(html).toContain('aria-label="config.editor.resetAdapterConfig"')
    expect(html).toContain('settings_backup_restore')
  })

  it('renders built-in adapter placeholders after configured adapter entries', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        value={{
          'custom-adapter': {
            defaultModel: 'gpt-5.4'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('Custom Adapter')
    expect(html).toContain('Codex')
    expect(html.indexOf('Custom Adapter')).toBeLessThan(html.indexOf('Codex'))
    expect(html).toContain('Kiro')
    expect(html).toContain(encodeURIComponent('#9046FF'))
  })

  it('opens an unconfigured built-in adapter placeholder as an editable detail page', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {
          codex: {
            fields: [
              {
                path: ['experimentalApi'],
                type: 'boolean',
                label: 'Experimental API',
                defaultValue: false
              }
            ]
          }
        },
        unknownSchema: {
          fields: []
        }
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'codex',
          nestedPath: ['advanced']
        }}
        t={t}
      />
    )

    expect(html).toContain('Experimental API')
    expect(html).not.toContain('config.detail.inheritedReadonly')
  })

  it('keeps schema-missing built-in adapter details in the shared tab shell', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        schemas: {},
        unknownSchema: { fields: [] },
        unknownEditor: 'json'
      }
    }
    const renderAdapter = (itemKey: string, nestedPath?: string[]) =>
      renderToStaticMarkup(
        <SectionForm
          sectionKey='adapters'
          uiSection={uiSection}
          value={{}}
          onChange={() => undefined}
          mergedModelServices={{}}
          mergedAdapters={{}}
          detailRoute={{ kind: 'detailCollectionItem', fieldPath: [], itemKey, nestedPath }}
          t={t}
        />
      )

    const kiroHtml = renderAdapter('kiro', ['accounts'])
    const kiroAccountHtml = renderAdapter('kiro', ['accounts', 'primary'])
    const droidHtml = renderAdapter('droid')

    expect(kiroHtml).toContain('config-view__adapter-detail-tabs')
    expect(kiroHtml).toContain('data-node-key="base"')
    expect(kiroHtml).toContain('data-node-key="accounts"')
    expect(kiroHtml).toContain('adapter-account-manager__state')
    expect(kiroAccountHtml).toContain('adapter-account-manager__state')
    expect(kiroAccountHtml).not.toContain('config-view__adapter-detail-tabs')
    expect(droidHtml).toContain('config-view__adapter-detail-tabs')
    expect(droidHtml).toContain('data-node-key="base"')
    expect(droidHtml).not.toContain('data-node-key="accounts"')
  })

  it('uses registered Droid display metadata and hides account UI through adapter capabilities', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        entryKinds: [{
          key: 'droid',
          label: 'Factory Droid',
          capabilities: { accounts: false }
        }, {
          key: 'codex',
          label: 'Codex',
          capabilities: { accounts: true }
        }],
        schemas: {
          droid: {
            fields: [{ path: ['defaultAccount'], type: 'string', label: 'Default account' }]
          },
          codex: {
            fields: [{ path: ['defaultAccount'], type: 'string', label: 'Default account' }]
          }
        },
        unknownSchema: { fields: [] }
      }
    }
    const route = { kind: 'detailCollectionItem' as const, fieldPath: [], itemKey: 'droid' }
    const meta = resolveConfigDetailRouteMeta({
      sectionKey: 'adapters',
      value: {},
      route,
      placeholderEntries: [{ key: 'droid' }],
      detailContext: { mergedAdapters: {}, mergedModelServices: {}, t },
      uiSection,
      t
    })
    expect(meta?.itemLabel).toBe('Factory Droid')

    const droidHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={route}
        t={t}
      />
    )
    expect(droidHtml).not.toContain('Default account')
    expect(droidHtml).not.toContain('config.accounts.title')

    const codexHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{ ...route, itemKey: 'codex' }}
        t={t}
      />
    )
    expect(codexHtml).not.toContain('Default account')
    expect(codexHtml).toContain('data-node-key="accounts"')
    expect(codexHtml).not.toContain('adapter-account-manager__state')

    const codexAccountsHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{ ...route, itemKey: 'codex', nestedPath: ['accounts'] }}
        t={t}
      />
    )
    expect(codexAccountsHtml).not.toContain('Default account')
    expect(codexAccountsHtml).toContain('adapter-account-manager__state')
  })

  it('uses one route-backed tab layout for every registered adapter detail', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        entryKinds: [
          { key: 'alpha', label: 'Alpha', capabilities: { accounts: true } },
          { key: 'beta', label: 'Beta', capabilities: { accounts: false } }
        ],
        schemas: {
          alpha: {
            fields: [
              { path: ['defaultModel'], type: 'string', label: 'Default model' },
              { path: ['defaultAccount'], type: 'string', label: 'Default account' },
              { path: ['includeModels'], type: 'string[]', label: 'Allowed models' },
              { path: ['configContent'], type: 'multiline', label: 'Configuration override' }
            ]
          },
          beta: {
            fields: [
              { path: ['defaultModel'], type: 'string', label: 'Default model' },
              { path: ['excludeModels'], type: 'string[]', label: 'Blocked models' },
              { path: ['experimentalApi'], type: 'boolean', label: 'Experimental API' }
            ]
          }
        },
        unknownSchema: { fields: [] }
      }
    }
    const renderAdapter = (itemKey: 'alpha' | 'beta', nestedPath?: string[]) =>
      renderToStaticMarkup(
        <SectionForm
          sectionKey='adapters'
          uiSection={uiSection}
          value={{ alpha: {}, beta: {} }}
          onChange={() => undefined}
          mergedModelServices={{}}
          mergedAdapters={{}}
          detailRoute={{ kind: 'detailCollectionItem', fieldPath: [], itemKey, nestedPath }}
          t={t}
        />
      )

    const alphaBaseHtml = renderAdapter('alpha')
    const alphaModelsHtml = renderAdapter('alpha', ['models'])
    const alphaAccountsHtml = renderAdapter('alpha', ['accounts'])
    const alphaAccountDetailHtml = renderAdapter('alpha', ['accounts', 'primary'])
    const alphaAdvancedHtml = renderAdapter('alpha', ['advanced'])
    const betaHtml = renderAdapter('beta')

    for (const html of [alphaBaseHtml, alphaModelsHtml, alphaAccountsHtml, alphaAdvancedHtml, betaHtml]) {
      expect(html).toContain('config-view__adapter-detail-tabs')
      expect(html).toContain('data-node-key="base"')
      expect(html).toContain('data-node-key="models"')
      expect(html).toContain('data-node-key="advanced"')
    }
    expect(alphaBaseHtml).toContain('Default model')
    expect(alphaModelsHtml).toContain('Allowed models')
    expect(alphaAccountsHtml).not.toContain('Default account')
    expect(alphaAccountsHtml).toContain('adapter-account-manager__state')
    expect(alphaAccountDetailHtml).toContain('adapter-account-manager__state')
    expect(alphaAccountDetailHtml).not.toContain('config-view__adapter-detail-tabs')
    expect(alphaAdvancedHtml).toContain('Configuration override')
    expect(alphaBaseHtml).toContain('data-node-key="accounts"')
    expect(betaHtml).not.toContain('data-node-key="accounts"')
  })

  it('renders adapter-scoped Droid metadata, effort labels, and accessible controls in both locales', () => {
    const droidOnlyUiSchema = {
      ...droidConfigContribution.uiSchema!,
      fields: droidConfigContribution.uiSchema!.fields.filter(field => (
        ['cli', 'effort', 'configContent', 'disableBuiltinSkills'].includes(field.path[0] ?? '')
      ))
    }
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        entryKinds: [{
          key: 'droid',
          label: droidConfigContribution.title,
          capabilities: droidConfigContribution.capabilities
        }],
        schemas: { droid: droidOnlyUiSchema },
        unknownSchema: { fields: [] }
      }
    }
    const route = { kind: 'detailCollectionItem' as const, fieldPath: [], itemKey: 'droid' }
    const renderLocale = (translations: Record<string, string>) => (
      renderToStaticMarkup(
        <SectionForm
          sectionKey='adapters'
          uiSection={uiSection}
          value={{ droid: { effort: 'xhigh' } }}
          onChange={() => undefined}
          mergedModelServices={{}}
          mergedAdapters={{}}
          detailRoute={route}
          t={(key, options) => translations[key] ?? options?.defaultValue ?? key}
        />
      ) + renderToStaticMarkup(
        <SectionForm
          sectionKey='adapters'
          uiSection={uiSection}
          value={{ droid: { effort: 'xhigh' } }}
          onChange={() => undefined}
          mergedModelServices={{}}
          mergedAdapters={{}}
          detailRoute={{ ...route, nestedPath: ['advanced'] }}
          t={(key, options) => translations[key] ?? options?.defaultValue ?? key}
        />
      )
    )
    const enHtml = renderLocale({
      'config.fields.adaptersByKey.droid.cli.label': 'Factory Droid CLI',
      'config.fields.adaptersByKey.droid.cli.desc': 'Validated Factory Droid CLI runtime.',
      'config.fields.adaptersByKey.droid.effort.label': 'Reasoning effort',
      'config.fields.adaptersByKey.droid.effort.desc': 'Factory Droid reasoning effort.',
      'config.fields.adaptersByKey.droid.effort.options.xhigh': 'Extra high',
      'config.fields.adaptersByKey.droid.configContent.label': 'Factory settings override',
      'config.fields.adaptersByKey.droid.disableBuiltinSkills.label': 'Disable built-in skills'
    })
    const zhHtml = renderLocale({
      'config.fields.adaptersByKey.droid.cli.label': 'Factory Droid CLI',
      'config.fields.adaptersByKey.droid.cli.desc': '已校验的 Factory Droid CLI 运行时。',
      'config.fields.adaptersByKey.droid.effort.label': '推理强度',
      'config.fields.adaptersByKey.droid.effort.desc': 'Factory Droid 推理强度。',
      'config.fields.adaptersByKey.droid.effort.options.xhigh': '极高',
      'config.fields.adaptersByKey.droid.configContent.label': 'Factory 设置覆盖',
      'config.fields.adaptersByKey.droid.disableBuiltinSkills.label': '禁用内置技能'
    })

    expect(enHtml).toContain('Factory Droid CLI')
    expect(enHtml).toContain('Reasoning effort')
    expect(enHtml).toContain('Extra high')
    expect(enHtml).toContain('Factory settings override')
    expect(enHtml).toContain('Disable built-in skills')
    expect(enHtml).toContain('aria-label="Factory Droid CLI"')
    expect(enHtml).toContain('aria-label="Reasoning effort"')
    expect(enHtml).not.toContain('>xhigh<')
    expect(zhHtml).toContain('已校验的 Factory Droid CLI 运行时。')
    expect(zhHtml).toContain('推理强度')
    expect(zhHtml).toContain('极高')
    expect(zhHtml).toContain('Factory 设置覆盖')
    expect(zhHtml).toContain('禁用内置技能')
    expect(zhHtml).toContain('aria-label="推理强度"')
  })

  it('opens a runtime adapter account when its config schema is unavailable', () => {
    const onChange = vi.fn()
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {},
        unknownSchema: {
          fields: []
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{}}
        onChange={onChange}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'codex',
          nestedPath: ['accounts', 'work']
        }}
        t={t}
      />
    )

    expect(html).toContain('adapter-account-manager__state')
    expect(html).not.toContain('config-view__complex-editor')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the JSON fallback for an unknown adapter without an account route', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {},
        unknownSchema: {
          fields: []
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{
          custom: {
            enabled: true
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'custom'
        }}
        t={t}
      />
    )

    expect(html).toContain('config-view__complex-editor')
    expect(html).not.toContain('adapter-account-manager__')
  })

  it('renders a schema-driven adapter detail route as a second-level config page', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {
          codex: {
            fields: [
              {
                path: ['experimentalApi'],
                type: 'boolean',
                label: 'Experimental API',
                defaultValue: false
              },
              {
                path: ['maxOutputTokens'],
                type: 'number',
                label: 'Max Output Tokens',
                defaultValue: 4096
              }
            ]
          }
        },
        unknownSchema: {
          fields: [
            {
              path: ['defaultModel'],
              type: 'string',
              label: 'Default Model',
              defaultValue: ''
            }
          ]
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{
          codex: {
            experimentalApi: true,
            maxOutputTokens: 2048
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'codex',
          nestedPath: ['advanced']
        }}
        t={t}
      />
    )

    expect(html).toContain('Experimental API')
    expect(html).toContain('Max Output Tokens')
    expect(html).toContain('data-node-key="base"')
    expect(html).toContain('data-node-key="advanced"')
    expect(html).not.toContain('config-view__detail-list')
  })

  it('renders Codex built-in model sharing as one boolean switch without connection fields', () => {
    const uiSection: ConfigUiSection = {
      key: 'adapters',
      kind: 'recordMap',
      recordMap: {
        mode: 'keyed',
        keyPlaceholder: 'Adapter key',
        schemas: {
          codex: {
            fields: [{
              path: ['shareBuiltinModels'],
              type: 'boolean',
              label: 'Share built-in models',
              defaultValue: false
            }]
          }
        },
        unknownSchema: { fields: [] },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='adapters'
        uiSection={uiSection}
        value={{ codex: {} }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'codex'
        }}
        t={t}
      />
    )

    expect(html).toContain('Share built-in models')
    expect(html).toContain('ant-switch')
    expect(html).not.toContain('Host')
    expect(html).not.toContain('Port')
    expect(html).not.toContain('Token')
  })

  it('renders schema-driven channel entries as a navigable summary list', () => {
    const uiSection: ConfigUiSection = {
      key: 'channels',
      kind: 'recordMap',
      recordMap: {
        mode: 'discriminated',
        keyPlaceholder: 'Channel name',
        discriminatorField: 'type',
        entryKinds: [
          {
            key: 'lark',
            label: 'Lark'
          },
          {
            key: 'wechat',
            label: 'WeChat',
            description: 'Wechat channel'
          }
        ],
        schemas: {
          lark: {
            fields: [
              {
                path: ['type'],
                type: 'select',
                options: [{ value: 'lark' }],
                defaultValue: 'lark'
              },
              {
                path: ['appId'],
                type: 'string',
                label: 'App ID',
                defaultValue: ''
              },
              {
                path: ['appSecret'],
                type: 'string',
                label: 'App Secret',
                defaultValue: ''
              }
            ]
          }
        },
        unknownSchema: {
          fields: []
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='channels'
        uiSection={uiSection}
        value={{
          teamChat: {
            type: 'lark',
            appId: 'cli_123',
            appSecret: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('teamChat')
    expect(html).toContain('action-search-toolbar')
    expect(html).toContain('channel-collection__grid')
    expect(html).toContain('channel-collection__icon')
    expect(html).toContain('assets/brand/channels/wechat.svg')
    expect(html).toContain('config.channels.status.configured')
    expect(html).toContain('config.channels.status.unconfigured')
    expect(html).toContain('config.channels.filters.configured')
    expect(html).toContain('config.channels.filters.unconfigured')
  })

  it('renders a schema-driven channel detail route as a second-level config page', () => {
    const uiSection: ConfigUiSection = {
      key: 'channels',
      kind: 'recordMap',
      recordMap: {
        mode: 'discriminated',
        keyPlaceholder: 'Channel name',
        discriminatorField: 'type',
        entryKinds: [
          {
            key: 'lark',
            label: 'Lark'
          }
        ],
        schemas: {
          lark: {
            fields: [
              {
                path: ['type'],
                type: 'select',
                options: [{ value: 'lark' }],
                defaultValue: 'lark'
              },
              {
                path: ['appId'],
                type: 'string',
                label: 'App ID',
                defaultValue: ''
              },
              {
                path: ['appSecret'],
                type: 'string',
                label: 'App Secret',
                defaultValue: ''
              }
            ]
          }
        },
        unknownSchema: {
          fields: []
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='channels'
        uiSection={uiSection}
        value={{
          teamChat: {
            type: 'lark',
            appId: 'cli_123',
            appSecret: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'teamChat'
        }}
        t={t}
      />
    )

    expect(html).toContain('App ID')
    expect(html).toContain('App Secret')
    expect(html).not.toContain('config-view__detail-list')
  })

  it('groups channel details into route-backed native tabs and preserves default-enabled semantics', () => {
    const uiSection: ConfigUiSection = {
      key: 'channels',
      kind: 'recordMap',
      recordMap: {
        mode: 'discriminated',
        keyPlaceholder: 'Channel name',
        discriminatorField: 'type',
        entryKinds: [{ key: 'lark', label: 'Lark' }],
        schemas: {
          lark: {
            fields: [
              {
                path: ['type'],
                type: 'select',
                options: [{ value: 'lark' }],
                defaultValue: 'lark'
              },
              {
                path: ['enabled'],
                type: 'boolean',
                label: 'Enabled'
              },
              {
                path: ['appId'],
                type: 'string',
                label: 'App ID',
                defaultValue: ''
              },
              {
                path: ['access'],
                type: 'json',
                label: 'Access'
              },
              {
                path: ['systemPrompt'],
                type: 'multiline',
                label: 'System prompt'
              }
            ]
          }
        },
        unknownSchema: { fields: [] },
        unknownEditor: 'json'
      }
    }
    const commonProps = {
      sectionKey: 'channels',
      uiSection,
      value: {
        teamChat: {
          type: 'lark',
          appId: 'cli_123'
        }
      },
      onChange: () => undefined,
      mergedModelServices: {},
      mergedAdapters: {},
      t
    }
    const overviewHtml = renderToStaticMarkup(
      <SectionForm
        {...commonProps}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'teamChat',
          nestedPath: ['overview']
        }}
      />
    )
    const connectionHtml = renderToStaticMarkup(
      <SectionForm
        {...commonProps}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'teamChat',
          nestedPath: ['connection']
        }}
      />
    )

    expect(overviewHtml).toContain('native-tabs')
    expect(overviewHtml).toContain('config.channels.tabs.overview')
    expect(overviewHtml).toContain('config.channels.tabs.connection')
    expect(overviewHtml).toContain('config.channels.tabs.access')
    expect(overviewHtml).toContain('config.channels.tabs.behavior')
    expect(overviewHtml).toContain('ant-switch-checked')
    expect(overviewHtml).not.toContain('App ID')
    expect(connectionHtml).toContain('App ID')
    expect(connectionHtml).not.toContain('Enabled')
  })

  it('renders channel-type runtime-default switches without overriding explicit false values', () => {
    const uiSection: ConfigUiSection = {
      key: 'channels',
      kind: 'recordMap',
      recordMap: {
        mode: 'discriminated',
        keyPlaceholder: 'Channel name',
        discriminatorField: 'type',
        entryKinds: [
          { key: 'qq-channel', label: 'QQ Channel' },
          { key: 'wechat', label: 'WeChat' }
        ],
        schemas: {
          'qq-channel': {
            fields: [
              {
                path: ['type'],
                type: 'select',
                options: [{ value: 'qq-channel' }],
                defaultValue: 'qq-channel'
              },
              {
                path: ['verifyWebhookSignature'],
                type: 'boolean',
                label: 'Verify webhook signature'
              },
              {
                path: ['verifyWebhookAppId'],
                type: 'boolean',
                label: 'Verify webhook app ID'
              }
            ]
          },
          wechat: {
            fields: [
              {
                path: ['type'],
                type: 'select',
                options: [{ value: 'wechat' }],
                defaultValue: 'wechat'
              },
              {
                path: ['autoRegisterCallback'],
                type: 'boolean',
                label: 'Auto-register callback'
              },
              {
                path: ['autoReconnectOnStart'],
                type: 'boolean',
                label: 'Auto-reconnect on start'
              }
            ]
          }
        },
        unknownSchema: { fields: [] },
        unknownEditor: 'json'
      }
    }
    const renderConnection = (itemKey: string, item: Record<string, unknown>) =>
      renderToStaticMarkup(
        <SectionForm
          sectionKey='channels'
          uiSection={uiSection}
          value={{ [itemKey]: item }}
          onChange={() => undefined}
          mergedModelServices={{}}
          mergedAdapters={{}}
          detailRoute={{
            kind: 'detailCollectionItem',
            fieldPath: [],
            itemKey,
            nestedPath: ['connection']
          }}
          t={t}
        />
      )

    const qqHtml = renderConnection('qq', { type: 'qq-channel' })
    const wechatHtml = renderConnection('wechat', { type: 'wechat' })
    const disabledWechatHtml = renderConnection('wechat', {
      type: 'wechat',
      autoRegisterCallback: false
    })

    expect(qqHtml.match(/ant-switch-checked/g)).toHaveLength(2)
    expect(wechatHtml.match(/ant-switch-checked/g)).toHaveLength(1)
    expect(disabledWechatHtml).not.toContain('ant-switch-checked')
  })

  it('renders unknown channel detail routes with the JSON fallback editor', () => {
    const uiSection: ConfigUiSection = {
      key: 'channels',
      kind: 'recordMap',
      recordMap: {
        mode: 'discriminated',
        keyPlaceholder: 'Channel name',
        discriminatorField: 'type',
        entryKinds: [],
        schemas: {},
        unknownSchema: {
          fields: []
        },
        unknownEditor: 'json'
      }
    }

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='channels'
        uiSection={uiSection}
        value={{
          customChat: {
            type: 'custom-channel',
            customFlag: true
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'customChat'
        }}
        t={t}
      />
    )

    expect(html).toContain('config-view__complex-editor')
    expect(html).not.toContain('App ID')
  })

  it('renders detail-collection list fields as a navigable summary list', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='general'
        value={{
          recommendedModels: [
            {
              service: 'gpt-responses',
              model: 'gpt-5.4',
              title: 'Fast Default',
              description: 'Recommended for daily work',
              placement: 'modelSelector'
            }
          ]
        }}
        onChange={() => undefined}
        mergedModelServices={{
          'gpt-responses': {
            title: 'GPT Responses',
            models: ['gpt-5.4']
          }
        }}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('Fast Default')
    expect(html).toContain('Recommended for daily work')
    expect(html).toContain('config-view__detail-list')
  })

  it('renders conversation presets and built-in actions as searchable card collections', () => {
    const conversationFields = configSchema.conversation ?? []
    const startupPresets = conversationFields.find(field => field.path[0] === 'startupPresets')
    const builtinActions = conversationFields.find(field => field.path[0] === 'builtinActions')
    expect(startupPresets).toBeDefined()
    expect(builtinActions).toBeDefined()

    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='conversation'
        fields={[startupPresets!, builtinActions!]}
        value={{
          startupPresets: [{
            description: 'Investigate a regression before changing code',
            mode: 'default',
            title: 'Bug fix'
          }],
          builtinActions: [{
            description: 'Prepare the release scope and checks',
            mode: 'default',
            prompt: 'Prepare release notes',
            title: 'Release'
          }]
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('conversation-template-collection')
    expect(html).toContain('config-record-collection')
    expect(html).toContain('action-search-toolbar--flush')
    expect(html).toContain('drag_indicator')
    expect(html).toContain('Bug fix')
    expect(html).toContain('Release')
    expect(html).not.toContain('config-view__field-row--stacked')
  })

  it('renders a detail-collection list item route as a second-level config page', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='general'
        value={{
          recommendedModels: [
            {
              service: 'gpt-responses',
              model: 'gpt-5.4',
              title: 'Fast Default',
              description: 'Recommended for daily work',
              placement: 'modelSelector'
            }
          ]
        }}
        onChange={() => undefined}
        mergedModelServices={{
          'gpt-responses': {
            title: 'GPT Responses',
            models: ['gpt-5.4']
          }
        }}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: ['recommendedModels'],
          itemKey: '0'
        }}
        t={t}
      />
    )

    expect(html).toContain('config.fields.general.recommendedModels.item.model.label')
    expect(html).toContain('config.fields.general.recommendedModels.item.description.label')
    expect(html).not.toContain('config-view__detail-list')
  })

  it('renders detail-collection record fields as a navigable summary list', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='general'
        value={{
          notifications: {
            events: {
              completed: {
                title: 'All done',
                sound: '/tmp/done.mp3'
              }
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('completed')
    expect(html).toContain('All done')
    expect(html).toContain('config-view__detail-list')
  })

  it('renders a detail-collection record item route as a second-level config page', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='general'
        value={{
          notifications: {
            events: {
              completed: {
                title: 'All done',
                description: 'Done description',
                sound: '/tmp/done.mp3'
              }
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: ['notifications', 'events'],
          itemKey: 'completed'
        }}
        t={t}
      />
    )

    expect(html).toContain('config.fields.general.notifications.events.item.title.label')
    expect(html).toContain('config.fields.general.notifications.events.item.description.label')
    expect(html).not.toContain('config-view__detail-list')
  })

  it('renders model services as searchable configured and available card groups', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          openai: {
            provider: 'openai',
            title: 'OpenAI',
            apiKey: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('model-service-collection__toolbar')
    expect(html).toContain('config.modelServices.collection.searchPlaceholder')
    expect(html).toContain('config.modelServices.collection.groups.configured')
    expect(html).toContain('config.modelServices.collection.groups.available')
    expect(html).toContain('model-service-collection__card--configured')
    expect(html).toContain('model-service-collection__card--available')
    expect(html).toContain('config.modelServices.collection.states.configured')
    expect(html).toContain('config.modelServices.collection.states.available')
    expect(html).toContain('config.modelServices.collection.states.configuredCount')
    expect(html).toContain('config.modelServices.collection.types.api')
  })

  it('renders model service detail collections as route-backed native tabs', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          openai: {
            provider: 'openai',
            title: 'OpenAI',
            description: 'Primary service',
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'secret',
            models: ['gpt-5.4']
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'openai'
        }}
        t={t}
      />
    )

    expect(html).toContain('config.fields.modelServices.item.provider.label')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('config.modelServices.detailTabs.ariaLabel')
    expect(html).toContain('>独立服务</span>')
    expect(html).toContain('config.modelServices.standalone.upgradeDescription')
    expect(html).toContain('config.modelServices.standalone.upgradeAction')
    expect(html).toContain('>接入配置</span>')
    expect(html).toContain('>模型配置</span>')
    expect(html).toContain('>套餐信息</span>')
    expect(html).toContain('config-view__model-service-actions--compact')
    expect(html).not.toContain('config-view__model-service-action-title')
    expect(html).toContain('config.modelServices.actions.openApiKeys')
    expect(html).toContain('config.modelServices.actions.more')
    expect(html).not.toContain('config.fields.modelServices.item.apiKey.label')

    const accessHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          openai: {
            provider: 'openai',
            title: 'OpenAI',
            description: 'Primary service',
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'secret',
            models: ['gpt-5.4']
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'openai',
          nestedPath: ['access']
        }}
        t={t}
      />
    )

    expect(accessHtml).toContain('aria-selected="true"')
    expect(accessHtml).toContain('config.fields.modelServices.item.apiKey.label')
    expect(accessHtml).toContain('config.fields.modelServices.item.apiBaseUrl.label')
  })

  it('routes relay management fields to a dedicated task tab', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          relay: {
            provider: 'openrouter',
            management: {
              enabled: true,
              apiKey: 'management-secret'
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'relay',
          nestedPath: ['management']
        }}
        t={t}
      />
    )

    expect(html).toContain('>管理接口</span>')
    expect(html).toContain('config.fields.modelServices.item.management.enabled.label')
    expect(html).toContain('config.fields.modelServices.item.management.apiKey.label')
    expect(html).not.toContain('config.fields.modelServices.item.apiKey.label')
  })

  it('renders collection profiles as route-backed task tabs', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          gateway: {
            kind: 'collection',
            title: 'Gateway collection',
            profiles: {
              primary: {
                title: 'Primary profile',
                apiBaseUrl: 'https://gateway.example/v1',
                apiKey: 'profile-secret',
                models: ['gpt-5.4']
              }
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'gateway',
          nestedPath: ['profiles', 'primary', 'access']
        }}
        t={t}
      />
    )

    expect(html).toContain('config.modelServices.profileTabs.ariaLabel')
    expect(html).toContain('>服务信息</span>')
    expect(html).toContain('>接入配置</span>')
    expect(html).toContain('>模型配置</span>')
    expect(html).toContain('config.fields.modelServices.item.apiBaseUrl.label')
    expect(html).toContain('config.fields.modelServices.item.apiKey.label')
    expect(html).not.toContain('config.fields.modelServices.item.title.label')
  })

  it('keeps Provider-level actions off the collection root and renders them on Profile rows', () => {
    const value = {
      deepseek: {
        kind: 'collection',
        provider: 'deepseek',
        profiles: {
          default: {
            apiKey: 'profile-secret',
            title: 'Default profile'
          }
        }
      }
    }
    const rootHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={value}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'deepseek'
        }}
        t={t}
      />
    )
    const profilesHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={value}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'deepseek',
          nestedPath: ['profiles']
        }}
        t={t}
      />
    )

    expect(rootHtml).not.toContain('config-view__model-service-actions')
    expect(profilesHtml).toContain('model-service-profile-collection')
    expect(profilesHtml).toContain('config-record-collection__grid')
    expect(profilesHtml).toContain('config.modelServices.profiles.searchPlaceholder')
    expect(profilesHtml).toContain('config.modelServices.profiles.add')
    expect(profilesHtml).toContain('config-view__model-service-list-tray')
    expect(profilesHtml).toContain('config-view__model-service-list-tray--overlay-actions')
    expect(profilesHtml).toContain('config-view__model-service-list-actions')
    expect(profilesHtml).toContain('config-view__model-service-record-actions')
    expect(profilesHtml).toContain('config-view__model-service-list-quota--list')
    expect(profilesHtml).not.toContain('model-service-profile-collection__aside')
    expect(profilesHtml).toContain('config.modelServices.actions.openApiKeys')
    expect(profilesHtml).toContain('config.modelServices.actions.more')
    expect(profilesHtml.indexOf('config.editor.remove')).toBeLessThan(
      profilesHtml.indexOf('config.modelServices.actions.more')
    )
  })

  it('opens adapter model service import from the shared toolbar', () => {
    const importAdapters = [
      {
        adapterKey: 'codex',
        runtimeAdapter: 'codex',
        title: 'Codex config.toml'
      },
      {
        adapterKey: 'nativeImport',
        description: 'Acme provider settings',
        runtimeAdapter: '@acme/adapter-native-import',
        title: 'Acme native config'
      }
    ]
    const importAction = {
      actionLabel: 'Import model services from Codex config.toml',
      adapters: importAdapters,
      buttonLabel: 'Import',
      emptyLabel: 'No import adapters',
      mobileTitle: 'Select import adapter',
      onAdapterChange: () => undefined,
      onClick: () => undefined,
      placeholder: 'Select adapter',
      selectedAdapterKey: 'codex',
      selectLabel: 'Model service import adapter'
    }
    const globalHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          kimi: {
            provider: 'openai-compatible',
            title: 'Kimi'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        modelServiceImportAction={importAction}
        t={t}
      />
    )
    const loadingHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        modelServiceImportAction={{ ...importAction, loading: true }}
        t={t}
      />
    )
    const userHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        modelServiceImportAction={{
          ...importAction,
          disabled: true,
          onClick: undefined,
          title: 'Select Global or Project.'
        }}
        t={t}
      />
    )
    const customHtml = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{}}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        modelServiceImportAction={{
          ...importAction,
          actionLabel: 'Import model services from Acme native config',
          selectedAdapterKey: 'nativeImport'
        }}
        t={t}
      />
    )

    expect(globalHtml).not.toContain('config-view__adapter-import-row')
    expect(globalHtml).not.toContain('config-view__adapter-import-toolbar-control')
    expect(globalHtml).toContain('aria-label="Import model services from Codex config.toml"')
    expect(globalHtml).not.toContain('config-view__adapter-import-selected')
    expect(globalHtml).not.toContain('<span>Import</span>')
    expect(globalHtml).toContain('file_download')
    expect(globalHtml).toContain('config.modelServices.collection.actions.addCustom')
    expect(globalHtml.indexOf('action-search-toolbar__search')).toBeLessThan(
      globalHtml.indexOf('file_download')
    )
    expect(globalHtml.indexOf('file_download')).toBeLessThan(
      globalHtml.indexOf('config-view__record-card')
    )
    expect(customHtml).toContain('aria-label="Import model services from Acme native config"')
    expect(loadingHtml).toContain('ant-btn-loading')
    expect(userHtml).toContain('disabled=""')
  })

  it('groups model service detail fields by function', () => {
    const itemFields = configSchema.modelServices?.[0]?.detailCollection?.itemFields ?? []
    const groupFor = (path: string) => itemFields.find(field => field.path.join('.') === path)?.group
    const resolvedGroupFor = (path: string, currentValue: unknown, currentResolvedValue?: unknown) => {
      const field = itemFields.find(field => field.path.join('.') === path)
      return field?.resolveGroup?.({ currentValue, currentResolvedValue }) ?? field?.group
    }

    expect(configGroupOrder.modelServices).toEqual([
      'profile',
      'access',
      'providerAccess',
      'customization',
      'models',
      'profiles',
      'management',
      'plan',
      'advanced',
      'default'
    ])
    expect(configGroupMeta.modelServices?.profile).toMatchObject({
      labelKey: 'config.sectionGroups.profile',
      defaultExpanded: true
    })
    expect(configGroupMeta.modelServices?.access).toMatchObject({
      labelKey: 'config.sectionGroups.access',
      defaultExpanded: true
    })
    expect(configGroupMeta.modelServices?.providerAccess).toMatchObject({
      labelKey: 'config.sectionGroups.providerAccess',
      defaultExpanded: false
    })
    expect(configGroupMeta.modelServices?.customization).toMatchObject({
      labelKey: 'config.sectionGroups.customization',
      defaultExpanded: false
    })
    expect(configGroupMeta.modelServices?.models).toMatchObject({
      labelKey: 'config.sectionGroups.models',
      defaultExpanded: false
    })
    expect(configGroupMeta.modelServices?.profiles).toMatchObject({
      labelKey: 'config.sectionGroups.profiles',
      defaultExpanded: true
    })
    expect(configGroupMeta.modelServices?.management).toMatchObject({
      labelKey: 'config.sectionGroups.management',
      defaultExpanded: false
    })
    expect(configGroupMeta.modelServices?.plan).toMatchObject({
      labelKey: 'config.sectionGroups.plan',
      defaultExpanded: false
    })
    expect(configGroupMeta.modelServices?.advanced).toMatchObject({
      labelKey: 'config.sectionGroups.advanced',
      defaultExpanded: false
    })

    expect(groupFor('provider')).toBe('profile')
    expect(groupFor('title')).toBe('profile')
    expect(groupFor('description')).toBe('profile')
    expect(groupFor('icon')).toBe('customization')
    expect(groupFor('homepageUrl')).toBe('customization')
    expect(groupFor('apiBaseUrl')).toBe('access')
    expect(groupFor('apiProtocol')).toBe('access')
    expect(resolvedGroupFor('apiBaseUrl', { provider: 'kimi-code' })).toBe('providerAccess')
    expect(resolvedGroupFor('apiBaseUrl', {}, { provider: 'kimi-code' })).toBe('providerAccess')
    expect(resolvedGroupFor('apiBaseUrl', {})).toBe('access')
    expect(groupFor('apiKey')).toBe('access')
    expect(groupFor('models')).toBe('models')
    expect(groupFor('profiles')).toBe('profiles')
    expect(groupFor('management.enabled')).toBe('management')
    expect(groupFor('management.apiKey')).toBe('management')
    expect(groupFor('management.headers')).toBe('management')
    expect(groupFor('billing')).toBe('plan')
    expect(groupFor('codingPlan')).toBe('plan')
    expect(groupFor('providerOptions')).toBe('advanced')
    expect(groupFor('timeoutMs')).toBe('advanced')
    expect(groupFor('maxOutputTokens')).toBe('advanced')
    expect(groupFor('extra')).toBe('advanced')

    const protocolField = itemFields.find(field => field.path.join('.') === 'apiProtocol')
    expect(protocolField?.options?.map(option => option.value)).toEqual([
      '',
      'openai-responses',
      'openai-chat-completions',
      'anthropic-messages',
      'gemini-generate-content',
      'gemini-interactions'
    ])
  })

  it('renders Coding Plan service details without expanding the full plan metadata inline', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          qwen: {
            provider: 'qwen-coding-plan',
            apiKey: 'sk-sp-token'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'qwen'
        }}
        t={t}
      />
    )

    expect(html).toContain('Alibaba Coding Plan')
    expect(html).toContain('>接入配置</span>')
    expect(html).toContain('>套餐信息</span>')
    expect(html).not.toContain('https://coding.dashscope.aliyuncs.com/apps/anthropic')
  })

  it('keeps API base URL visible for custom model services without a provider', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          custom: {
            title: 'Custom',
            apiBaseUrl: 'https://example.com/v1',
            apiKey: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'custom',
          nestedPath: ['access']
        }}
        t={t}
      />
    )

    expect(html).toContain('config.fields.modelServices.item.apiBaseUrl.label')
    expect(html).toContain('config.fields.modelServices.item.apiProtocol.label')
    expect(html).toContain('https://example.com/v1')
  })

  it('creates model service entries without default apiBaseUrl or models overrides', () => {
    const modelServicesField = configSchema.modelServices?.[0]
    const item = modelServicesField?.detailCollection?.createItem?.('kimi')

    expect(item).toMatchObject({
      title: '',
      description: '',
      apiKey: '',
      timeoutMs: undefined,
      maxOutputTokens: undefined,
      extra: {}
    })
    expect(item).not.toHaveProperty('apiBaseUrl')
    expect(item).not.toHaveProperty('models')
  })

  it('creates Provider profile containers without removing the independent service path', () => {
    const modelServicesField = configSchema.modelServices?.[0]
    const detailCollection = modelServicesField?.detailCollection
    expect(detailCollection?.collectionKind).toBe('recordMap')
    if (detailCollection?.collectionKind !== 'recordMap') throw new Error('Expected record-map model services')
    const provider = detailCollection.createItem?.('deepseek', 'provider')
    const service = detailCollection.createItem?.('deepseek-2', 'service')

    expect(detailCollection.createKinds).toEqual([
      { key: 'provider', labelKey: 'config.modelServices.createKinds.provider' },
      { key: 'service', labelKey: 'config.modelServices.createKinds.service' }
    ])
    expect(provider).toMatchObject({
      kind: 'collection',
      profiles: {
        default: {
          extra: {}
        }
      }
    })
    expect(service).toMatchObject({ apiKey: '' })
    expect(service).not.toHaveProperty('profiles')
  })

  it('promotes a standalone service without changing its credential values', () => {
    const provider = promoteModelServiceToProvider({
      provider: 'deepseek',
      title: 'DeepSeek',
      apiBaseUrl: 'https://api.deepseek.com',
      apiKey: 'secret',
      models: ['deepseek-chat'],
      extra: { region: 'cn' }
    })

    expect(provider).toEqual({
      provider: 'deepseek',
      title: 'DeepSeek',
      kind: 'collection',
      profiles: {
        default: {
          apiBaseUrl: 'https://api.deepseek.com',
          apiKey: 'secret',
          models: ['deepseek-chat'],
          extra: { region: 'cn' }
        }
      }
    })
  })

  it('keeps the standalone service when creating its Provider migration copy', () => {
    const standalone = {
      provider: 'deepseek',
      apiKey: 'legacy-key'
    }
    const result = createProviderCopyFromModelService({
      existingKeys: new Set(['deepseek', 'deepseek-provider']),
      modelServices: { deepseek: standalone },
      service: standalone,
      serviceKey: 'deepseek'
    })

    expect(result.providerKey).toBe('deepseek-provider-2')
    expect(result.modelServices.deepseek).toBe(standalone)
    expect(result.modelServices['deepseek-provider-2']).toEqual({
      provider: 'deepseek',
      kind: 'collection',
      profiles: {
        default: {
          apiKey: 'legacy-key'
        }
      }
    })
  })

  it('falls back to provider descriptions in model service summaries', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          deepseek: {
            provider: 'deepseek',
            apiKey: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('Official DeepSeek OpenAI-compatible API service.')
  })

  it('uses semantic service types instead of record keys as summary subtitles', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          'kimi-code': {
            provider: 'kimi-code',
            title: 'Kimi Code',
            apiKey: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('Kimi Code')
    expect(html).toContain('Kimi Code membership benefit endpoint for coding agents.')
    expect(html).toContain('config.modelServices.collection.types.codingPlan')
    expect(html).not.toContain('<div class="config-view__record-subtitle">kimi-code</div>')
  })

  it('renders balance previews for every configured provider that supports balance queries', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          deepseek: {
            provider: 'deepseek',
            apiKey: 'secret'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('config-view__model-service-list-quota')
    expect(html).toContain('model-service-collection__quota-footer')
    expect(html).toContain('config-view__model-service-list-quota-value')
    expect(html).not.toContain('config-view__model-service-list-quota-circle')
  })

  it('renders a per-profile quota summary for Provider collections', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          deepseek: {
            kind: 'collection',
            provider: 'deepseek',
            profiles: {
              personal: {
                apiKey: 'personal-key',
                title: 'Personal'
              },
              work: {
                apiKey: 'work-key',
                title: 'Work'
              }
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('config-view__model-service-profile-quota-summary')
    expect(html).toContain('Personal')
    expect(html).toContain('Work')
    expect(html.match(/class="config-view__model-service-list-quota(?:\s|")/gu)).toHaveLength(2)
    expect(html).toContain('config-view__model-service-list-quota--list')
    expect(html).not.toContain('config-view__model-service-list-quota-circle')
  })

  it('renders inherited detail-collection entries as readonly summaries in source views', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{}}
        resolvedValue={{
          openai: {
            title: 'OpenAI',
            description: 'Inherited service'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        t={t}
      />
    )

    expect(html).toContain('OpenAI')
    expect(html).toContain('config.modelServices.collection.states.inherited')
  })

  it('renders inherited detail routes as readonly pages with an explicit override action', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{}}
        resolvedValue={{
          openai: {
            title: 'OpenAI',
            description: 'Inherited service',
            apiBaseUrl: 'https://api.openai.com/v1'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'openai',
          nestedPath: ['access']
        }}
        t={t}
      />
    )

    expect(html).toContain('config.detail.inheritedReadonly')
    expect(html).toContain('config.detail.override')
    expect(html).toContain('config.fields.modelServices.item.apiBaseUrl.label')
  })

  it('renders local detail overrides with inherited field context', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          openai: {
            apiBaseUrl: 'https://proxy.internal/v1'
          }
        }}
        resolvedValue={{
          openai: {
            title: 'OpenAI',
            description: 'Inherited service',
            apiBaseUrl: 'https://proxy.internal/v1'
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: [],
          itemKey: 'openai'
        }}
        t={t}
      />
    )

    expect(html).toContain('config.detail.partialOverride')
    expect(html).toContain('config.fields.modelServices.item.title.label')
    expect(html).toContain('config.fields.modelServices.item.description.label')
  })

  it('renders mcp server detail collections as second-level config pages', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='mcp'
        value={{
          mcpServers: {
            filesystem: {
              enabled: true,
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem']
            }
          }
        }}
        onChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        detailRoute={{
          kind: 'detailCollectionItem',
          fieldPath: ['mcpServers'],
          itemKey: 'filesystem'
        }}
        t={t}
      />
    )

    expect(html).toContain('config.fields.mcpServer.command.label')
    expect(html).toContain('config.fields.mcpServer.args.label')
  })

  it('serializes detail-collection routes into query-friendly paths', () => {
    const route = {
      kind: 'detailCollectionItem' as const,
      fieldPath: ['recommendedModels'],
      itemKey: '2'
    }

    const raw = serializeConfigDetailRoute(route)

    expect(raw).toBe('recommendedModels/2')
    expect(parseConfigDetailRoute({ fields: configSchema.general, raw })).toEqual(route)
  })

  it('serializes object-backed detail-collection routes into query-friendly paths', () => {
    const route = {
      kind: 'detailCollectionItem' as const,
      fieldPath: ['notifications', 'events'],
      itemKey: 'completed'
    }

    const raw = serializeConfigDetailRoute(route)

    expect(raw).toBe('notifications/events/completed')
    expect(parseConfigDetailRoute({ fields: configSchema.general, raw })).toEqual(route)
  })

  it('serializes root detail-collection routes into query-friendly paths', () => {
    const route = {
      kind: 'detailCollectionItem' as const,
      fieldPath: [],
      itemKey: 'codex'
    }

    const raw = serializeConfigDetailRoute(route)

    expect(raw).toBe('codex')
    expect(parseConfigDetailRoute({ fields: configSchema.adapters, raw })).toEqual(route)
  })

  it('serializes route-backed channel tabs into replayable paths', () => {
    const route = {
      kind: 'detailCollectionItem' as const,
      fieldPath: [],
      itemKey: 'teamChat',
      nestedPath: ['connection']
    }

    const raw = serializeConfigDetailRoute(route)

    expect(raw).toBe('teamChat/connection')
    expect(parseConfigDetailRoute({ fields: configSchema.channels, raw })).toEqual(route)
  })
})
