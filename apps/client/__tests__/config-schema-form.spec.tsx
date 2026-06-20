/* eslint-disable max-lines -- config form coverage is intentionally consolidated in one spec file */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { ConfigUiSection } from '@oneworks/types'

import { SectionForm } from '#~/components/config/ConfigSectionForm'
import { parseConfigDetailRoute, serializeConfigDetailRoute } from '#~/components/config/configDetail'
import { configGroupMeta, configGroupOrder, configSchema } from '#~/components/config/configSchema'
import { editableConfigSectionKeys } from '#~/components/config/editableConfigSections'

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

    expect(html).toContain('Custom Adapter')
    expect(html).toContain('config-view__detail-list')
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
          itemKey: 'codex'
        }}
        t={t}
      />
    )

    expect(html).toContain('Experimental API')
    expect(html).toContain('Max Output Tokens')
    expect(html).not.toContain('config-view__detail-list')
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
    expect(html).toContain('config-view__detail-list')
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

  it('renders model service detail collections as second-level config pages', () => {
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
    expect(html).toContain('data-node-key="access"')
    expect(html).toContain('data-node-key="models"')
    expect(html).toContain('data-node-key="plan"')
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

    expect(accessHtml).toContain('config.fields.modelServices.item.apiKey.label')
    expect(accessHtml).toContain('config.fields.modelServices.item.apiBaseUrl.label')
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

    expect(html).toContain('config.options.modelProviders.qwen-coding-plan')
    expect(html).toContain('data-node-key="access"')
    expect(html).toContain('data-node-key="plan"')
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

  it('does not render model service keys as summary subtitles when a title exists', () => {
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
    expect(html).not.toContain('config-view__record-subtitle')
  })

  it('renders coding plan quota previews in model service summaries', () => {
    const html = renderToStaticMarkup(
      <SectionForm
        sectionKey='modelServices'
        value={{
          kimi: {
            provider: 'kimi-code',
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
    expect(html.match(/config-view__model-service-list-quota-circle/gu)).toHaveLength(2)
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
    expect(html).toContain('config.detail.inheritedBadge')
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
})
