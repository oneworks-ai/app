// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { KeyedMutator } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginMarketplaceCatalogPlugin, PluginMarketplaceCatalogResponse } from '@oneworks/types'

import { isPluginInstalledForTarget } from '#~/hooks/marketplace-plugin-selection'
import { useMarketplacePluginSelection } from '#~/hooks/use-marketplace-plugin-selection'

const plugin: PluginMarketplaceCatalogPlugin = {
  declared: false,
  enabled: false,
  marketplace: 'team-tools',
  marketplaceEnabled: true,
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
      | (
        (
          current: PluginMarketplaceCatalogResponse | undefined
        ) => PluginMarketplaceCatalogResponse | Promise<PluginMarketplaceCatalogResponse | undefined> | undefined
      )
  ) => {
    if (typeof value === 'function') {
      catalog = (await value(catalog)) ?? catalog
    } else if (value != null) {
      catalog = (await value) ?? catalog
    }
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
  loadCatalog: () => Promise<PluginMarketplaceCatalogResponse>
  onError: (error: unknown) => void
  onSuccess: () => void
  refreshPlugins: () => Promise<unknown>
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
  const { catalogState, ...selectionOptions } = props
  const catalog = useSyncExternalStore(
    catalogState.subscribe,
    () => catalogState.catalog,
    () => catalogState.catalog
  )
  const currentPlugin = catalog.plugins.find(item => item.name === plugin.name)!
  const currentSecondPlugin = catalog.plugins.find(item => item.name === secondPlugin.name)!
  const selection = useMarketplacePluginSelection({
    ...selectionOptions,
    mutateCatalog: catalogState.mutate
  })
  const landingState = selection.getState(currentPlugin, 'project')
  const detailState = selection.getState(currentPlugin, 'project')
  const globalState = selection.getState(currentPlugin, 'global')
  const secondPluginState = selection.getState(currentSecondPlugin, 'global')
  return (
    <>
      <button
        type='button'
        aria-label='landing-consumer'
        data-installed={landingState.installed}
        data-pending={landingState.pending}
        onClick={() => void selection.toggle(currentPlugin, 'project')}
      />
      <button
        type='button'
        aria-label='detail-consumer'
        data-installed={detailState.installed}
        data-pending={detailState.pending}
        onClick={() => void selection.toggle(currentPlugin, 'project')}
      />
      <button
        type='button'
        aria-label='global-consumer'
        data-installed={globalState.installed}
        data-pending={globalState.pending}
        onClick={() => void selection.toggle(currentPlugin, 'global')}
      />
      <button
        type='button'
        aria-label='second-plugin-consumer'
        data-installed={secondPluginState.installed}
        data-pending={secondPluginState.pending}
        onClick={() => void selection.toggle(currentSecondPlugin, 'global')}
      />
    </>
  )
}

let container: HTMLDivElement
let root: Root
let rootMounted: boolean

const renderHarness = async (props: SelectionHarnessProps) => {
  await act(async () => {
    root.render(<SelectionHarness {...props} />)
  })
}

const click = async (label: string) => {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click()
  })
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const expectConsumerState = (label: string, installed: boolean, pending: boolean) => {
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

  it('deduplicates a slow API write and promptly commits both landing and detail before refresh finishes', async () => {
    const apiWrite = createDeferred<unknown>()
    const catalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const runtimeRefresh = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const syncSelection = vi.fn(() => apiWrite.promise)
    await renderHarness({
      catalogState,
      loadCatalog: () => catalogRefresh.promise,
      onError,
      onSuccess,
      refreshPlugins: () => runtimeRefresh.promise,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection
    })

    await click('landing-consumer')
    await click('detail-consumer')
    expect(syncSelection).toHaveBeenCalledTimes(1)
    expectConsumerState('landing-consumer', false, true)
    expectConsumerState('detail-consumer', false, true)

    await act(async () => {
      apiWrite.resolve(undefined)
      await apiWrite.promise
    })
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    expectConsumerState('detail-consumer', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(true)

    await act(async () => {
      catalogRefresh.resolve(createCatalog())
      runtimeRefresh.resolve(undefined)
      await Promise.all([catalogRefresh.promise, runtimeRefresh.promise])
    })
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(true)
  })

  it('keeps an API failure uninstalled and permits an actionable retry', async () => {
    const catalogState = createCatalogState()
    const apiError = new Error('permission denied')
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const syncSelection = vi.fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce(undefined)
    await renderHarness({
      catalogState,
      loadCatalog: async () => createCatalog(),
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection
    })

    await click('landing-consumer')
    await flushPromises()
    expectConsumerState('landing-consumer', false, false)
    expect(onError).toHaveBeenCalledWith(apiError)
    expect(onSuccess).not.toHaveBeenCalled()

    await click('landing-consumer')
    await flushPromises()
    expect(syncSelection).toHaveBeenCalledTimes(2)
    expectConsumerState('landing-consumer', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not relock or roll back success when catalog and runtime refresh reject', async () => {
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    await renderHarness({
      catalogState,
      loadCatalog: async () => {
        throw new Error('catalog refresh failed')
      },
      onError,
      onSuccess,
      refreshPlugins: async () => {
        throw new Error('runtime refresh failed')
      },
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection: async () => undefined
    })

    await click('detail-consumer')
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    expectConsumerState('detail-consumer', true, false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(true)
  })

  it('keys deduplication by target and prevents older convergence from replacing a newer selection', async () => {
    const firstCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const secondCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const catalogState = createCatalogState()
    const loadCatalog = vi.fn(async () => createCatalog())
      .mockImplementationOnce(() => firstCatalogRefresh.promise)
      .mockImplementationOnce(() => secondCatalogRefresh.promise)
    const syncSelection = vi.fn(async () => undefined)
    await renderHarness({
      catalogState,
      loadCatalog,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection
    })

    await click('landing-consumer')
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    await click('detail-consumer')
    await flushPromises()
    expectConsumerState('landing-consumer', false, false)
    await click('global-consumer')
    await flushPromises()
    expect(syncSelection).toHaveBeenCalledTimes(3)
    expect(syncSelection.mock.calls.map(call => call[3])).toEqual(['project', 'project', 'global'])

    await act(async () => {
      firstCatalogRefresh.resolve(createCatalog(['project']))
      secondCatalogRefresh.resolve(createCatalog(['project']))
      await Promise.all([firstCatalogRefresh.promise, secondCatalogRefresh.promise])
    })
    await flushPromises()
    expectConsumerState('landing-consumer', false, false)
    expectConsumerState('global-consumer', true, false)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(false)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'global')).toBe(true)
  })

  it('accepts only the latest catalog root and overlays every newer successful plugin selection', async () => {
    const firstCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const secondCatalogRefresh = createDeferred<PluginMarketplaceCatalogResponse>()
    const catalogState = createCatalogState()
    const loadCatalog = vi.fn()
      .mockImplementationOnce(() => firstCatalogRefresh.promise)
      .mockImplementationOnce(() => secondCatalogRefresh.promise)
    await renderHarness({
      catalogState,
      loadCatalog,
      onError: vi.fn(),
      onSuccess: vi.fn(),
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection: async () => undefined
    })

    await click('landing-consumer')
    await flushPromises()
    await click('second-plugin-consumer')
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    expectConsumerState('second-plugin-consumer', true, false)

    await act(async () => {
      secondCatalogRefresh.resolve(createCatalog(undefined, {
        description: 'new-a',
        secondDescription: 'new-b',
        versionGeneration: 'generation-new'
      }))
      await secondCatalogRefresh.promise
    })
    await flushPromises()
    await act(async () => {
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
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'project')).toBe(true)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[0]!, 'global')).toBe(false)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[1]!, 'project')).toBe(false)
    expect(isPluginInstalledForTarget(catalogState.catalog.plugins[1]!, 'global')).toBe(true)
  })

  it('ignores an API completion from a previous server scope', async () => {
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
      loadCatalog: async () => createCatalog(),
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection
    }
    await renderHarness(props)
    await click('landing-consumer')
    expectConsumerState('landing-consumer', false, true)

    await renderHarness({
      ...props,
      serverBaseUrl: 'https://workspace-b.example'
    })
    expectConsumerState('landing-consumer', false, false)
    await click('landing-consumer')
    expect(syncSelection).toHaveBeenCalledTimes(2)
    expect(syncSelection.mock.calls.map(call => call[4])).toEqual([
      { serverBaseUrl: 'https://workspace-a.example' },
      { serverBaseUrl: 'https://workspace-b.example' }
    ])
    await act(async () => {
      previousScopeWrite.resolve(undefined)
      await previousScopeWrite.promise
    })
    await flushPromises()
    expect(catalogState.mutate).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    await act(async () => {
      currentScopeWrite.resolve(undefined)
      await currentScopeWrite.promise
    })
    await flushPromises()
    expectConsumerState('landing-consumer', true, false)
    expect(catalogState.mutate).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not write cache or UI after unmount', async () => {
    const apiWrite = createDeferred<unknown>()
    const catalogState = createCatalogState()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    await renderHarness({
      catalogState,
      loadCatalog: async () => createCatalog(),
      onError,
      onSuccess,
      refreshPlugins: async () => undefined,
      serverBaseUrl: 'https://workspace-a.example',
      syncSelection: () => apiWrite.promise
    })
    await click('landing-consumer')

    await act(async () => root.unmount())
    rootMounted = false
    await act(async () => {
      apiWrite.resolve(undefined)
      await apiWrite.promise
    })
    await flushPromises()
    expect(catalogState.mutate).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
