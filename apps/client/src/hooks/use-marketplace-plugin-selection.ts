import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { PluginMarketplaceCatalogPlugin, PluginMarketplaceInstallTarget } from '@oneworks/types'

import { listPluginMarketplaceCatalog, syncPluginMarketplaceSelection } from '#~/plugins/marketplace-api'
import {
  applyMarketplacePluginSelections,
  createMarketplaceSelectionKey,
  getMarketplacePluginSelectionState,
  isMarketplacePluginInstallable,
  isPluginInstalledForTarget,
  updateMarketplaceSelectionKeys
} from './marketplace-plugin-selection'
import type {
  MarketplacePluginSelection,
  MarketplacePluginSelectionController,
  UseMarketplacePluginSelectionOptions
} from './marketplace-plugin-selection'

export function useMarketplacePluginSelection({
  loadCatalog,
  mutateCatalog,
  onError,
  onSuccess,
  refreshPlugins,
  serverBaseUrl,
  syncSelection = syncPluginMarketplaceSelection
}: UseMarketplacePluginSelectionOptions): MarketplacePluginSelectionController {
  const scopeKey = serverBaseUrl ?? 'current'
  const mountedRef = useRef(false)
  const scopeKeyRef = useRef(scopeKey)
  const scopeRevisionRef = useRef(0)
  const catalogRevisionRef = useRef(0)
  const operationRevisionRef = useRef(new Map<string, number>())
  const inFlightRef = useRef(new Map<string, Promise<void>>())
  const committedSelectionsRef = useRef(new Map<string, MarketplacePluginSelection>())
  const pendingRef = useRef(new Set<string>())
  const [committed, setCommitted] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())

  useLayoutEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    scopeRevisionRef.current += 1
    catalogRevisionRef.current += 1
    operationRevisionRef.current.clear()
    inFlightRef.current.clear()
    committedSelectionsRef.current.clear()
    pendingRef.current = new Set()
    setCommitted({})
    setPending(new Set())
  }, [scopeKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      scopeRevisionRef.current += 1
      catalogRevisionRef.current += 1
      operationRevisionRef.current.clear()
      inFlightRef.current.clear()
      committedSelectionsRef.current.clear()
      pendingRef.current = new Set()
    }
  }, [])

  const setSelectionPending = useCallback((key: string, value: boolean) => {
    const next = updateMarketplaceSelectionKeys(pendingRef.current, key, value)
    pendingRef.current = next
    setPending(next)
  }, [])

  const getState = useCallback((
    plugin: PluginMarketplaceCatalogPlugin,
    target: PluginMarketplaceInstallTarget
  ) => getMarketplacePluginSelectionState(scopeKey, committed, pending, plugin, target), [
    committed,
    pending,
    scopeKey
  ])

  const toggle = useCallback((
    plugin: PluginMarketplaceCatalogPlugin,
    target: PluginMarketplaceInstallTarget
  ) => {
    if (!isMarketplacePluginInstallable(plugin)) return Promise.resolve()
    const key = createMarketplaceSelectionKey(scopeKey, plugin, target)
    const existing = inFlightRef.current.get(key)
    if (existing != null) return existing

    const enabled = !(committedSelectionsRef.current.get(key)?.enabled ??
      isPluginInstalledForTarget(plugin, target))
    const scopeRevision = scopeRevisionRef.current
    const operationRevision = (operationRevisionRef.current.get(key) ?? 0) + 1
    operationRevisionRef.current.set(key, operationRevision)
    setSelectionPending(key, true)

    const isCurrent = () =>
      mountedRef.current &&
      scopeKeyRef.current === scopeKey &&
      scopeRevisionRef.current === scopeRevision &&
      operationRevisionRef.current.get(key) === operationRevision
    const selection: MarketplacePluginSelection = {
      enabled,
      marketplace: plugin.marketplace,
      plugin: plugin.name,
      target
    }

    const operation = (async () => {
      try {
        await syncSelection(
          plugin.marketplace,
          plugin.name,
          enabled,
          target,
          { serverBaseUrl }
        )
        if (!isCurrent()) return

        committedSelectionsRef.current.set(key, selection)
        setCommitted(current => ({ ...current, [key]: selection.enabled }))
        const catalogRevision = catalogRevisionRef.current + 1
        catalogRevisionRef.current = catalogRevision
        const isCatalogCurrent = () => isCurrent() && catalogRevisionRef.current === catalogRevision
        void Promise.resolve()
          .then(() => {
            if (!isCatalogCurrent()) return undefined
            return mutateCatalog(
              current =>
                current == null
                  ? current
                  : applyMarketplacePluginSelections(current, committedSelectionsRef.current.values()),
              { revalidate: false }
            )
          })
          .catch(() => undefined)
        setSelectionPending(key, false)
        onSuccess({ enabled, plugin, target })

        void Promise.resolve()
          .then(() => {
            if (!isCurrent()) return undefined
            return refreshPlugins({ isCurrent })
          })
          .catch(() => undefined)
        void Promise.resolve()
          .then(() => {
            if (!isCatalogCurrent()) return undefined
            return loadCatalog?.() ?? listPluginMarketplaceCatalog({ serverBaseUrl })
          })
          .then(async (refreshedCatalog) => {
            if (refreshedCatalog == null || !isCatalogCurrent()) return
            await mutateCatalog(
              current =>
                !isCatalogCurrent()
                  ? current
                  : applyMarketplacePluginSelections(
                    refreshedCatalog,
                    committedSelectionsRef.current.values()
                  ),
              { revalidate: false }
            )
            if (!isCatalogCurrent()) return
            committedSelectionsRef.current.clear()
            setCommitted({})
          })
          .catch(() => undefined)
      } catch (error) {
        if (!isCurrent()) return
        setSelectionPending(key, false)
        onError(error)
      } finally {
        if (operationRevisionRef.current.get(key) === operationRevision) {
          inFlightRef.current.delete(key)
        }
      }
    })()
    inFlightRef.current.set(key, operation)
    return operation
  }, [
    loadCatalog,
    mutateCatalog,
    onError,
    onSuccess,
    refreshPlugins,
    scopeKey,
    serverBaseUrl,
    setSelectionPending,
    syncSelection
  ])

  return { getState, toggle }
}
