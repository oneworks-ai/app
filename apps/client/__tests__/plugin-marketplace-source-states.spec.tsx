// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginMarketplaceLanding } from '#~/components/plugins/PluginMarketplaceLanding'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mocks = vi.hoisted(() => ({
  catalog: undefined as {
    plugins: Array<Record<string, unknown>>
    sources: Array<Record<string, unknown>>
    versionGeneration: string
  } | undefined,
  catalogError: undefined as unknown,
  catalogLoading: false,
  catalogMutate: vi.fn()
}))

vi.mock('antd', () => {
  const Form = Object.assign(({ children }: { children?: ReactNode }) => <form>{children}</form>, {
    Item: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    useForm: () => [{}]
  })
  return {
    App: { useApp: () => ({ message: { error: vi.fn(), success: vi.fn() } }) },
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type='button' onClick={onClick}>{children}</button>
    ),
    Empty: Object.assign(({ description }: { description?: ReactNode }) => <div>{description}</div>, {
      PRESENTED_IMAGE_SIMPLE: null
    }),
    Form,
    Input: () => <input />,
    Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) => open === true ? <>{children}</> : null,
    Spin: () => <span>spinner</span>,
    Switch: () => <input type='checkbox' />,
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('swr', () => ({
  default: (key: unknown) => {
    if (Array.isArray(key) && key[0] === '/api/plugins/marketplace/catalog') {
      return {
        data: mocks.catalog,
        error: mocks.catalogError,
        isLoading: mocks.catalogLoading,
        mutate: mocks.catalogMutate
      }
    }
    if (key === '/api/config') return { data: { sources: { merged: {} } }, mutate: vi.fn() }
    return { data: undefined }
  }
}))

vi.mock('#~/api.js', () => ({
  getApiErrorMessage: () => 'request failed',
  getConfig: vi.fn(),
  updateConfig: vi.fn()
}))

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbar: ({ actions }: { actions: Array<{ key: string; onClick: () => void }> }) => (
    <div>
      {actions.map(action => <button key={action.key} type='button' onClick={action.onClick}>{action.key}</button>)}
    </div>
  )
}))

vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => <span />
}))

vi.mock('#~/components/marketplace/MarketplaceCard', () => ({
  MarketplaceCapabilityTags: () => <span />,
  MarketplaceCard: () => <div />
}))

vi.mock('#~/components/marketplace/MarketplaceResults', () => ({
  MarketplaceResults: () => <div />
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => <select />
}))

vi.mock('#~/plugins/marketplace-api', () => ({
  listPluginMarketplaceCatalog: vi.fn(),
  resolvePluginMarketplaceVersions: vi.fn(),
  syncPluginMarketplaceSelection: vi.fn()
}))

vi.mock('#~/utils/model-provider-icons', () => ({
  renderIconRef: () => <span />
}))

describe('plugin marketplace source states', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    mocks.catalog = undefined
    mocks.catalogError = undefined
    mocks.catalogLoading = false
    mocks.catalogMutate.mockReset()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = undefined
    root = undefined
  })

  const renderConfigPanel = async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <PluginMarketplaceLanding
          query=''
          onOpenPlugin={vi.fn()}
          onPluginsChanged={async () => {}}
          onQueryChange={vi.fn()}
        />
      )
    })
    await act(async () => {
      container?.querySelector('button:nth-child(2)')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('shows loading instead of an empty source list before the catalog resolves', async () => {
    mocks.catalogLoading = true

    await renderConfigPanel()

    expect(container?.textContent).toContain('pluginStore.marketplaceSourcesLoading')
    expect(container?.textContent).not.toContain('pluginStore.marketplaceSourcesEmpty')
  })

  it('shows an actionable unavailable state after the catalog request fails', async () => {
    mocks.catalogError = new Error('catalog request failed')

    await renderConfigPanel()

    expect(container?.textContent).toContain('pluginStore.marketplaceSourcesUnavailable')
    expect(container?.textContent).toContain('common.retry')
    await act(async () => {
      ;[...(container?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent === 'common.retry')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.catalogMutate).toHaveBeenCalledOnce()
  })

  it('does not call an unresolved catalog with no request state empty', async () => {
    await renderConfigPanel()

    expect(container?.textContent).toContain('pluginStore.marketplaceSourcesUnavailable')
    expect(container?.textContent).not.toContain('pluginStore.marketplaceSourcesEmpty')
  })

  it('does not mask a catalog failure with cached source rows', async () => {
    mocks.catalog = {
      plugins: [],
      sources: [{
        builtIn: true,
        enabled: true,
        entry: {
          enabled: true,
          options: { source: { repo: 'openai/plugins', source: 'github' } },
          type: 'codex'
        },
        key: 'openai-plugins',
        pluginCount: 0,
        type: 'codex'
      }],
      versionGeneration: 'catalog-1'
    }
    mocks.catalogError = new Error('catalog request failed')

    await renderConfigPanel()

    expect(container?.textContent).toContain('pluginStore.marketplaceSourcesUnavailable')
    expect(container?.textContent).not.toContain('openai-plugins')
  })

  it('shows the empty state only after a successful empty catalog response', async () => {
    mocks.catalog = { plugins: [], sources: [], versionGeneration: 'catalog-1' }

    await renderConfigPanel()

    expect(container?.textContent).toContain('pluginStore.marketplaceSourcesEmpty')
    expect(container?.textContent).not.toContain('pluginStore.marketplaceSourcesUnavailable')
  })

  it('keeps a source with its catalog error visible', async () => {
    mocks.catalog = {
      plugins: [],
      sources: [{
        builtIn: true,
        enabled: true,
        entry: {
          enabled: true,
          options: { source: { repo: 'openai/plugins', source: 'github' } },
          type: 'codex'
        },
        error: 'could not load catalog',
        key: 'openai-plugins',
        pluginCount: 0,
        type: 'codex'
      }],
      versionGeneration: 'catalog-1'
    }

    await renderConfigPanel()

    expect(container?.textContent).toContain('openai-plugins')
    expect(container?.textContent).toContain('could not load catalog')
    expect(container?.textContent).not.toContain('pluginStore.marketplaceSourcesEmpty')
  })
})
