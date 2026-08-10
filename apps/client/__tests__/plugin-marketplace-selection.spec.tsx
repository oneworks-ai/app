// @vitest-environment happy-dom
/* eslint-disable max-lines -- selection races share one mounted hook fixture. */
import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { KeyedMutator } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginMarketplaceCatalogPlugin, PluginMarketplaceCatalogResponse } from '@oneworks/types'

import { ApiError } from '#~/api/base'
import { isPluginInstalledForTarget } from '#~/components/plugins/@core/marketplace-plugin-selection'
import type { MarketplacePluginSelectionController } from '#~/components/plugins/@core/marketplace-plugin-selection'
import { useMarketplacePluginSelection } from '#~/components/plugins/@hooks/use-marketplace-plugin-selection'
import {
  captureMarketplaceSelectionSupersession,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'
import type { MarketplaceConvergenceAuthority } from '#~/plugins/marketplace-mutation-authority'
import type { PluginRefreshOptions } from '#~/plugins/plugin-context'

const plugin: PluginMarketplaceCatalogPlugin = {
  declared: false,
  enabled: false,
  marketplace: 'team-tools',
  marketplaceEnabled: true,
  marketplaceTitle: 'Team tools',
  marketplaceType: 'codex',
  name: 'review',
  sourceLabel: 'team/review',
  sourceType: 'github'
}

const secondPlugin: PluginMarketplaceCatalogPlugin = {
  ...plugin,
  name: 'summarize',
  sourceLabel: 'team/summarize'
}

const createCatalog = (
  installedSources?: PluginMarketplaceCatalogPlugin['installedSources'],
  options: {
    description?: string
    secondDescription?: string
    secondInstalledSources?: PluginMarketplaceCatalogPlugin['installedSources']
    versionGeneration?: string
  } = {}
): PluginMarketplaceCatalogResponse => ({
  plugins: [{
    ...plugin,
    ...(options.description == null ? {} : { description: options.description }),
    ...(installedSources == null ? {} : { installedSources })
  }, {
    ...secondPlugin,
    ...(options.secondDescription == null ? {} : { description: options.secondDescription }),
    ...(options.secondInstalledSources == null ? {} : { installedSources: options.secondInstalledSources })
  }],
  sources: [],
  versionGeneration: options.versionGeneration ?? 'generation-1'
})

const createDeferred = <T,>() => {
  let reject!: (reason: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

const createCatalogState = (initial = createCatalog()) => {
  let catalog = initial
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (
    value?:
      | PluginMarketplaceCatalogResponse
      | Promise<PluginMarketplaceCatalogResponse | undefined>
      | ((
        current: PluginMarketplaceCatalogResponse | undefined
      ) => PluginMarketplaceCatalogResponse | Promise<PluginMarketplaceCatalogResponse | undefined> | undefined)
  ) => {
    if (typeof value === 'function') catalog = (await value(catalog)) ?? catalog
    else if (value != null) catalog = (await value) ?? catalog
    listeners.forEach(listener => listener())
    return catalog
  })
  return {
    get catalog() {
      return catalog
    },
    mutate: mutate as KeyedMutator<PluginMarketplaceCatalogResponse>,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

interface SelectionHarnessProps {
  catalogState: ReturnType<typeof createCatalogState>
  contextKey: string
  loadCatalog: () => Promise<PluginMarketplaceCatalogResponse>
  onError: (error: unknown) => void
  onSelection?: (selection: MarketplacePluginSelectionController) => void
  onSuccess: () => void
  refreshAfterSuccess?: (authority: MarketplaceConvergenceAuthority) => Promise<unknown>
  refreshPlugins: (options?: PluginRefreshOptions) => Promise<unknown>
  serverBaseUrl: string
  syncSelection: (
    marketplace: string,
    pluginName: string,
    enabled: boolean,
    target: 'global' | 'project',
    options: { serverBaseUrl?: string }
  ) => Promise<unknown>
}

function SelectionHarness(props: SelectionHarnessProps) {
  const { catalogState, onSelection, ...selectionOptions } = props
  const catalog = useSyncExternalStore(
    catalogState.subscribe,
    () => catalogState.catalog,
    () => catalogState.catalog
  )
  const currentPlugin = catalog.plugins.find(item => item.name === plugin.name)!
  const currentSecondPlugin = catalog.plugins.find(item => item.name === secondPlugin.name)!
  const selection = useMarketplacePluginSelection({
    ...selectionOptions,
    catalog,
    mutateCatalog: catalogState.mutate
  })
  onSelection?.(selection)
  const states = {
    detail: selection.getState(currentPlugin, 'project'),
    global: selection.getState(currentPlugin, 'global'),
    landing: selection.getState(currentPlugin, 'project'),
    second: selection.getState(currentSecondPlugin, 'global')
  }
  return (
    <>
      {Object.entries(states).map(([label, state]) => (
        <button
          aria-label={label}
          data-installed={state.installed}
          data-pending={state.pending}
          key={label}
          type='button'
          onClick={() =>
            void selection.toggle(
              label === 'second' ? currentSecondPlugin : currentPlugin,
              label === 'global' || label === 'second' ? 'global' : 'project'
            )}
        />
      ))}
    </>
  )
}

let container: HTMLDivElement
let root: Root
let rootMounted: boolean

const renderHarness = async (props: SelectionHarnessProps) => {
  await act(async () => root.render(<SelectionHarness {...props} />))
}

const click = async (label: string) => {
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click())
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const expectState = (label: string, installed: boolean, pending: boolean) => {
  const consumer = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(consumer?.dataset.installed).toBe(String(installed))
  expect(consumer?.dataset.pending).toBe(String(pending))
}

describe('plugin marketplace selection boundary', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount())
    container.remove()
  })

  it('deduplicates one exact operation and commits before refresh finishes', async () => {
    const apiWrite = createDeferred<unknown>()
    const catalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const runtimeRefresh = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const syncSelection = vi.fn(() => apiWrite.promise)
    await renderHarness({
      catalogState,
      contextKey: 'store',
      loadCatalog: () => catalogRefresh.promise,
      onError,
      onSuccess,
      refreshPlugins: () => runtimeRefresh.promise,
      serverBaseUrl: 'https://workspace-dedupe.example',
      syncSelection
    })

    await click('landing')
    await click('detail')
    expect(syncSelection).toHaveBeenCalledTimes(1)
    expectState('landing', false, true)
    expectState('detail', false, true)

    await act(async () => {
      apiWrite.resolve(undefined)
      await apiWrite.promise
    })
    await flushPromises()
    expectState('landing', true, false)
    expectState('detail', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(false)

    await act(async () => {
      catalogRefresh.resolve(createCatalog(['project'], { description: 'authoritative' }))
      runtimeRefresh.resolve(undefined)
      await Promise.all([catalogRefresh.promise, runtimeRefresh.promise])
    })
    await flushPromises()
    expectState('landing', true, false)
    expect(catalogState.catalog.plugins[0]).toEqual(expect.objectContaining({
      description: 'authoritative',
      marketplaceTitle: 'Team tools',
      sourceLabel: 'team/review'
    }))
  })

  it('clears failure state and allows retry', async () => {
    const catalogState = createCatalogState()
    const apiError = new ApiError(403, { code: 'permission_denied', message: 'permission denied' })
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const syncSelection = vi.fn().mockRejectedValueOnce(apiError).mockResolvedValueOnce(undefined)
    await renderHarness({
      catalogState,
      contextKey: 'store',
      loadCatalog: async () => createCatalog(['project']),
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-retry.example',
      syncSelection
    })

    await click('landing')
    await flushPromises()
    expectState('landing', false, false)
    expect(onError).toHaveBeenCalledWith(apiError)

    await click('landing')
    await flushPromises()
    expect(syncSelection).toHaveBeenCalledTimes(2)
    expectState('landing', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('keys operations by target and rejects an older catalog root', async () => {
    const firstCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const secondCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const catalogState = createCatalogState()
    const loadCatalog = vi.fn(async () => createCatalog(['project', 'global']))
      .mockImplementationOnce(() => firstCatalogRefresh.promise)
      .mockImplementationOnce(() => secondCatalogRefresh.promise)
    const syncSelection = vi.fn<SelectionHarnessProps['syncSelection']>(async () => undefined)
    await renderHarness({
      catalogState,
      contextKey: 'store',
      loadCatalog,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-targets.example',
      syncSelection
    })

    await click('landing')
    await flushPromises()
    await click('global')
    await flushPromises()
    expect(syncSelection.mock.calls.map(call => call[3])).toEqual(['project', 'global'])
    expectState('landing', true, false)
    expectState('global', true, false)

    await act(async () => {
      secondCatalogRefresh.resolve(createCatalog(['project', 'global'], {
        description: 'new',
        versionGeneration: 'generation-new'
      }))
      await secondCatalogRefresh.promise
      firstCatalogRefresh.resolve(createCatalog(undefined, {
        description: 'old',
        versionGeneration: 'generation-old'
      }))
      await firstCatalogRefresh.promise
    })
    await flushPromises()
    expect(catalogState.catalog.versionGeneration).toBe('generation-new')
    expect(catalogState.catalog.plugins[0]?.description).toBe('new')
    expectState('landing', true, false)
    expectState('global', true, false)
  })

  it('keeps every successful selection over the latest catalog root', async () => {
    const firstCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const secondCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const catalogState = createCatalogState()
    const loadCatalog = vi.fn()
      .mockImplementationOnce(() => firstCatalogRefresh.promise)
      .mockImplementationOnce(() => secondCatalogRefresh.promise)
    await renderHarness({
      catalogState,
      contextKey: 'store',
      loadCatalog,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-overlay.example',
      syncSelection: async () => undefined
    })

    await click('landing')
    await flushPromises()
    await click('second')
    await flushPromises()

    await act(async () => {
      secondCatalogRefresh.resolve(createCatalog(undefined, {
        description: 'new-a',
        secondDescription: 'new-b',
        versionGeneration: 'generation-new'
      }))
      await secondCatalogRefresh.promise
      firstCatalogRefresh.resolve(createCatalog(undefined, {
        description: 'old-a',
        secondDescription: 'old-b',
        versionGeneration: 'generation-old'
      }))
      await firstCatalogRefresh.promise
    })
    await flushPromises()

    expect(catalogState.catalog.versionGeneration).toBe('generation-new')
    expect(catalogState.catalog.plugins.map(item => item.description)).toEqual(['new-a', 'new-b'])
    expectState('landing', true, false)
    expectState('second', true, false)
  })

  it('keeps a transport-unknown commit reconciling until the exact catalog tuple matches', async () => {
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const loadCatalog = vi.fn()
      .mockResolvedValueOnce(createCatalog())
      .mockResolvedValue(createCatalog(['project']))
    const syncSelection = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await renderHarness({
      catalogState,
      contextKey: 'unknown:store',
      loadCatalog,
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-unknown.example',
      syncSelection
    })

    await click('landing')
    await flushPromises()
    expectState('landing', false, true)
    expect(onError).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()

    await click('landing')
    expect(syncSelection).toHaveBeenCalledTimes(1)

    await act(async () => {
      await catalogState.mutate(createCatalog(['project']), { revalidate: false })
    })
    await flushPromises()
    expectState('landing', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('continues confirmed convergence across a same-server scope handoff', async () => {
    const apiWrite = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onSuccess = vi.fn()
    const refreshPlugins = vi.fn(async () => undefined)
    const loadCatalog = vi.fn(async () => createCatalog(['project']))
    const props: SelectionHarnessProps = {
      catalogState,
      contextKey: 'same-server:store',
      loadCatalog,
      onError: vi.fn(),
      onSuccess,
      refreshPlugins,
      serverBaseUrl: 'https://workspace-handoff.example',
      syncSelection: () => apiWrite.promise
    }
    await renderHarness(props)
    await click('landing')

    await renderHarness({ ...props, contextKey: 'same-server:detail' })
    expectState('landing', false, true)
    await act(async () => {
      apiWrite.resolve(undefined)
      await apiWrite.promise
    })
    await flushPromises()

    expectState('landing', true, false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(loadCatalog).toHaveBeenCalledTimes(1)
    expect(refreshPlugins).toHaveBeenCalledTimes(1)
  })

  it('ignores completion from a previous server and route scope', async () => {
    const previousScopeWrite = createDeferred<unknown>()
    const currentScopeWrite = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const syncSelection = vi.fn()
      .mockImplementationOnce(() => previousScopeWrite.promise)
      .mockImplementationOnce(() => currentScopeWrite.promise)
    const props: SelectionHarnessProps = {
      catalogState,
      contextKey: 'workspace-a:store',
      loadCatalog: async () => createCatalog(['project']),
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-switch-a.example',
      syncSelection
    }
    await renderHarness(props)
    await click('landing')

    await renderHarness({
      ...props,
      contextKey: 'workspace-b:detail',
      serverBaseUrl: 'https://workspace-switch-b.example'
    })
    expectState('landing', false, false)
    await click('landing')
    expect(syncSelection).toHaveBeenCalledTimes(2)

    await act(async () => {
      previousScopeWrite.resolve(undefined)
      await previousScopeWrite.promise
    })
    await flushPromises()
    expect(catalogState.mutate).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()

    await act(async () => {
      currentScopeWrite.resolve(undefined)
      await currentScopeWrite.promise
    })
    await flushPromises()
    expectState('landing', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not write UI or caches after unmount', async () => {
    const apiWrite = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const refreshAfterSuccess = vi.fn(async () => undefined)
    await renderHarness({
      catalogState,
      contextKey: 'store',
      loadCatalog: async () => createCatalog(['project']),
      onError,
      onSuccess,
      refreshAfterSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-unmount.example',
      syncSelection: () => apiWrite.promise
    })
    await click('landing')

    await act(async () => root.unmount())
    rootMounted = false
    await act(async () => {
      apiWrite.resolve(undefined)
      await apiWrite.promise
    })
    await flushPromises()
    expect(catalogState.mutate).not.toHaveBeenCalled()
    expect(refreshAfterSuccess).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('retires 500 completed selections after source supersession and safely reuses an identity', async () => {
    const dynamicPlugins = Array.from({ length: 500 }, (_, index): PluginMarketplaceCatalogPlugin => ({
      ...plugin,
      marketplace: `marketplace-${index}`,
      name: `plugin-${index}`,
      sourceLabel: `team/plugin-${index}`
    }))
    const catalog = createCatalog()
    const catalogState = createCatalogState({
      ...catalog,
      plugins: [...catalog.plugins, ...dynamicPlugins],
      versionGeneration: 'dynamic-identities'
    })
    let selection: MarketplacePluginSelectionController | undefined
    const onSelection = (current: MarketplacePluginSelectionController) => {
      selection = current
    }
    const syncSelection = vi.fn(async () => undefined)
    const serverBaseUrl = 'https://workspace-dynamic-identities.example'
    await renderHarness({
      catalogState,
      contextKey: 'dynamic-identities',
      loadCatalog: async () => catalogState.catalog,
      onError: vi.fn(),
      onSelection,
      onSuccess: vi.fn(),
      refreshPlugins: async () => undefined,
      serverBaseUrl,
      syncSelection
    })

    await act(async () => {
      await Promise.all(dynamicPlugins.map(item => selection!.toggle(item, 'project')))
    })
    await flushPromises()
    expect(syncSelection).toHaveBeenCalledTimes(500)
    expect(dynamicPlugins.every(item => (
      selection!.getState(item, 'project').installed && !selection!.getState(item, 'project').pending
    ))).toBe(true)

    const supersede = captureMarketplaceSelectionSupersession(
      resolveMarketplaceServerKey(serverBaseUrl),
      dynamicPlugins.map(item => ({ marketplace: item.marketplace }))
    )
    await act(async () => {
      supersede()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(dynamicPlugins.every(item => {
      const state = selection!.getState(item, 'project')
      return !state.installed && !state.pending
    })).toBe(true)

    await act(async () => selection!.toggle(dynamicPlugins[0]!, 'project'))
    await flushPromises()
    expect(syncSelection).toHaveBeenCalledTimes(501)
    expect(selection!.getState(dynamicPlugins[0]!, 'project')).toEqual({ installed: true, pending: false })
  })
})
