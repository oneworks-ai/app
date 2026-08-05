// @vitest-environment happy-dom
/* eslint-disable max-lines -- confirmation and workspace-scoped config regressions share one card fixture. */
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigResponse } from '@oneworks/types'

import {
  PluginMarketplaceLanding,
  resolveMarketplacePluginInstallIdentity
} from '#~/components/plugins/PluginMarketplaceLanding'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const testState = vi.hoisted(() => ({
  catalog: { plugins: [], sources: [], versionGeneration: 'generation' } as Record<string, unknown>,
  confirm: vi.fn(),
  confirmConfig: undefined as Record<string, unknown> | undefined,
  config: { sources: {} } as ConfigResponse | undefined,
  configFetcher: undefined as (() => Promise<ConfigResponse>) | undefined,
  configKey: undefined as unknown,
  getPlan: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutateCatalog: vi.fn(),
  mutateConfig: vi.fn(),
  refreshPlugins: vi.fn(),
  syncSelection: vi.fn(),
  uninstall: vi.fn()
}))

vi.mock('antd', () => {
  const Form = ({ children }: { children?: ReactNode }) => <form>{children}</form>
  Form.Item = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  Form.useForm = () => [{ resetFields: vi.fn(), validateFields: vi.fn() }]
  return {
    App: {
      useApp: () => ({
        message: { error: testState.messageError, success: testState.messageSuccess },
        modal: { confirm: testState.confirm }
      })
    },
    Button: ({ children, icon, loading: _loading, ...props }: {
      children?: ReactNode
      icon?: ReactNode
      loading?: boolean
      [key: string]: unknown
    }) => <button {...props}>{icon}{children}</button>,
    Empty: () => null,
    Form,
    Input: () => null,
    Modal: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Spin: () => null,
    Switch: () => null,
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'pluginStore.uninstall.projectScope') {
        return `${key}:${String(values?.marketplace)}:${String(values?.plugin)}`
      }
      if (key === 'pluginStore.uninstall.title') {
        return `${key}:${String(values?.name)}`
      }
      return key
    }
  })
}))

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

vi.mock('#~/api.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/api.js')>(),
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
  updateConfig: vi.fn()
}))

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
  listPluginMarketplaceCatalog: vi.fn(),
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: testState.syncSelection,
  uninstallPluginMarketplacePlugin: testState.uninstall
}))

vi.mock('#~/utils/model-provider-icons', () => ({
  renderIconRef: () => null
}))

let container: HTMLDivElement
let root: Root | undefined

const renderLanding = async () => {
  await act(async () => {
    root!.render(
      <PluginMarketplaceLanding
        onOpenPlugin={vi.fn()}
        onPluginsChanged={testState.refreshPlugins}
        onQueryChange={vi.fn()}
        query=''
        serverBaseUrl='https://workspace.example'
      />
    )
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

describe('marketplace card managed uninstall confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    testState.confirm.mockImplementation((config: Record<string, unknown>) => {
      testState.confirmConfig = config
      return { destroy: vi.fn(), update: vi.fn() }
    })
    testState.mutateCatalog.mockResolvedValue(undefined)
    testState.mutateConfig.mockResolvedValue(undefined)
    testState.refreshPlugins.mockResolvedValue(undefined)
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

  it('retains success when deferred refresh removes its own authoritative card identity', async () => {
    let resolveCatalog: (() => void) | undefined
    let resolveConfig: (() => void) | undefined
    testState.mutateCatalog.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCatalog = resolve
      })
    )
    testState.mutateConfig.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConfig = resolve
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
