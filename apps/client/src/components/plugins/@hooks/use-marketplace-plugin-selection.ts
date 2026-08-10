import { useCallback, useEffect } from 'react'

import type { PluginMarketplaceCatalogPlugin, PluginMarketplaceInstallTarget } from '@oneworks/types'

import { listPluginMarketplaceCatalog, syncPluginMarketplaceSelection } from '#~/plugins/marketplace-api'
import {
  applyMarketplaceCacheRefresh,
  claimMarketplaceCacheAuthority,
  claimMarketplaceSelectionIntentAuthority,
  clearMarketplaceSelectionAuthority,
  listMarketplaceSelectionAuthorities,
  publishMarketplaceSelectionAuthority,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'

import {
  createMarketplaceSelectionKey,
  getMarketplacePluginSelectionState,
  isMarketplacePluginInstallable,
  isMarketplaceSelectionCommitUnknownError,
  isPluginInstalledForTarget,
  marketplaceCatalogMatchesSelection
} from '../@core/marketplace-plugin-selection'
import type {
  MarketplacePluginSelectionController,
  UseMarketplacePluginSelectionOptions
} from '../@core/marketplace-plugin-selection'
import { useMarketplaceSelectionAuthorityState } from './use-marketplace-selection-authority-state'
import { useMarketplaceSelectionConvergence } from './use-marketplace-selection-convergence'
import { useMarketplaceSelectionOperationContainer } from './use-marketplace-selection-operation-container'

export function useMarketplacePluginSelection(options: UseMarketplacePluginSelectionOptions) {
  const {
    catalog,
    contextKey,
    loadCatalog,
    mutateCatalog,
    onError,
    onSuccess,
    refreshAfterSuccess,
    refreshPlugins,
    serverBaseUrl,
    syncSelection = syncPluginMarketplaceSelection
  } = options
  const serverKey = resolveMarketplaceServerKey(serverBaseUrl)
  const {
    apiPendingRef,
    authoritiesRef,
    contextRevisionRef,
    emit,
    mountedRef,
    serverKeyRef,
    serverRevisionRef,
    stateRevision,
    syncAuthorities,
    viewAuthoritiesRef,
    viewPromisesRef
  } = useMarketplaceSelectionAuthorityState({ contextKey, serverKey })
  const operationState = useMarketplaceSelectionOperationContainer({ serverKey })
  const { container: operationContainer, retire: retireOperation } = operationState
  const startConvergence = useMarketplaceSelectionConvergence({
    loadCatalog,
    mutateCatalog,
    refreshAfterSuccess,
    refreshPlugins,
    serverBaseUrl,
    serverKey
  })
  useEffect(() => {
    if (catalog == null) return
    let didChange = false
    for (const authority of listMarketplaceSelectionAuthorities(serverKey)) {
      if (!marketplaceCatalogMatchesSelection(catalog, authority)) continue
      didChange = true
      const viewAuthority = viewAuthoritiesRef.current.get(authority.key)
      clearMarketplaceSelectionAuthority(authority)
      viewAuthoritiesRef.current.delete(authority.key)
      apiPendingRef.current.delete(authority.key)
      if (authority.status === 'indeterminate') {
        const serverRevision = serverRevisionRef.current
        const isServerCurrent = () => mountedRef.current && serverRevisionRef.current === serverRevision
        startConvergence(isServerCurrent)
        if (viewAuthority?.contextRevision === contextRevisionRef.current) {
          onSuccess({ enabled: authority.enabled, plugin: viewAuthority.plugin, target: authority.target })
        }
      }
    }
    if (didChange) syncAuthorities()
  }, [catalog, onSuccess, serverKey, startConvergence, stateRevision, syncAuthorities])
  const getState = useCallback((plugin: PluginMarketplaceCatalogPlugin, target: PluginMarketplaceInstallTarget) => {
    const pending = new Set(apiPendingRef.current)
    authoritiesRef.current.forEach((authority, key) => {
      if (authority.status === 'indeterminate') pending.add(key)
    })
    return getMarketplacePluginSelectionState(serverKey, authoritiesRef.current, pending, plugin, target)
  }, [serverKey, stateRevision])
  const toggle = useCallback((plugin: PluginMarketplaceCatalogPlugin, target: PluginMarketplaceInstallTarget) => {
    if (!isMarketplacePluginInstallable(plugin)) return Promise.resolve()
    const key = createMarketplaceSelectionKey(serverKey, plugin, target)
    const existingViewPromise = viewPromisesRef.current.get(key)
    if (existingViewPromise != null) return existingViewPromise.promise
    if (apiPendingRef.current.has(key) || authoritiesRef.current.get(key)?.status === 'indeterminate') {
      return Promise.resolve()
    }
    const serverRevision = serverRevisionRef.current
    const contextRevision = contextRevisionRef.current
    let operation = operationContainer.get(key)
    if (operation == null) {
      const enabled = !(authoritiesRef.current.get(key)?.enabled ?? isPluginInstalledForTarget(plugin, target))
      const token = {}
      const selection = { enabled, marketplace: plugin.marketplace, plugin: plugin.name, target }
      const authority = claimMarketplaceSelectionIntentAuthority(serverKey, selection)
      const promise = syncSelection(plugin.marketplace, plugin.name, enabled, target, { serverBaseUrl })
        .then(() => selection)
      operation = { authority, consumers: 0, promise, selection, settled: false, token }
      operationContainer.set(key, operation)
      const createdOperation = operation
      void promise.finally(() => {
        createdOperation.settled = true
        retireOperation(key, createdOperation)
      }).catch(() => undefined)
    }
    operation.consumers += 1
    const { promise: operationPromise, selection: requestedSelection, token: operationToken } = operation
    const isServerLifecycleCurrent = () =>
      mountedRef.current && serverKeyRef.current === serverKey &&
      serverRevisionRef.current === serverRevision
    const isIntentCurrent = () => isServerLifecycleCurrent() && operation.authority.isCurrent()
    const isOperationCurrent = () => isIntentCurrent() && operationContainer.isCurrent(key, operationToken)
    const isViewCurrent = () => isOperationCurrent() && contextRevisionRef.current === contextRevision
    apiPendingRef.current.add(key)
    emit()
    const token = {}
    let intentReleaseOwnedByView = true
    const retainIntentUntil = (pending: Promise<unknown>) => {
      intentReleaseOwnedByView = false
      void pending.finally(operation.authority.release).catch(() => undefined)
    }
    const viewPromise = (async () => {
      try {
        const selection = await operationPromise
        if (!isOperationCurrent()) return
        const authority = publishMarketplaceSelectionAuthority(serverKey, selection, 'confirmed')
        if (contextRevisionRef.current === contextRevision) {
          viewAuthoritiesRef.current.set(key, { authority, contextRevision, plugin })
        }
        apiPendingRef.current.delete(key)
        syncAuthorities()
        if (isViewCurrent()) onSuccess({ enabled: selection.enabled, plugin, target })
        retainIntentUntil(startConvergence(isIntentCurrent))
      } catch (error) {
        if (!isOperationCurrent()) return
        apiPendingRef.current.delete(key)
        if (isMarketplaceSelectionCommitUnknownError(error)) {
          const authority = publishMarketplaceSelectionAuthority(serverKey, requestedSelection, 'indeterminate')
          if (contextRevisionRef.current === contextRevision) {
            viewAuthoritiesRef.current.set(key, { authority, contextRevision, plugin })
          }
          const catalogAuthority = claimMarketplaceCacheAuthority(serverKey, 'catalog')
          const reconciliation = applyMarketplaceCacheRefresh({
            authority: {
              ...catalogAuthority,
              isCurrent: () => isIntentCurrent() && catalogAuthority.isCurrent()
            },
            load: () => loadCatalog?.() ?? listPluginMarketplaceCatalog({ serverBaseUrl }),
            mutate: mutateCatalog
          }).catch(() => undefined).finally(catalogAuthority.release)
          retainIntentUntil(reconciliation)
          syncAuthorities()
        } else {
          emit()
          if (isViewCurrent()) onError(error)
        }
      } finally {
        const shouldEmitPendingChange = apiPendingRef.current.delete(key) && isServerLifecycleCurrent()
        if (intentReleaseOwnedByView) operation.authority.release()
        operation.consumers -= 1
        retireOperation(key, operation)
        if (viewPromisesRef.current.get(key)?.token === token) viewPromisesRef.current.delete(key)
        if (shouldEmitPendingChange) emit()
      }
    })()
    viewPromisesRef.current.set(key, { promise: viewPromise, token })
    return viewPromise
  }, [
    emit,
    loadCatalog,
    mutateCatalog,
    onError,
    onSuccess,
    operationContainer,
    serverBaseUrl,
    serverKey,
    startConvergence,
    retireOperation,
    syncAuthorities,
    syncSelection
  ])
  return { getState, toggle } satisfies MarketplacePluginSelectionController
}
