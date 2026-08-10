// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import useSWR, { SWRConfig } from 'swr'
import type { KeyedMutator } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigResponse, PluginMarketplaceCatalogPlugin, PluginMarketplaceCatalogResponse } from '@oneworks/types'

import type {
  MarketplacePluginSelectionController,
  UseMarketplacePluginSelectionOptions
} from '#~/components/plugins/@core/marketplace-plugin-selection'
import { useMarketplacePluginSelection } from '#~/components/plugins/@hooks/use-marketplace-plugin-selection'
import {
  applyMarketplaceCacheRefresh,
  captureMarketplaceSelectionSupersession,
  claimMarketplaceCacheAuthority,
  claimMarketplaceConvergenceAuthority,
  claimMarketplaceSelectionIntentAuthority,
  claimMarketplaceSourceIntentAuthority,
  clearMarketplaceSelectionAuthority,
  listMarketplaceSelectionAuthorities,
  publishMarketplaceSelectionAuthority,
  publishMarketplaceUninstallAuthority,
  resolveMarketplaceServerKey,
  subscribeMarketplaceSelectionAuthorities
} from '#~/plugins/marketplace-mutation-authority'

const serverBaseUrl = 'https://workspace-mutation-order.example'
const serverKey = resolveMarketplaceServerKey(serverBaseUrl)
const cacheKey = ['/api/plugins/marketplace/catalog', serverKey] as const
const configCacheKey = ['/api/config', serverKey] as const
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

const createCatalog = (installed: boolean): PluginMarketplaceCatalogResponse => ({
  plugins: [{ ...plugin, ...(installed ? { installedSources: ['project'] as const } : {}) }],
  sources: [],
  versionGeneration: installed ? 'installed' : 'removed'
})

const createConfig = (marketplace: string): ConfigResponse => ({
  sources: {
    user: {
      plugins: {
        marketplaces: {
          [marketplace]: { enabled: true, type: 'codex' }
        }
      }
    }
  }
})

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const claimSelectionIntent = (marketplace: string, pluginName: string, identityServerKey = serverKey) => (
  claimMarketplaceSelectionIntentAuthority(identityServerKey, {
    marketplace,
    plugin: pluginName,
    target: 'project'
  })
)

let container: HTMLDivElement
let latestCatalog: PluginMarketplaceCatalogResponse | undefined
let latestConfig: ConfigResponse | undefined
let latestConfigMutate: KeyedMutator<ConfigResponse> | undefined
let latestMutate: KeyedMutator<PluginMarketplaceCatalogResponse> | undefined
let latestSelection: MarketplacePluginSelectionController | undefined
let root: Root

interface HarnessProps {
  installCatalog: Promise<PluginMarketplaceCatalogResponse>
  loadCatalog?: UseMarketplacePluginSelectionOptions['loadCatalog']
  onError?: UseMarketplacePluginSelectionOptions['onError']
  onSuccess?: UseMarketplacePluginSelectionOptions['onSuccess']
  refreshPlugins?: UseMarketplacePluginSelectionOptions['refreshPlugins']
  syncSelection?: UseMarketplacePluginSelectionOptions['syncSelection']
}

function Harness({
  installCatalog,
  loadCatalog,
  onError = vi.fn(),
  onSuccess = vi.fn(),
  refreshPlugins = async () => undefined,
  syncSelection = async () => undefined
}: HarnessProps) {
  const { data: catalog, mutate } = useSWR<PluginMarketplaceCatalogResponse>(
    cacheKey,
    null,
    { fallbackData: createCatalog(false) }
  )
  latestCatalog = catalog
  latestMutate = mutate
  const { data: config, mutate: mutateConfig } = useSWR<ConfigResponse>(
    configCacheKey,
    null,
    { fallbackData: createConfig('base') }
  )
  latestConfig = config
  latestConfigMutate = mutateConfig
  latestSelection = useMarketplacePluginSelection({
    catalog,
    contextKey: 'store',
    loadCatalog: loadCatalog ?? (() => installCatalog),
    mutateCatalog: mutate,
    onError,
    onSuccess,
    refreshPlugins,
    serverBaseUrl,
    syncSelection
  })
  return null
}

describe('plugin marketplace cache mutation authority', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    latestCatalog = undefined
    latestConfig = undefined
    latestConfigMutate = undefined
    latestMutate = undefined
    latestSelection = undefined
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('prevents a delayed install GET from undoing a completed uninstall in real SWR', async () => {
    const installCatalog = createDeferred<PluginMarketplaceCatalogResponse>()
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <Harness installCatalog={installCatalog.promise} />
        </SWRConfig>
      )
    })

    await act(async () => {
      await latestSelection!.toggle(plugin, 'project')
    })
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: true, pending: false })

    publishMarketplaceUninstallAuthority(serverKey, {
      adapter: 'codex',
      marketplace: plugin.marketplace,
      plugin: plugin.name,
      scope: 'team-tools/review'
    })
    const uninstallAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    await act(async () => {
      await applyMarketplaceCacheRefresh({
        authority: uninstallAuthority.catalog,
        load: async () => createCatalog(false),
        mutate: latestMutate!
      })
    })
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: false, pending: false })

    await act(async () => {
      installCatalog.resolve(createCatalog(true))
      await installCatalog.promise
    })
    expect(latestCatalog?.versionGeneration).toBe('removed')
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: false, pending: false })
  })

  it('lets a source mutation supersede delayed install config and runtime convergence', async () => {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <Harness installCatalog={Promise.resolve(createCatalog(false))} />
        </SWRConfig>
      )
    })
    const delayedInstallConfig = createDeferred<ConfigResponse>()
    const delayedInstallRuntime = createDeferred<void>()
    const installAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    const installConfigRefresh = applyMarketplaceCacheRefresh({
      authority: installAuthority.config,
      load: () => delayedInstallConfig.promise,
      mutate: latestConfigMutate!
    })
    let runtimeState = 'base'
    const installRuntimeRefresh = delayedInstallRuntime.promise.then(() => {
      if (installAuthority.runtime.isCurrent()) runtimeState = 'install'
    })

    const sourceAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    expect(installAuthority.config.isCurrent()).toBe(false)
    expect(installAuthority.catalog.isCurrent()).toBe(false)
    expect(installAuthority.runtime.isCurrent()).toBe(false)
    await act(async () => {
      await applyMarketplaceCacheRefresh({
        authority: sourceAuthority.config,
        load: async () => createConfig('source'),
        mutate: latestConfigMutate!
      })
      if (sourceAuthority.runtime.isCurrent()) runtimeState = 'source'
    })

    await act(async () => {
      delayedInstallConfig.resolve(createConfig('install'))
      delayedInstallRuntime.resolve()
      await Promise.all([installConfigRefresh, installRuntimeRefresh])
    })
    const marketplaces = latestConfig?.sources?.user?.plugins?.marketplaces ?? {}
    expect(Object.keys(marketplaces)).toEqual(['source'])
    expect(runtimeState).toBe('source')
  })

  it('keeps a later source mutation authoritative when an earlier selection response is delayed', async () => {
    const syncResponse = createDeferred<void>()
    const loadCatalog = vi.fn(async () => createCatalog(true))
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const refreshPlugins = vi.fn(async () => undefined)
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <Harness
            installCatalog={Promise.resolve(createCatalog(true))}
            loadCatalog={loadCatalog}
            onError={onError}
            onSuccess={onSuccess}
            refreshPlugins={refreshPlugins}
            syncSelection={() => syncResponse.promise}
          />
        </SWRConfig>
      )
    })

    let selectionPromise!: Promise<void>
    await act(async () => {
      selectionPromise = latestSelection!.toggle(plugin, 'project')
      await Promise.resolve()
    })
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: false, pending: true })

    const sourceIntent = claimMarketplaceSourceIntentAuthority(serverKey, plugin.marketplace)
    const sourceAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    const supersedeCommittedSelection = captureMarketplaceSelectionSupersession(
      serverKey,
      [{ marketplace: plugin.marketplace }]
    )
    await act(async () => {
      await Promise.all([
        applyMarketplaceCacheRefresh({
          authority: sourceAuthority.catalog,
          load: async () => createCatalog(false),
          mutate: latestMutate!
        }),
        applyMarketplaceCacheRefresh({
          authority: sourceAuthority.config,
          load: async () => createConfig('source-disabled'),
          mutate: latestConfigMutate!
        })
      ])
      supersedeCommittedSelection()
    })
    sourceAuthority.release()
    sourceIntent.release()

    await act(async () => {
      syncResponse.resolve()
      await selectionPromise
    })

    expect(latestCatalog?.versionGeneration).toBe('removed')
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: false, pending: false })
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([])
    expect(loadCatalog).not.toHaveBeenCalled()
    expect(refreshPlugins).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('accepts a selection after a source intent and isolates retired identity generations', () => {
    const earlierSelection = claimSelectionIntent('retired-source', 'earlier')
    const laterSource = claimMarketplaceSourceIntentAuthority(serverKey, 'retired-source')
    const unrelatedMarketplace = claimSelectionIntent('unrelated', 'independent')
    const unrelatedServer = claimSelectionIntent('retired-source', 'independent', 'https://other.example')
    expect(earlierSelection.isCurrent()).toBe(false)
    expect(unrelatedMarketplace.isCurrent()).toBe(true)
    expect(unrelatedServer.isCurrent()).toBe(true)
    laterSource.release()
    expect(earlierSelection.isCurrent()).toBe(false)
    const laterSelection = claimSelectionIntent('retired-source', 'later')
    expect(laterSelection.isCurrent()).toBe(true)

    earlierSelection.release()
    laterSource.release()
    laterSelection.release()
    unrelatedMarketplace.release()
    unrelatedServer.release()
    const reused = claimSelectionIntent('retired-source', 'earlier')
    expect(earlierSelection.isCurrent()).toBe(false)
    expect(reused.isCurrent()).toBe(true)
    reused.release()
  })

  it('replaces a confirmed install overlay after source roots converge in real SWR', async () => {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <Harness installCatalog={Promise.resolve(createCatalog(false))} />
        </SWRConfig>
      )
    })
    await act(async () => {
      publishMarketplaceSelectionAuthority(serverKey, {
        enabled: true,
        marketplace: plugin.marketplace,
        plugin: plugin.name,
        target: 'project'
      }, 'confirmed')
      await Promise.resolve()
    })
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: true, pending: false })

    const sourceAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    const supersedeCommittedSelection = captureMarketplaceSelectionSupersession(
      serverKey,
      [{ marketplace: plugin.marketplace }]
    )
    await act(async () => {
      await Promise.all([
        applyMarketplaceCacheRefresh({
          authority: sourceAuthority.catalog,
          load: async () => createCatalog(false),
          mutate: latestMutate!
        }),
        applyMarketplaceCacheRefresh({
          authority: sourceAuthority.config,
          load: async () => createConfig('source-disabled'),
          mutate: latestConfigMutate!
        })
      ])
      supersedeCommittedSelection()
      await Promise.resolve()
    })

    expect(latestCatalog?.versionGeneration).toBe('removed')
    expect(latestSelection?.getState(plugin, 'project')).toEqual({ installed: false, pending: false })
  })

  it('does not clear a selection mutation published after source convergence begins', async () => {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <Harness installCatalog={Promise.resolve(createCatalog(false))} />
        </SWRConfig>
      )
    })
    let newerSelection: ReturnType<typeof publishMarketplaceSelectionAuthority> | undefined
    await act(async () => {
      publishMarketplaceSelectionAuthority(serverKey, {
        enabled: true,
        marketplace: plugin.marketplace,
        plugin: plugin.name,
        target: 'project'
      }, 'confirmed')
      const supersedeCommittedSelection = captureMarketplaceSelectionSupersession(
        serverKey,
        [{ marketplace: plugin.marketplace }]
      )
      newerSelection = publishMarketplaceSelectionAuthority(serverKey, {
        enabled: true,
        marketplace: plugin.marketplace,
        plugin: plugin.name,
        target: 'project'
      }, 'confirmed')
      supersedeCommittedSelection()
      await Promise.resolve()
    })

    expect(newerSelection?.isCurrent()).toBe(true)
    expect(listMarketplaceSelectionAuthorities(serverKey)).toEqual([newerSelection])
  })

  it('retires inactive authority keys without reviving tokens after key reuse', async () => {
    const reuseServerKey = 'https://authority-reuse.example'
    const oldCache = claimMarketplaceCacheAuthority(reuseServerKey, 'catalog')
    oldCache.release()
    const currentCache = claimMarketplaceCacheAuthority(reuseServerKey, 'catalog')
    expect(oldCache.isCurrent()).toBe(false)
    expect(currentCache.isCurrent()).toBe(true)
    const mutate = vi.fn(async () => 'current') as unknown as KeyedMutator<string>
    await expect(applyMarketplaceCacheRefresh({
      authority: oldCache,
      load: async () => 'stale',
      mutate
    })).resolves.toBeUndefined()
    expect(mutate).not.toHaveBeenCalled()
    await expect(applyMarketplaceCacheRefresh({
      authority: currentCache,
      load: async () => 'current',
      mutate
    })).resolves.toBe('current')
    expect(mutate).toHaveBeenCalledTimes(1)
    currentCache.release()

    for (let index = 0; index < 500; index += 1) {
      claimMarketplaceCacheAuthority(`https://dynamic-${index}.example`, 'runtime').release()
    }
    const reusedAfterChurn = claimMarketplaceCacheAuthority('https://dynamic-0.example', 'runtime')
    expect(reusedAfterChurn.isCurrent()).toBe(true)
    expect(oldCache.isCurrent()).toBe(false)
    reusedAfterChurn.release()

    const listener = vi.fn()
    const unsubscribe = subscribeMarketplaceSelectionAuthorities(reuseServerKey, listener)
    const selection = {
      enabled: true,
      marketplace: 'reused-marketplace',
      plugin: 'reused-plugin',
      target: 'project' as const
    }
    const oldSelection = publishMarketplaceSelectionAuthority(reuseServerKey, selection, 'confirmed')
    clearMarketplaceSelectionAuthority(oldSelection)
    const currentSelection = publishMarketplaceSelectionAuthority(reuseServerKey, selection, 'confirmed')
    expect(oldSelection.isCurrent()).toBe(false)
    expect(currentSelection.isCurrent()).toBe(true)
    for (let index = 0; index < 500; index += 1) {
      const authority = publishMarketplaceSelectionAuthority(reuseServerKey, {
        ...selection,
        marketplace: `marketplace-${index}`,
        plugin: `plugin-${index}`
      }, 'confirmed')
      clearMarketplaceSelectionAuthority(authority)
    }
    expect(listMarketplaceSelectionAuthorities(reuseServerKey)).toEqual([currentSelection])
    clearMarketplaceSelectionAuthority(currentSelection)
    const reusedSelection = publishMarketplaceSelectionAuthority(reuseServerKey, selection, 'confirmed')
    expect(oldSelection.isCurrent()).toBe(false)
    expect(currentSelection.isCurrent()).toBe(false)
    expect(reusedSelection.isCurrent()).toBe(true)
    await Promise.resolve()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    expect(reusedSelection.isCurrent()).toBe(false)
    const callsAfterUnsubscribe = listener.mock.calls.length
    const unobservedSelection = publishMarketplaceSelectionAuthority(reuseServerKey, selection, 'confirmed')
    await Promise.resolve()
    expect(unobservedSelection.isCurrent()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(callsAfterUnsubscribe)
  })

  it('keeps a new listener generation when an old cleanup runs twice', async () => {
    const listenerServerKey = 'https://listener-aba.example'
    const oldListener = vi.fn()
    const oldCleanup = subscribeMarketplaceSelectionAuthorities(listenerServerKey, oldListener)
    oldCleanup()

    const newListener = vi.fn()
    const newCleanup = subscribeMarketplaceSelectionAuthorities(listenerServerKey, newListener)
    const authority = publishMarketplaceSelectionAuthority(listenerServerKey, {
      enabled: true,
      marketplace: 'listener-marketplace',
      plugin: 'listener-plugin',
      target: 'project'
    }, 'confirmed')
    oldCleanup()
    oldCleanup()
    await Promise.resolve()

    expect(authority.isCurrent()).toBe(true)
    expect(listMarketplaceSelectionAuthorities(listenerServerKey)).toEqual([authority])
    expect(newListener).toHaveBeenCalledTimes(1)

    newCleanup()
    expect(authority.isCurrent()).toBe(false)
  })
})
