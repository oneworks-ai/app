// @vitest-environment happy-dom
/* eslint-disable max-lines -- confirmation and workspace-scoped config regressions share one card fixture. */
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigResponse, PluginMarketplaceCatalogResponse, PluginRuntimeInstance } from '@oneworks/types'

import type { MarketplacePluginSelectionController } from '#~/components/plugins/@core/marketplace-plugin-selection'
import { useMarketplacePluginSelection } from '#~/components/plugins/@hooks/use-marketplace-plugin-selection'
import {
  PluginMarketplaceLanding,
  resolveMarketplacePluginInstallIdentity
} from '#~/components/plugins/PluginMarketplaceLanding'
import {
  claimMarketplaceConvergenceAuthority,
  claimMarketplaceSelectionIntentAuthority,
  listMarketplaceSelectionAuthorities,
  publishMarketplaceSelectionAuthority,
  resolveMarketplaceServerKey,
  settleMarketplaceConvergence,
  subscribeMarketplaceSelectionAuthorities
} from '#~/plugins/marketplace-mutation-authority'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const testState = vi.hoisted(() => ({
  catalog: { plugins: [], sources: [], versionGeneration: 'generation' } as Record<string, unknown>,
  confirm: vi.fn(),
  confirmConfig: undefined as Record<string, unknown> | undefined,
  config: { sources: {} } as ConfigResponse | undefined,
  configFetcher: undefined as (() => Promise<ConfigResponse>) | undefined,
  configKey: undefined as unknown,
  formReset: vi.fn(),
  formValidate: vi.fn(),
  getConfig: vi.fn(),
  getPlan: vi.fn(),
  instances: [] as PluginRuntimeInstance[],
  listCatalog: vi.fn(),
  locale: 'en' as 'en' | 'zh',
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  mutateCatalog: vi.fn(),
  mutateConfig: vi.fn(),
  refreshPlugins: vi.fn(),
  selectionError: vi.fn(),
  selectionPromise: undefined as Promise<void> | undefined,
  selectionSuccess: vi.fn(),
  serverBaseUrl: 'https://workspace.example',
  sourceModalProps: undefined as Record<string, unknown> | undefined,
  syncSelection: vi.fn(),
  uninstall: vi.fn(),
  updateConfig: vi.fn()
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  const Form = ({ children }: { children?: ReactNode }) => <form>{children}</form>
  Form.Item = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  Form.useForm = () => [{ resetFields: testState.formReset, validateFields: testState.formValidate }]
  return {
    App: {
      useApp: () => ({
        message: {
          error: testState.messageError,
          info: testState.messageInfo,
          success: testState.messageSuccess
        },
        modal: { confirm: testState.confirm }
      })
    },
    Button: actual.Button,
    Empty: () => null,
    Form,
    Input: () => null,
    Modal: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
      testState.sourceModalProps = props
      return <div>{children}</div>
    },
    Spin: () => null,
    Switch: actual.Switch,
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const enLocale = (await import('#~/resources/locales/en.json')).default
  const zhLocale = (await import('#~/resources/locales/zh.json')).default
  return {
    ...actual,
    useTranslation: () => {
      const locale = testState.locale === 'en'
        ? enLocale
        : zhLocale
      const interpolate = (template: string, values?: Record<string, unknown>) =>
        template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? ''))
      return {
        t: (key: string, values?: Record<string, unknown>) => {
          if (key === 'pluginStore.uninstall.projectScope') {
            return `${key}:${String(values?.marketplace)}:${String(values?.plugin)}`
          }
          if (key === 'pluginStore.uninstall.title') {
            return `${key}:${String(values?.name)}`
          }
          if (key === 'pluginStore.uninstall.indeterminate') {
            return locale.pluginStore.uninstall.indeterminate
          }
          if (key === 'pluginStore.disableMarketplaceSourceNamed') {
            return interpolate(locale.pluginStore.disableMarketplaceSourceNamed, values)
          }
          if (key === 'pluginStore.enableMarketplaceSourceNamed') {
            return interpolate(locale.pluginStore.enableMarketplaceSourceNamed, values)
          }
          if (key === 'pluginStore.removeMarketplaceSourceNamed') {
            return interpolate(locale.pluginStore.removeMarketplaceSourceNamed, values)
          }
          if (key === 'pluginStore.marketplaceSourceDisambiguated') {
            return interpolate(locale.pluginStore.marketplaceSourceDisambiguated, values)
          }
          return key
        },
        i18n: { resolvedLanguage: testState.locale }
      }
    }
  }
})

vi.mock('swr', () => ({
  default: (key: unknown, fetcher?: () => Promise<ConfigResponse>) => {
    if (Array.isArray(key) && key[0] === '/api/config') {
      testState.configKey = key
      testState.configFetcher = fetcher
    }
    return {
      data: Array.isArray(key) && key[0] === '/api/config'
        ? testState.config
        : Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog'
        ? testState.catalog
        : undefined,
      isLoading: false,
      mutate: Array.isArray(key) && key[0] === '/api/config'
        ? testState.mutateConfig
        : Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog'
        ? testState.mutateCatalog
        : vi.fn()
    }
  }
}))

vi.mock('#~/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/api.js')>()
  return {
    ...actual,
    getConfig: (...args: Parameters<typeof actual.getConfig>) =>
      testState.config == null ? actual.getConfig(...args) : testState.getConfig(...args),
    getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
    updateConfig: testState.updateConfig
  }
})

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbar: ({ actions }: {
    actions: Array<{ ariaLabel: string; key: string; onClick: () => void }>
  }) => (
    <div>
      {actions.map(action => (
        <button aria-label={action.ariaLabel} key={action.key} onClick={action.onClick}>
          {action.key}
        </button>
      ))}
    </div>
  )
}))

vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ name }: { name: string }) => <span>{name}</span>
}))

vi.mock('#~/components/marketplace/MarketplaceCard', () => ({
  MarketplaceCapabilityTags: () => null,
  MarketplaceCard: ({ actions, description, footer, subtitle, title }: {
    actions: ReactNode
    description?: ReactNode
    footer?: ReactNode
    subtitle?: ReactNode
    title: ReactNode
  }) => (
    <div>
      <span>{title}</span>
      <span>{subtitle}</span>
      <span>{description}</span>
      <span>{footer}</span>
      {actions}
    </div>
  )
}))

vi.mock('#~/components/marketplace/MarketplaceResults', () => ({
  MarketplaceResults: ({ items, renderItem }: {
    items: unknown[]
    renderItem: (item: unknown) => ReactNode
  }) => <>{items.map((item, index) => <div key={index}>{renderItem(item)}</div>)}</>
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => null
}))

vi.mock('#~/plugins/marketplace-api', () => ({
  getPluginMarketplaceUninstallPlan: testState.getPlan,
  listPluginMarketplaceCatalog: testState.listCatalog,
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: testState.syncSelection,
  uninstallPluginMarketplacePlugin: testState.uninstall
}))

vi.mock('#~/utils/model-provider-icons', () => ({
  renderIconRef: () => null
}))

let container: HTMLDivElement
let root: Root | undefined
let unsubscribeSelectionAuthority: (() => void) | undefined

const renderLanding = async () => {
  await act(async () => {
    root!.render(
      <PluginMarketplaceLanding
        marketplaceSelection={{
          getState: (plugin, target) => ({
            installed: target === 'global'
              ? plugin.installedSources?.includes('global') === true
              : plugin.installedSources?.some(source => source === 'project' || source === 'user') === true,
            pending: false
          }),
          toggle: async () => undefined
        }}
        onOpenPlugin={vi.fn()}
        onPluginsChanged={testState.refreshPlugins}
        onQueryChange={vi.fn()}
        query=''
        runtimeInstances={testState.instances}
        serverBaseUrl={testState.serverBaseUrl}
      />
    )
  })
}

const MarketplaceSelectionLandingHarness = () => {
  const selection = useMarketplacePluginSelection({
    catalog: testState.catalog as unknown as PluginMarketplaceCatalogResponse,
    contextKey: 'marketplace-landing',
    loadCatalog: async () => testState.listCatalog(),
    mutateCatalog: testState.mutateCatalog,
    onError: testState.selectionError,
    onSuccess: testState.selectionSuccess,
    refreshPlugins: testState.refreshPlugins,
    serverBaseUrl: testState.serverBaseUrl,
    syncSelection: testState.syncSelection
  })
  const marketplaceSelection: MarketplacePluginSelectionController = {
    getState: selection.getState,
    toggle: (plugin, target) => {
      const pending = selection.toggle(plugin, target)
      testState.selectionPromise = pending
      return pending
    }
  }
  return (
    <PluginMarketplaceLanding
      marketplaceSelection={marketplaceSelection}
      onOpenPlugin={vi.fn()}
      onPluginsChanged={testState.refreshPlugins}
      onQueryChange={vi.fn()}
      query=''
      runtimeInstances={testState.instances}
      serverBaseUrl={testState.serverBaseUrl}
    />
  )
}

const renderLandingWithSelection = async () => {
  await act(async () => {
    root!.render(<MarketplaceSelectionLandingHarness />)
  })
}

const getConfirmCallback = (name: 'onCancel' | 'onOk') => {
  const callback = testState.confirmConfig?.[name]
  if (typeof callback !== 'function') throw new Error(`Expected modal ${name} callback`)
  return callback as () => Promise<void> | void
}

const clickRemove = async () => {
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="pluginStore.removeMarketplacePlugin"]'
  )
  if (button == null) throw new Error('Expected marketplace card Remove action')
  await act(async () => {
    button.click()
  })
}

const getSourceRemoveButtons = () => [
  ...container.querySelectorAll<HTMLButtonElement>(
    '.plugin-marketplace__source-actions button:not([role="switch"])'
  )
]

describe('marketplace card managed uninstall confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.formReset.mockReset()
    testState.locale = 'en'
    testState.formValidate.mockReset()
    testState.selectionPromise = undefined
    testState.formValidate.mockResolvedValue({ types: ['codex'], url: 'https://example.invalid/source.git' })
    testState.instances = []
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: true,
                plugins: { airtable: { enabled: true, scope: 'airtable-runtime' } },
                type: 'codex'
              }
            }
          }
        }
      }
    }
    testState.catalog = {
      plugins: [{
        builtIn: true,
        declared: true,
        displayName: 'Airtable',
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceTitle: 'OpenAI plugins',
        marketplaceType: 'codex',
        name: 'airtable',
        sourceLabel: './plugins/airtable',
        sourceType: 'git-subdir'
      }],
      sources: [],
      versionGeneration: 'generation'
    }
    testState.confirmConfig = undefined
    testState.sourceModalProps = undefined
    testState.serverBaseUrl = 'https://workspace.example'
    testState.confirm.mockImplementation((config: Record<string, unknown>) => {
      testState.confirmConfig = config
      return { destroy: vi.fn(), update: vi.fn() }
    })
    testState.mutateCatalog.mockResolvedValue(undefined)
    testState.mutateConfig.mockResolvedValue(undefined)
    testState.getConfig.mockImplementation(async () => testState.config)
    testState.listCatalog.mockImplementation(async () => testState.catalog)
    testState.refreshPlugins.mockResolvedValue({ applied: true })
    testState.updateConfig.mockResolvedValue(undefined)
    testState.getPlan.mockResolvedValue({
      available: true,
      deleteItems: ['project-marketplace-declaration', 'project-runtime-override', 'managed-install'],
      identity: {
        adapter: 'codex',
        marketplace: 'openai-plugins',
        plugin: 'airtable',
        scope: 'airtable-runtime'
      },
      retainItems: ['global-config', 'sibling-plugins'],
      token: 'a'.repeat(64)
    })
    testState.uninstall.mockResolvedValue({ identity: {}, removed: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    unsubscribeSelectionAuthority?.()
    unsubscribeSelectionAuthority = undefined
    if (root != null) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = undefined
    container.remove()
    vi.unstubAllGlobals()
  })

  it('opens the danger confirmation and Cancel performs no quote, toggle, attempt, or removal', async () => {
    await renderLanding()
    await clickRemove()

    expect(testState.confirmConfig).toMatchObject({
      autoFocusButton: 'cancel',
      okButtonProps: { danger: true }
    })
    await getConfirmCallback('onCancel')()
    expect(testState.getPlan).not.toHaveBeenCalled()
    expect(testState.syncSelection).not.toHaveBeenCalled()
    expect(testState.uninstall).not.toHaveBeenCalled()
  })

  it('uses the exact managed runtime scope for an omitted-scope Claude marketplace install', async () => {
    const marketplace = 'claude-plugins-official'
    const plugin = 'agent-sdk-dev'
    const scope = 'claude-claude-plugins-official-agent-sd-57d7f45af4cc574479565430'
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              [marketplace]: {
                enabled: true,
                plugins: { [plugin]: { enabled: true } },
                type: 'claude-code'
              }
            }
          }
        }
      }
    }
    testState.catalog = {
      plugins: [{
        builtIn: true,
        configSource: 'project',
        declared: true,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace,
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: plugin,
        sourceLabel: './plugins/agent-sdk-dev',
        sourceType: 'directory'
      }],
      sources: [],
      versionGeneration: 'generation'
    }
    testState.instances = [{
      enabled: true,
      name: plugin,
      packageId: `${plugin}@${marketplace}`,
      requestId: `${plugin}@${marketplace}`,
      scope,
      source: {
        adapter: 'claude',
        kind: 'marketplace',
        marketplace,
        plugin
      },
      sourceGroup: 'project',
      watch: { enabled: false }
    }]
    testState.getPlan.mockResolvedValue({
      available: true,
      deleteItems: ['project-marketplace-declaration', 'managed-install'],
      identity: { adapter: 'claude', marketplace, plugin, scope },
      retainItems: ['global-config', 'sibling-plugins'],
      token: 'e'.repeat(64)
    })
    await renderLanding()

    await clickRemove()
    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.getPlan).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.uninstall).toHaveBeenCalledWith(
      scope,
      'e'.repeat(64),
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
  })

  it.each(
    [
      ['en', [
        'Disable plugin source source=[private] stable (source 1)',
        'Disable plugin source source=[private] other',
        'Enable plugin source source=[private] stable (source 2)'
      ], [
        'Remove plugin source source=[private] stable (source 1)',
        'Remove plugin source source=[private] other',
        'Remove plugin source source=[private] stable (source 2)'
      ]],
      ['zh', [
        '停用插件源 source=[private] stable（源 1）',
        '停用插件源 source=[private] other',
        '启用插件源 source=[private] stable（源 2）'
      ], [
        '移除插件源 source=[private] stable（源 1）',
        '移除插件源 source=[private] other',
        '移除插件源 source=[private] stable（源 2）'
      ]]
    ] as const
  )('keeps privacy-safe source control names local and stable in %s', async (
    locale,
    switchNames,
    removeNames
  ) => {
    const sourceEntry = {
      enabled: true,
      options: { source: { source: 'git' as const, url: 'https://example.invalid/source.git' } },
      type: 'codex' as const
    }
    testState.locale = locale
    testState.config = {
      sources: {
        merged: {
          plugins: {
            marketplaces: {
              'source=/private/a stable': sourceEntry,
              'source=/private/az other': sourceEntry,
              'source=/private/b stable': { ...sourceEntry, enabled: false }
            }
          }
        },
        user: {
          plugins: {
            marketplaces: {
              'source=/private/a stable': sourceEntry,
              'source=/private/az other': sourceEntry,
              'source=/private/b stable': { ...sourceEntry, enabled: false }
            }
          }
        }
      }
    }
    testState.catalog = { plugins: [], sources: [], versionGeneration: 'generation' }
    await renderLanding()
    const configure = container.querySelector<HTMLButtonElement>('[aria-label="pluginStore.marketplaceConfig"]')
    if (configure == null) throw new Error('Expected marketplace config action')
    await act(async () => configure.click())

    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
    expect(switches).toHaveLength(3)
    expect(switches.map(item => item.getAttribute('aria-label'))).toEqual(switchNames)
    expect(new Set(switchNames).size).toBe(3)
    expect(switches.every(item => item.tagName === 'BUTTON')).toBe(true)
    expect(switches.map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false'])
    const removeButtons = getSourceRemoveButtons()
    expect(removeButtons.map(item => item.getAttribute('aria-label'))).toEqual(removeNames)
    expect(new Set(removeNames).size).toBe(3)
    expect(removeButtons.every(item => item.tagName === 'BUTTON')).toBe(true)
    expect(container.textContent).not.toContain('/private/a')
    expect(container.textContent).not.toContain('/private/b')

    const stableMarketplaces = {
      'source=/private/a stable': sourceEntry,
      'source=/private/b stable': { ...sourceEntry, enabled: false }
    }
    testState.config = {
      sources: {
        merged: { plugins: { marketplaces: stableMarketplaces } },
        user: { plugins: { marketplaces: stableMarketplaces } }
      }
    }
    await renderLanding()
    const remainingNames = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
      .map(item => item.getAttribute('aria-label'))
    expect(remainingNames).toEqual([switchNames[0], switchNames[2]])
    expect(getSourceRemoveButtons().map(item => item.getAttribute('aria-label'))).toEqual([
      removeNames[0],
      removeNames[2]
    ])
  })

  it('projects danger-dialog text while preserving the exact authoritative card identity', async () => {
    const marketplaceSentinel = 'synthetic-credential-marketplace-sentinel'
    const pluginSentinel = 'synthetic-private-plugin-sentinel'
    const marketplace = `credential://${marketplaceSentinel}:secret@public.invalid/catalog`
    const plugin = `/synthetic-private-root/${pluginSentinel}`
    const scope = 'synthetic-card-scope'
    const catalogPlugin = {
      builtIn: true,
      declared: true,
      displayName: 'Synthetic card plugin',
      enabled: true,
      installable: true,
      installedSources: ['project' as const],
      marketplace,
      marketplaceEnabled: true,
      marketplaceTitle: 'Synthetic catalog',
      marketplaceType: 'codex' as const,
      name: plugin,
      sourceLabel: './plugins/synthetic',
      sourceType: 'git-subdir' as const
    }
    testState.catalog = {
      plugins: [catalogPlugin],
      sources: [],
      versionGeneration: 'generation'
    }
    testState.config = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              [marketplace]: {
                enabled: true,
                plugins: { [plugin]: { enabled: true, scope } },
                type: 'codex'
              }
            }
          }
        }
      }
    }
    const rawIdentity = {
      adapter: 'codex' as const,
      marketplace,
      plugin,
      scope
    }
    testState.getPlan.mockResolvedValue({
      available: true,
      deleteItems: ['managed-install'],
      identity: rawIdentity,
      retainItems: ['sibling-plugins'],
      token: 'd'.repeat(64)
    })

    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      catalogPlugin,
      'project'
    )).toEqual(rawIdentity)
    await renderLanding()
    await clickRemove()

    const content = renderToStaticMarkup(testState.confirmConfig?.content as ReactNode)
    expect(`${String(testState.confirmConfig?.title)}${content}`).not.toContain(marketplaceSentinel)
    expect(`${String(testState.confirmConfig?.title)}${content}`).not.toContain(pluginSentinel)
    expect(content).toContain('[private]')
    await getConfirmCallback('onCancel')()
    expect(testState.getPlan).not.toHaveBeenCalled()

    await clickRemove()
    await act(async () => {
      await getConfirmCallback('onOk')()
    })
    expect(testState.getPlan).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.uninstall).toHaveBeenCalledWith(
      scope,
      'd'.repeat(64),
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
  })

  it('enables removal from the workspace-scoped public config envelope', async () => {
    const config = testState.config
    testState.config = undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url !== 'https://workspace.example/api/config') {
        throw new Error(`Unexpected config URL: ${url}`)
      }
      return new Response(JSON.stringify({ success: true, data: config }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('__ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__', false)
    vi.stubGlobal('fetch', fetchMock)
    await renderLanding()

    expect(testState.configKey).toEqual(['/api/config', 'https://workspace.example'])
    if (testState.configFetcher == null) throw new Error('Expected workspace config fetcher')
    testState.config = await testState.configFetcher()
    await renderLanding()

    const removeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="pluginStore.removeMarketplacePlugin"]'
    )
    expect(removeButton?.disabled).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://workspace.example/api/config',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('fails closed for disabled, shadowed, or wrong-format project declarations', () => {
    const config: ConfigResponse = {
      sources: {
        project: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: false,
                plugins: { airtable: { enabled: true, scope: 'victim' } },
                type: 'codex'
              }
            }
          }
        },
        user: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: true,
                plugins: { airtable: { enabled: true, scope: 'airtable-runtime' } },
                type: 'codex'
              }
            }
          }
        }
      }
    }
    const item = {
      builtIn: true,
      declared: true,
      enabled: true,
      installedSources: ['project' as const],
      marketplace: 'openai-plugins',
      marketplaceEnabled: true,
      marketplaceType: 'codex' as const,
      name: 'airtable'
    }

    expect(resolveMarketplacePluginInstallIdentity(
      config,
      item,
      'project'
    )).toBeUndefined()
    expect(resolveMarketplacePluginInstallIdentity(
      {
        sources: {
          project: {
            plugins: {
              marketplaces: {
                'openai-plugins': {
                  enabled: true,
                  plugins: { airtable: { enabled: true, scope: 'victim' } },
                  type: 'claude-code'
                }
              }
            }
          }
        }
      },
      item,
      'project'
    )).toBeUndefined()
    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      { ...item, installedSources: ['user'] },
      'project'
    )).toBeUndefined()
    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      { ...item, builtIn: false, configSource: 'user' },
      'project'
    )).toBeUndefined()
    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      { ...item, builtIn: false, configSource: 'global' },
      'project'
    )).toBeUndefined()
    for (const shadowSource of ['global', 'user'] as const) {
      expect(resolveMarketplacePluginInstallIdentity(
        {
          sources: {
            project: {
              plugins: {
                marketplaces: {
                  'openai-plugins': {
                    enabled: true,
                    plugins: { airtable: { enabled: true, scope: 'airtable-runtime' } },
                    type: 'codex'
                  }
                }
              }
            },
            [shadowSource]: {
              plugins: {
                marketplaces: {
                  'openai-plugins': {
                    enabled: true,
                    plugins: { airtable: { enabled: true, scope: 'airtable-runtime' } },
                    type: 'codex'
                  }
                }
              }
            }
          }
        },
        {
          ...item,
          configSource: 'project',
          installedSources: shadowSource === 'global'
            ? ['global', 'project']
            : ['project', 'user']
        },
        'project'
      )).toBeUndefined()
    }
    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      { ...item, enabled: false },
      'project'
    )).toBeUndefined()
    expect(resolveMarketplacePluginInstallIdentity(
      testState.config,
      { ...item, builtIn: false, configSource: 'project' },
      'project'
    )).toMatchObject({
      marketplace: 'openai-plugins',
      plugin: 'airtable',
      scope: 'airtable-runtime'
    })
  })

  it('rejects a quoted plan whose identity does not match the card tuple', async () => {
    testState.getPlan.mockResolvedValueOnce({
      available: true,
      deleteItems: [],
      identity: {
        adapter: 'codex',
        marketplace: 'other',
        plugin: 'victim',
        scope: 'airtable-runtime'
      },
      retainItems: [],
      token: 'b'.repeat(64)
    })
    await renderLanding()
    await clickRemove()

    await expect(act(async () => getConfirmCallback('onOk')())).rejects.toThrow(
      'pluginStore.uninstall.failed'
    )
    expect(testState.uninstall).not.toHaveBeenCalled()
    expect(testState.syncSelection).not.toHaveBeenCalled()
  })

  it('only removes after explicit confirmation and remains retryable after an error', async () => {
    testState.uninstall
      .mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce({ identity: {}, removed: true })
    await renderLanding()
    await clickRemove()
    const onOk = getConfirmCallback('onOk')

    let failure: unknown
    await act(async () => {
      try {
        await onOk()
      } catch (error) {
        failure = error
      }
    })
    expect(failure).toEqual(new Error('request failed'))
    expect(testState.messageError).toHaveBeenCalledWith('request failed')
    expect(testState.syncSelection).not.toHaveBeenCalled()

    await act(async () => {
      await onOk()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(2)
    expect(testState.getPlan).toHaveBeenCalledTimes(2)
    expect(testState.uninstall).toHaveBeenLastCalledWith(
      'airtable-runtime',
      'a'.repeat(64),
      expect.objectContaining({ serverBaseUrl: 'https://workspace.example' })
    )
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
  })

  it('keeps one card uninstall owned while the same tuple rerenders', async () => {
    let resolveUninstall: (() => void) | undefined
    testState.uninstall.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUninstall = () => resolve({ identity: {}, removed: true })
      })
    )
    await renderLanding()
    await clickRemove()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await vi.waitFor(() => expect(testState.uninstall).toHaveBeenCalledTimes(1))
    })

    await renderLanding()
    const removalButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="pluginStore.removeMarketplacePlugin"]'
    )
    expect(removalButton?.disabled).toBe(true)
    await act(async () => {
      removalButton?.click()
    })
    expect(testState.confirm).toHaveBeenCalledTimes(1)
    expect(testState.getPlan).toHaveBeenCalledTimes(1)
    expect(testState.uninstall).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveUninstall?.()
      await pending
    })
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
  })

  it('reconciles a committed card removal after the destructive response is lost', async () => {
    testState.uninstall.mockImplementationOnce(async () => {
      testState.config = { sources: { project: { plugins: { marketplaces: {} } } } }
      const currentCatalog = testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }
      testState.catalog = {
        ...currentCatalog,
        plugins: currentCatalog.plugins.map(item => ({ ...item, installedSources: [] }))
      }
      throw new TypeError('Failed to fetch')
    })
    await renderLanding()
    await clickRemove()

    await act(async () => {
      await getConfirmCallback('onOk')()
    })

    expect(testState.uninstall).toHaveBeenCalledTimes(1)
    expect(testState.getConfig).toHaveBeenCalledTimes(1)
    expect(testState.listCatalog).toHaveBeenCalledTimes(1)
    expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
    expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    expect(testState.messageError).not.toHaveBeenCalled()

    await renderLanding()
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="pluginStore.installMarketplacePluginProject"]'
      )?.disabled
    ).toBe(false)
  })

  it('waits for a delayed server commit instead of retrying after installed roots race a lost response', async () => {
    vi.useFakeTimers()
    try {
      const installedConfig = testState.config!
      const installedCatalog = testState.catalog
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...(testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }),
        plugins: (testState.catalog as { plugins: Array<Record<string, unknown>> }).plugins.map(item => ({
          ...item,
          installedSources: []
        }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig
        .mockResolvedValueOnce(installedConfig)
        .mockResolvedValueOnce(removedConfig)
      testState.listCatalog
        .mockResolvedValueOnce(installedCatalog)
        .mockResolvedValueOnce(removedCatalog)
      await renderLanding()
      await clickRemove()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      expect(testState.getConfig).toHaveBeenCalledTimes(1)
      expect(testState.listCatalog).toHaveBeenCalledTimes(1)
      expect(testState.messageInfo).toHaveBeenCalledWith(
        'Plugin removal status is still syncing with the server. ' +
          'The action will remain unavailable until the authoritative state is confirmed.'
      )
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.uninstall).toHaveBeenCalledTimes(1)
      expect(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="pluginStore.removeMarketplacePlugin"]'
        )?.disabled
      ).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
        await pending
      })
      expect(testState.getConfig).toHaveBeenCalledTimes(2)
      expect(testState.listCatalog).toHaveBeenCalledTimes(2)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(2)
      expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
      expect(testState.uninstall).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a response-loss card indeterminate when a newer failed round supersedes runtime apply', async () => {
    vi.useFakeTimers()
    try {
      let resolveRuntime: (() => void) | undefined
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...(testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }),
        plugins: (testState.catalog as { plugins: Array<Record<string, unknown>> }).plugins.map(item => ({
          ...item,
          installedSources: []
        }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig.mockResolvedValueOnce(removedConfig)
      testState.listCatalog.mockResolvedValueOnce(removedCatalog)
      testState.refreshPlugins.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRuntime = () => resolve({ applied: true })
        })
      )
      await renderLanding()
      await clickRemove()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
      expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)

      const newerAuthority = claimMarketplaceConvergenceAuthority(
        resolveMarketplaceServerKey(testState.serverBaseUrl)
      )
      await settleMarketplaceConvergence(newerAuthority, () => [
        Promise.reject(new Error('newer config failed')),
        Promise.reject(new Error('newer catalog failed')),
        Promise.reject(new Error('newer runtime failed'))
      ])
      await act(async () => {
        resolveRuntime?.()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="pluginStore.removeMarketplacePlugin"]'
        )?.disabled
      ).toBe(true)

      testState.serverBaseUrl = 'https://other-workspace.example/'
      await renderLanding()
      await act(async () => {
        await pending
      })
      expect(testState.uninstall).toHaveBeenCalledTimes(1)
      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a response-loss card owned when an ordinary provider refresh supersedes runtime apply', async () => {
    vi.useFakeTimers()
    try {
      let isMarketplaceRuntimeCurrent: (() => boolean) | undefined
      let resolveUninstallRuntime: (() => void) | undefined
      const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
      const removedCatalog = {
        ...(testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }),
        plugins: (testState.catalog as { plugins: Array<Record<string, unknown>> }).plugins.map(item => ({
          ...item,
          installedSources: []
        }))
      }
      testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      testState.getConfig.mockResolvedValueOnce(removedConfig)
      testState.listCatalog.mockResolvedValueOnce(removedCatalog)
      testState.refreshPlugins
        .mockImplementationOnce((options?: { isCurrent?: () => boolean }) => {
          isMarketplaceRuntimeCurrent = options?.isCurrent
          return new Promise((resolve) => {
            resolveUninstallRuntime = () => resolve({ applied: false })
          })
        })
        .mockResolvedValueOnce({ applied: true })

      await renderLanding()
      await clickRemove()
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(getConfirmCallback('onOk')())
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(isMarketplaceRuntimeCurrent?.()).toBe(true)

      await act(async () => {
        await expect(testState.refreshPlugins()).resolves.toEqual({ applied: true })
        expect(isMarketplaceRuntimeCurrent?.()).toBe(true)
        resolveUninstallRuntime?.()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      const status = container.querySelector<HTMLElement>('[role="status"]')
      expect(status?.textContent).toBe(
        'Plugin removal status is still syncing with the server. ' +
          'The action will remain unavailable until the authoritative state is confirmed.'
      )
      expect(status?.getAttribute('aria-live')).toBe('polite')
      expect(status?.getAttribute('aria-atomic')).toBe('true')
      expect(testState.messageInfo).toHaveBeenCalledTimes(1)
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="pluginStore.removeMarketplacePlugin"]'
        )?.disabled
      ).toBe(true)

      testState.serverBaseUrl = 'https://other-workspace.example/'
      await renderLanding()
      await act(async () => {
        await pending
      })
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(container.querySelector('[role="status"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(
    [
      [
        'installed roots in English',
        'en',
        'installed',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ],
      [
        'installed roots in Chinese',
        'zh',
        'installed',
        '正在与服务器核对插件移除状态；在权威状态确认前，该操作将保持不可用。'
      ],
      [
        'config removed while catalog remains installed',
        'en',
        'config-removed',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ],
      [
        'catalog removed while config remains installed',
        'en',
        'catalog-removed',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ],
      [
        'config refresh rejection',
        'en',
        'config-rejected',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ],
      [
        'catalog refresh rejection',
        'en',
        'catalog-rejected',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ],
      [
        'runtime refresh rejection',
        'en',
        'runtime-rejected',
        'Plugin removal status is still syncing with the server. ' +
        'The action will remain unavailable until the authoritative state is confirmed.'
      ]
    ] as const
  )(
    'keeps %s explicitly indeterminate until the server lifecycle changes',
    async (_label, locale, condition, expectedCopy) => {
      vi.useFakeTimers()
      try {
        testState.locale = locale
        const installedConfig = testState.config!
        const installedCatalog = testState.catalog
        const removedConfig = { sources: { project: { plugins: { marketplaces: {} } } } }
        const removedCatalog = {
          ...(testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }),
          plugins: (testState.catalog as { plugins: Array<Record<string, unknown>> }).plugins.map(item => ({
            ...item,
            installedSources: []
          }))
        }
        testState.uninstall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
        if (condition === 'config-removed') testState.getConfig.mockResolvedValueOnce(removedConfig)
        if (condition === 'catalog-removed') testState.listCatalog.mockResolvedValueOnce(removedCatalog)
        if (condition === 'config-rejected') testState.getConfig.mockRejectedValueOnce(new Error('config failed'))
        if (condition === 'catalog-rejected') testState.listCatalog.mockRejectedValueOnce(new Error('catalog failed'))
        if (condition === 'runtime-rejected') {
          testState.refreshPlugins.mockRejectedValueOnce(new Error('runtime failed'))
        }
        if (condition === 'installed' || condition === 'catalog-removed' || condition === 'catalog-rejected') {
          testState.getConfig.mockResolvedValueOnce(installedConfig)
        }
        if (condition === 'installed' || condition === 'config-removed' || condition === 'config-rejected') {
          testState.listCatalog.mockResolvedValueOnce(installedCatalog)
        }

        await renderLanding()
        await clickRemove()
        let pending: Promise<void> | undefined
        await act(async () => {
          pending = Promise.resolve(getConfirmCallback('onOk')())
          for (let index = 0; index < 8; index += 1) await Promise.resolve()
        })
        expect(testState.messageInfo).toHaveBeenCalledWith(expectedCopy)
        expect(testState.messageSuccess).not.toHaveBeenCalled()
        expect(testState.messageError).not.toHaveBeenCalled()
        expect(testState.uninstall).toHaveBeenCalledTimes(1)
        expect(
          container.querySelector<HTMLButtonElement>(
            '[aria-label="pluginStore.removeMarketplacePlugin"]'
          )?.disabled
        ).toBe(true)
        const status = container.querySelector<HTMLElement>('[role="status"]')
        expect(status?.textContent).toBe(expectedCopy)
        expect(status?.getAttribute('aria-live')).toBe('polite')
        expect(status?.getAttribute('aria-atomic')).toBe('true')

        testState.serverBaseUrl = 'https://other-workspace.example/'
        await renderLanding()
        await act(async () => {
          await pending
        })
        expect(testState.messageSuccess).not.toHaveBeenCalled()
        expect(testState.messageError).not.toHaveBeenCalled()
        expect(testState.uninstall).toHaveBeenCalledTimes(1)
        expect(container.querySelector('[role="status"]')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('retains success when deferred refresh removes its own authoritative card identity', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve(testState.catalog)
      })
    )
    testState.getConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = () => resolve(testState.config)
      })
    )
    await renderLanding()
    await clickRemove()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(1)

    testState.config = { sources: { project: { plugins: { marketplaces: {} } } } }
    testState.catalog = {
      ...(testState.catalog as { plugins: Array<Record<string, unknown>> }),
      plugins: [{
        ...((testState.catalog as { plugins: Array<Record<string, unknown>> }).plugins[0]),
        installedSources: []
      }]
    }
    await renderLanding()

    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      await pending
    })
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.uninstall.success')
    expect(testState.syncSelection).not.toHaveBeenCalled()
  })

  it('keeps committed removal disabled and suppresses stale convergence after a newer install intent', async () => {
    const serverKey = resolveMarketplaceServerKey(testState.serverBaseUrl)
    unsubscribeSelectionAuthority = subscribeMarketplaceSelectionAuthorities(serverKey, vi.fn())
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    let resolveRuntime: (() => void) | undefined
    testState.listCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = () => resolve(testState.catalog)
      })
    )
    testState.getConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = () => resolve(testState.config!)
      })
    )
    testState.refreshPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ applied: true })
      })
    )
    await renderLanding()
    await clickRemove()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testState.uninstall).toHaveBeenCalledTimes(1)
    expect(listMarketplaceSelectionAuthorities(serverKey)).toMatchObject([{ enabled: false, target: 'project' }])

    const currentCatalog = testState.catalog as { plugins: Array<Record<string, unknown>>; sources: unknown[] }
    testState.catalog = {
      ...currentCatalog,
      plugins: currentCatalog.plugins.map(item => ({ ...item, installedSources: [] }))
    }
    await renderLanding()
    const removalButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="pluginStore.removeMarketplacePlugin"]'
    )
    expect(removalButton?.disabled).toBe(true)
    removalButton?.click()
    expect(testState.syncSelection).not.toHaveBeenCalled()

    const newerIntent = claimMarketplaceSelectionIntentAuthority(serverKey, {
      marketplace: 'openai-plugins',
      plugin: 'airtable',
      target: 'project'
    })
    const newerSelection = publishMarketplaceSelectionAuthority(serverKey, {
      enabled: true,
      marketplace: 'openai-plugins',
      plugin: 'airtable',
      target: 'project'
    }, 'confirmed')
    expect(newerIntent.isCurrent()).toBe(true)
    expect(newerSelection.isCurrent()).toBe(true)

    await act(async () => {
      resolveCatalog?.()
      resolveConfig?.()
      resolveRuntime?.()
      await pending
    })
    expect(testState.mutateCatalog).not.toHaveBeenCalled()
    expect(testState.mutateConfig).not.toHaveBeenCalled()
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
    const runtimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as { isCurrent?: () => boolean } | undefined
    expect(runtimeAuthority?.isCurrent?.()).toBe(false)
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([newerSelection])
    newerIntent.release()
  })

  it('suppresses response-loss reconciliation after the same card tuple moves servers', async () => {
    let rejectUninstall: ((error: unknown) => void) | undefined
    let requestSignal: AbortSignal | undefined
    testState.uninstall.mockImplementation((
      _scope: string,
      _token: string,
      options: { signal?: AbortSignal }
    ) =>
      new Promise((_resolve, reject) => {
        requestSignal = options.signal
        rejectUninstall = reject
      })
    )
    await renderLanding()
    await clickRemove()
    let pending: Promise<void> | undefined
    await act(async () => {
      pending = Promise.resolve(getConfirmCallback('onOk')())
      await Promise.resolve()
      await Promise.resolve()
    })

    testState.serverBaseUrl = 'https://other-workspace.example/'
    await renderLanding()
    expect(requestSignal?.aborted).toBe(true)
    await act(async () => {
      rejectUninstall?.(new TypeError('Failed to fetch'))
      await pending
    })

    expect(testState.refreshPlugins).not.toHaveBeenCalled()
    expect(testState.listCatalog).not.toHaveBeenCalled()
    expect(testState.mutateCatalog).not.toHaveBeenCalled()
    expect(testState.mutateConfig).not.toHaveBeenCalled()
    expect(testState.messageSuccess).not.toHaveBeenCalled()
    expect(testState.messageError).not.toHaveBeenCalled()
  })

  it('claims config, catalog, and runtime before a source removal performs async work', async () => {
    const serverKey = resolveMarketplaceServerKey(testState.serverBaseUrl)
    const staleInstall = claimMarketplaceConvergenceAuthority(serverKey)
    unsubscribeSelectionAuthority = subscribeMarketplaceSelectionAuthorities(serverKey, vi.fn())
    publishMarketplaceSelectionAuthority(serverKey, {
      enabled: true,
      marketplace: 'team',
      plugin: 'review',
      target: 'project'
    }, 'confirmed')
    expect(listMarketplaceSelectionAuthorities(serverKey)).toHaveLength(1)
    let resolveFirstUpdate: (() => void) | undefined
    testState.updateConfig
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstUpdate = () => resolve(undefined)
        })
      )
      .mockResolvedValue(undefined)
    const sourceEntry = {
      enabled: true,
      options: { source: { source: 'git' as const, url: 'https://example.invalid/team.git' } },
      type: 'codex' as const
    }
    testState.config = {
      sources: {
        merged: { plugins: { marketplaces: { team: sourceEntry } } },
        user: { plugins: { marketplaces: { team: sourceEntry } } }
      }
    }
    testState.catalog = { plugins: [], sources: [], versionGeneration: 'generation' }
    await renderLanding()
    const configure = container.querySelector<HTMLButtonElement>('[aria-label="pluginStore.marketplaceConfig"]')
    if (configure == null) throw new Error('Expected marketplace config action')
    await act(async () => configure.click())
    const remove = getSourceRemoveButtons()[0]
    if (remove == null) throw new Error('Expected user source removal action')
    await act(async () => {
      remove.click()
      await Promise.resolve()
    })

    expect(testState.updateConfig).toHaveBeenCalledTimes(1)
    expect(staleInstall.config.isCurrent()).toBe(false)
    expect(staleInstall.catalog.isCurrent()).toBe(false)
    expect(staleInstall.runtime.isCurrent()).toBe(false)
    await act(async () => {
      resolveFirstUpdate?.()
      await vi.waitFor(() =>
        expect(testState.messageSuccess).toHaveBeenCalledWith(
          'pluginStore.marketplaceSourceRemoved'
        )
      )
    })
    expect(testState.updateConfig).toHaveBeenCalledTimes(2)
    expect(testState.refreshPlugins).toHaveBeenCalledWith({ isCurrent: expect.any(Function) })
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([])
  })

  it.each(['toggle', 'remove'] as const)(
    'reconciles authoritative roots after a failed source %s and suppresses an earlier delayed install',
    async (sourceAction) => {
      const marketplace = 'team-tools'
      const pluginName = 'review'
      const sourceEntry = {
        enabled: true,
        options: { source: { source: 'git' as const, url: 'https://example.invalid/team.git' } },
        type: 'codex' as const
      }
      const initialCatalog: PluginMarketplaceCatalogResponse = {
        plugins: [{
          declared: false,
          enabled: false,
          installable: true,
          marketplace,
          marketplaceEnabled: true,
          marketplaceTitle: 'Team tools',
          marketplaceType: 'codex',
          name: pluginName,
          sourceLabel: 'team/review',
          sourceType: 'github'
        }],
        sources: [],
        versionGeneration: 'before-install'
      }
      const authoritativeCatalog: PluginMarketplaceCatalogResponse = {
        ...initialCatalog,
        plugins: [{
          ...initialCatalog.plugins[0]!,
          declared: true,
          enabled: true,
          installedSources: ['project']
        }],
        versionGeneration: 'installed-on-server'
      }
      const initialConfig: ConfigResponse = {
        sources: {
          merged: { plugins: { marketplaces: { [marketplace]: sourceEntry } } },
          user: { plugins: { marketplaces: { [marketplace]: sourceEntry } } }
        }
      }
      const authoritativeSourceEntry = {
        ...sourceEntry,
        plugins: { [pluginName]: { enabled: true, scope: 'team-review-runtime' } }
      }
      const authoritativeConfig: ConfigResponse = {
        sources: {
          merged: { plugins: { marketplaces: { [marketplace]: authoritativeSourceEntry } } },
          user: { plugins: { marketplaces: { [marketplace]: authoritativeSourceEntry } } }
        }
      }
      let resolveInstallResponse: (() => void) | undefined
      testState.config = initialConfig
      testState.catalog = initialCatalog as unknown as Record<string, unknown>
      testState.syncSelection.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveInstallResponse = resolve
        })
      )
      testState.getConfig.mockResolvedValue(authoritativeConfig)
      testState.listCatalog.mockResolvedValue(authoritativeCatalog)
      const sourceError = new Error('source patch failed')
      testState.updateConfig.mockRejectedValueOnce(sourceError)
      if (sourceAction === 'remove') {
        testState.updateConfig.mockRejectedValueOnce(new Error('source restore failed'))
      }

      await renderLandingWithSelection()
      const install = container.querySelector<HTMLButtonElement>(
        '[aria-label="pluginStore.installMarketplacePluginProject"]'
      )
      if (install == null) throw new Error('Expected project install action')
      await act(async () => {
        install.click()
        await vi.waitFor(() => expect(testState.syncSelection).toHaveBeenCalledTimes(1))
      })
      expect(install.disabled).toBe(true)

      const configure = container.querySelector<HTMLButtonElement>(
        '[aria-label="pluginStore.marketplaceConfig"]'
      )
      if (configure == null) throw new Error('Expected marketplace config action')
      await act(async () => configure.click())
      const sourceControl = sourceAction === 'toggle'
        ? container.querySelector<HTMLButtonElement>('[role="switch"]')
        : getSourceRemoveButtons()[0]
      if (sourceControl == null) throw new Error(`Expected source ${sourceAction} action`)
      await act(async () => {
        sourceControl.click()
        await vi.waitFor(() => expect(testState.messageError).toHaveBeenCalledWith(sourceError.message))
      })

      expect(testState.updateConfig).toHaveBeenCalledTimes(sourceAction === 'remove' ? 2 : 1)
      expect(testState.getConfig).toHaveBeenCalledTimes(1)
      expect(testState.listCatalog).toHaveBeenCalledTimes(1)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
      expect(testState.mutateConfig).toHaveBeenCalledTimes(1)
      expect(testState.mutateCatalog).toHaveBeenCalledTimes(1)
      expect(testState.selectionSuccess).not.toHaveBeenCalled()
      expect(testState.selectionError).not.toHaveBeenCalled()

      const convergenceCounts = {
        catalog: testState.listCatalog.mock.calls.length,
        config: testState.getConfig.mock.calls.length,
        runtime: testState.refreshPlugins.mock.calls.length
      }
      const selectionPromise = testState.selectionPromise
      if (selectionPromise == null) throw new Error('Expected pending selection promise')

      await act(async () => {
        resolveInstallResponse?.()
        await selectionPromise
      })

      expect(testState.listCatalog).toHaveBeenCalledTimes(convergenceCounts.catalog)
      expect(testState.getConfig).toHaveBeenCalledTimes(convergenceCounts.config)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(convergenceCounts.runtime)
      expect(testState.selectionSuccess).not.toHaveBeenCalled()
      expect(testState.selectionError).not.toHaveBeenCalled()
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(listMarketplaceSelectionAuthorities(resolveMarketplaceServerKey(
        testState.serverBaseUrl
      ))).toEqual([])
      expect(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="pluginStore.installMarketplacePluginProject"]'
        )?.disabled
      ).toBe(false)

      testState.config = authoritativeConfig
      testState.catalog = authoritativeCatalog as unknown as Record<string, unknown>
      await renderLandingWithSelection()
      expect(container.querySelector(
        '[aria-label="pluginStore.removeMarketplacePlugin"]'
      )).not.toBeNull()
    }
  )

  it.each(['cancel', 'unmount'] as const)(
    'abandons deferred Add Source validation after %s',
    async (transition) => {
      let resolveValidation: ((values: Record<string, unknown>) => void) | undefined
      testState.formValidate.mockReturnValue(
        new Promise((resolve) => {
          resolveValidation = resolve
        })
      )
      await renderLanding()
      const configure = container.querySelector<HTMLButtonElement>(
        '[aria-label="pluginStore.marketplaceConfig"]'
      )
      if (configure == null) throw new Error('Expected marketplace config action')
      await act(async () => configure.click())
      const addSource = container.querySelector<HTMLButtonElement>(
        '[aria-label="pluginStore.addMarketplaceSource"]'
      )
      if (addSource == null) throw new Error('Expected Add Source action')
      await act(async () => addSource.click())
      const onOk = testState.sourceModalProps?.onOk
      const onCancel = testState.sourceModalProps?.onCancel
      if (typeof onOk !== 'function' || typeof onCancel !== 'function') {
        throw new TypeError('Expected source modal callbacks')
      }
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = Promise.resolve(onOk())
        await Promise.resolve()
      })
      expect(testState.formValidate).toHaveBeenCalledTimes(1)

      if (transition === 'cancel') {
        await act(async () => onCancel())
      } else {
        await act(async () => root?.unmount())
        root = undefined
      }
      await act(async () => {
        resolveValidation?.({
          name: 'deferred-source',
          types: ['codex'],
          url: 'https://example.invalid/deferred.git'
        })
        await pending
      })

      expect(testState.updateConfig).not.toHaveBeenCalled()
      expect(testState.getConfig).not.toHaveBeenCalled()
      expect(testState.listCatalog).not.toHaveBeenCalled()
      expect(testState.refreshPlugins).not.toHaveBeenCalled()
      expect(testState.messageSuccess).not.toHaveBeenCalled()
      expect(testState.messageError).not.toHaveBeenCalled()
      expect(testState.formReset).not.toHaveBeenCalled()
    }
  )

  it('serializes overlapping source removals and converges both confirmed overlays', async () => {
    const sourceEntry = {
      enabled: true,
      options: { source: { source: 'git' as const, url: 'https://example.invalid/source.git' } },
      type: 'codex' as const
    }
    testState.config = {
      sources: {
        merged: { plugins: { marketplaces: { alpha: sourceEntry, beta: sourceEntry } } },
        user: { plugins: { marketplaces: { alpha: sourceEntry, beta: sourceEntry } } }
      }
    }
    const serverKey = resolveMarketplaceServerKey(testState.serverBaseUrl)
    unsubscribeSelectionAuthority = subscribeMarketplaceSelectionAuthorities(serverKey, vi.fn())
    for (const marketplace of ['alpha', 'beta']) {
      publishMarketplaceSelectionAuthority(serverKey, {
        enabled: true,
        marketplace,
        plugin: 'review',
        target: 'project'
      }, 'confirmed')
    }
    let resolveAlphaRuntime: (() => void) | undefined
    testState.refreshPlugins
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveAlphaRuntime = resolve
        })
      )
      .mockResolvedValue(undefined)

    await renderLanding()
    const configure = container.querySelector<HTMLButtonElement>('[aria-label="pluginStore.marketplaceConfig"]')
    if (configure == null) throw new Error('Expected marketplace config action')
    await act(async () => configure.click())
    const removeButtons = getSourceRemoveButtons()
    expect(removeButtons).toHaveLength(2)
    await act(async () => {
      removeButtons[0]?.click()
      removeButtons[1]?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(testState.updateConfig).toHaveBeenCalledTimes(2)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    })
    expect(listMarketplaceSelectionAuthorities(serverKey)).toHaveLength(2)
    testState.config = { sources: { merged: { plugins: { marketplaces: {} } }, user: { plugins: {} } } }
    await act(async () => {
      resolveAlphaRuntime?.()
      await vi.waitFor(() => expect(testState.updateConfig).toHaveBeenCalledTimes(4))
      await vi.waitFor(() => expect(testState.refreshPlugins).toHaveBeenCalledTimes(2))
      await Promise.resolve()
    })

    expect(testState.updateConfig.mock.calls.at(-1)?.[2]).toMatchObject({ marketplaces: {} })
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([])
    expect(testState.messageSuccess).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.marketplaceSourceRemoved')
  })

  it('keeps new-server source pending when an old source mutation settles', async () => {
    const sourceEntry = {
      enabled: true,
      options: { source: { source: 'git' as const, url: 'https://example.invalid/source.git' } },
      type: 'codex' as const
    }
    const oldConfig: ConfigResponse = {
      sources: {
        merged: { plugins: { marketplaces: { alpha: sourceEntry } } },
        user: { plugins: { marketplaces: { alpha: sourceEntry } } }
      }
    }
    testState.config = oldConfig
    let resolveOldCatalog: (() => void) | undefined
    let resolveOldConfig: (() => void) | undefined
    let resolveOldRuntime: (() => void) | undefined
    let resolveNewUpdate: (() => void) | undefined
    testState.getConfig
      .mockResolvedValueOnce(oldConfig)
      .mockResolvedValueOnce(oldConfig)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldConfig = () => resolve(oldConfig)
        })
      )
    testState.listCatalog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOldCatalog = () => resolve(testState.catalog)
      })
    )
    testState.refreshPlugins.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveOldRuntime = resolve
      })
    )
    testState.updateConfig
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNewUpdate = () => resolve(undefined)
        })
      )
      .mockResolvedValue(undefined)

    await renderLanding()
    const configure = container.querySelector<HTMLButtonElement>('[aria-label="pluginStore.marketplaceConfig"]')
    if (configure == null) throw new Error('Expected marketplace config action')
    await act(async () => configure.click())
    const oldRemove = getSourceRemoveButtons()[0]
    if (oldRemove == null) throw new Error('Expected old-server source removal action')
    await act(async () => {
      oldRemove.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(testState.updateConfig).toHaveBeenCalledTimes(2)
      expect(testState.refreshPlugins).toHaveBeenCalledTimes(1)
    })

    testState.serverBaseUrl = 'https://other-workspace.example/'
    testState.config = {
      sources: {
        merged: { plugins: { marketplaces: { beta: sourceEntry } } },
        user: { plugins: { marketplaces: { beta: sourceEntry } } }
      }
    }
    await renderLanding()
    const newRemove = getSourceRemoveButtons()[0]
    if (newRemove == null) throw new Error('Expected new-server source removal action')
    await act(async () => {
      newRemove.click()
      await Promise.resolve()
    })
    expect(testState.updateConfig).toHaveBeenCalledTimes(3)
    const newSourceSwitch = container.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(newSourceSwitch?.classList.contains('ant-switch-loading')).toBe(true)
    const oldRuntimeAuthority = testState.refreshPlugins.mock.calls[0]?.[0] as {
      isCurrent?: () => boolean
    }
    expect(oldRuntimeAuthority.isCurrent?.()).toBe(false)
    const configMutationsBeforeOldSettles = testState.mutateConfig.mock.calls.length

    await act(async () => {
      resolveOldCatalog?.()
      resolveOldConfig?.()
      resolveOldRuntime?.()
      await vi.waitFor(() => expect(newSourceSwitch?.classList.contains('ant-switch-loading')).toBe(true))
    })
    expect(testState.mutateConfig).toHaveBeenCalledTimes(configMutationsBeforeOldSettles)
    expect(testState.mutateCatalog).not.toHaveBeenCalled()
    expect(newSourceSwitch?.classList.contains('ant-switch-loading')).toBe(true)
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(testState.messageSuccess).not.toHaveBeenCalled()

    await act(async () => {
      resolveNewUpdate?.()
      await vi.waitFor(() =>
        expect(testState.messageSuccess).toHaveBeenCalledWith('pluginStore.marketplaceSourceRemoved')
      )
    })
    expect(testState.messageError).not.toHaveBeenCalled()
    expect(
      container.querySelector<HTMLButtonElement>('[role="switch"]')?.classList.contains('ant-switch-loading')
    ).toBe(false)
  })

  it('projects every public catalog and source-row field before rendering', async () => {
    const sentinel = 'marketplace-envelope-private-sentinel'
    const privatePath = `/${sentinel}/plugins/tool`
    testState.catalog = {
      plugins: [{
        builtIn: true,
        declared: true,
        description: `installed at ${privatePath}`,
        displayName: privatePath,
        enabled: true,
        installable: true,
        installedSources: ['project'],
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceTitle: privatePath,
        marketplaceType: 'codex',
        name: 'airtable',
        sourceLabel: privatePath,
        sourceType: 'directory'
      }],
      sources: [{
        builtIn: true,
        entry: {
          enabled: true,
          options: { source: { path: privatePath, source: 'directory' } },
          type: 'codex'
        },
        error: `failed at ${privatePath}`,
        key: 'openai-plugins',
        pluginCount: 1,
        title: privatePath
      }],
      versionGeneration: 'generation'
    }
    testState.config = {
      sources: {
        merged: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: true,
                options: { source: { path: privatePath, source: 'directory' } },
                type: 'codex'
              }
            }
          }
        },
        project: {
          plugins: {
            marketplaces: {
              'openai-plugins': {
                enabled: true,
                plugins: { airtable: { enabled: true, scope: 'airtable-runtime' } },
                type: 'codex'
              }
            }
          }
        }
      }
    }

    await renderLanding()
    expect(container.textContent).not.toContain(sentinel)

    const configure = container.querySelector<HTMLButtonElement>('[aria-label="pluginStore.marketplaceConfig"]')
    expect(configure).not.toBeNull()
    await act(async () => configure!.click())
    expect(container.textContent).not.toContain(sentinel)
    expect(container.textContent).toContain('[private]')
  })
})
