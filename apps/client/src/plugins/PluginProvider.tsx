/* eslint-disable max-lines -- provider coordinates plugin activation, relay-aware sources, and watch lifecycle. */
import type { PublicPluginRuntimeEndpoint as PluginRuntimeEndpoint } from '@oneworks/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { getLauncherManagerServerBaseUrl } from '#~/api/launcher'
import { useNotifications } from '#~/notifications/NotificationProvider'
import { getRuntimeWorkspaceId, getServerBaseUrl, isServerManagerRole, normalizeServerBaseUrl } from '#~/runtime-config'
import { createSocket } from '#~/ws.js'

import { listPluginSnapshot } from './api'
import { PluginContext } from './plugin-context'
import type { PluginContextValue, PluginRefreshOptions, PluginRuntimeSource } from './plugin-context'
import type { PluginContributionSurface, PluginRuntimeInstance } from './plugin-manifest'
import { PluginRegistry } from './plugin-registry'
import { activatePluginClient } from './plugin-runtime'

interface PluginWatchEvent {
  type: 'plugin.changed' | 'plugin.ready' | 'plugin.watch.updated'
  scope: string
}

interface PluginProviderProps {
  children: ReactNode
  deferUntilRuntimeServerBaseUrl?: boolean
  runtimeServerBaseUrl?: string
  runtimeSource?: PluginRuntimeSource
  surface?: PluginContributionSurface
}

const resolvePluginRuntimeSource = (runtimeSource: PluginRuntimeSource | undefined): PluginRuntimeSource => {
  if (runtimeSource != null) return runtimeSource
  if (getRuntimeWorkspaceId() != null) return 'current'
  return isServerManagerRole() ? 'manager' : 'current'
}

export function PluginProvider({
  children,
  deferUntilRuntimeServerBaseUrl = false,
  runtimeServerBaseUrl,
  runtimeSource,
  surface = 'workspace'
}: PluginProviderProps) {
  const resolvedRuntimeSource = resolvePluginRuntimeSource(runtimeSource)
  const notifications = useNotifications()
  const initialRegistryRef = useRef<PluginRegistry | undefined>(undefined)
  if (initialRegistryRef.current == null) initialRegistryRef.current = new PluginRegistry()
  const registryRef = useRef(initialRegistryRef.current)
  const retiredRegistriesRef = useRef<
    Array<{
      instances: PluginRuntimeInstance[]
      registry: PluginRegistry
    }>
  >([])
  const instancesRef = useRef<PluginRuntimeInstance[]>([])
  const activationVersionsRef = useRef(new WeakMap<PluginRegistry, Map<string, number>>())
  const importVersionsRef = useRef(new Map<string, number>())
  const activationRefreshRevisionRef = useRef(0)
  const bootstrapLoadRef = useRef<Promise<void> | undefined>(undefined)
  const committedRequestRevisionRef = useRef(0)
  const requestRevisionRef = useRef(0)
  const runtimeEndpointRef = useRef<PluginRuntimeEndpoint | undefined>(undefined)
  const [publishedRuntime, setPublishedRuntime] = useState(() => ({
    registry: registryRef.current,
    runtimeEndpoint: undefined as PluginRuntimeEndpoint | undefined,
    snapshot: registryRef.current.getSnapshot()
  }))
  const { registry, runtimeEndpoint, snapshot } = publishedRuntime
  const [pluginSnapshotStatus, setPluginSnapshotStatus] = useState<'error' | 'loading' | 'ready'>('loading')
  const pluginSnapshotStatusRef = useRef<'error' | 'loading' | 'ready'>('loading')
  const [ready, setReady] = useState(false)

  useEffect(() =>
    registry.subscribe(() => {
      if (registryRef.current !== registry) return
      setPublishedRuntime(current =>
        current.registry === registry
          ? { ...current, snapshot: registry.getSnapshot() }
          : current
      )
    }), [registry])

  const pluginServerBaseUrl = useMemo(() => {
    const explicitServerBaseUrl = normalizeServerBaseUrl(runtimeServerBaseUrl)
    if (explicitServerBaseUrl != null) return explicitServerBaseUrl
    if (deferUntilRuntimeServerBaseUrl) return undefined
    return resolvedRuntimeSource === 'manager'
      ? getLauncherManagerServerBaseUrl()
      : getServerBaseUrl()
  }, [deferUntilRuntimeServerBaseUrl, resolvedRuntimeSource, runtimeServerBaseUrl])

  const setRuntimeSnapshot = useCallback((runtime: PluginRuntimeEndpoint | undefined) => {
    const currentRegistry = registryRef.current
    currentRegistry.setRuntimeContext({
      runtime,
      surfaces: [surface]
    })
    runtimeEndpointRef.current = runtime
    setPublishedRuntime(current =>
      current.registry === currentRegistry
        ? { registry: currentRegistry, runtimeEndpoint: runtime, snapshot: currentRegistry.getSnapshot() }
        : current
    )
  }, [surface])

  const updatePluginSnapshotStatus = useCallback((status: 'error' | 'loading' | 'ready') => {
    pluginSnapshotStatusRef.current = status
    setPluginSnapshotStatus(status)
  }, [])

  const getImportVersion = useCallback((scope: string) => importVersionsRef.current.get(scope) ?? 0, [])
  const bumpImportVersion = useCallback((scope: string) => {
    importVersionsRef.current.set(scope, (importVersionsRef.current.get(scope) ?? 0) + 1)
  }, [])
  const nextActivationVersion = useCallback((targetRegistry: PluginRegistry, scope: string) => {
    const versions = activationVersionsRef.current.get(targetRegistry) ?? new Map<string, number>()
    activationVersionsRef.current.set(targetRegistry, versions)
    const next = (versions.get(scope) ?? 0) + 1
    versions.set(scope, next)
    return next
  }, [])
  const isActivationCurrent = useCallback(
    (targetRegistry: PluginRegistry, scope: string, version: number) =>
      activationVersionsRef.current.get(targetRegistry)?.get(scope) === version,
    []
  )

  const reloadPlugin = useCallback(async (scope: string) => {
    if (pluginServerBaseUrl == null) return
    const instance = instancesRef.current.find(item => item.scope === scope)
    if (instance == null) return
    const currentRegistry = registryRef.current
    bumpImportVersion(scope)
    const activationVersion = nextActivationVersion(currentRegistry, scope)
    currentRegistry.disposeScope(scope)
    if (instance.enabled === false) return
    currentRegistry.registerInstanceContributions(instance)
    await activatePluginClient({
      getImportVersion: () => getImportVersion(scope),
      instance,
      isActivationCurrent: () => isActivationCurrent(currentRegistry, scope, activationVersion),
      notifications,
      registry: currentRegistry,
      reloadPlugin,
      runtimeEndpoint: runtimeEndpointRef.current,
      serverBaseUrl: pluginServerBaseUrl
    })
  }, [
    bumpImportVersion,
    getImportVersion,
    isActivationCurrent,
    nextActivationVersion,
    notifications,
    pluginServerBaseUrl
  ])

  const disposeRegistryInstances = useCallback((
    targetRegistry: PluginRegistry,
    instances: PluginRuntimeInstance[]
  ) => {
    for (const instance of instances) {
      nextActivationVersion(targetRegistry, instance.scope)
      targetRegistry.disposeScope(instance.scope)
    }
  }, [nextActivationVersion])

  const activateInstances = useCallback(async (
    instances: PluginRuntimeInstance[],
    didCancel: () => boolean,
    options: {
      isTransactionCommitted: () => boolean
      replacePublishedRegistry?: boolean
      runtimeEndpoint?: PluginRuntimeEndpoint
      targetRegistry?: PluginRegistry
    }
  ) => {
    if (pluginServerBaseUrl == null) return
    if (didCancel()) return
    const targetRegistry = options.targetRegistry ?? registryRef.current
    const replacePublishedRegistry = options.replacePublishedRegistry ?? true
    if (replacePublishedRegistry) {
      disposeRegistryInstances(targetRegistry, instancesRef.current)
    }
    if (didCancel()) return
    targetRegistry.setInstances(instances)
    if (replacePublishedRegistry) instancesRef.current = instances

    const activateInstance = async (instance: PluginRuntimeInstance) => {
      if ((!options.isTransactionCommitted() && didCancel()) || instance.enabled === false) return
      const activationVersion = nextActivationVersion(targetRegistry, instance.scope)
      if (!options.isTransactionCommitted() && didCancel()) return
      await activatePluginClient({
        getImportVersion: () => getImportVersion(instance.scope),
        instance,
        isActivationCurrent: () =>
          isActivationCurrent(targetRegistry, instance.scope, activationVersion) &&
          (options.isTransactionCommitted() || !didCancel()),
        notifications,
        registry: targetRegistry,
        reloadPlugin: reloadTargetPlugin,
        runtimeEndpoint: options.runtimeEndpoint ?? runtimeEndpointRef.current,
        serverBaseUrl: pluginServerBaseUrl
      })
    }

    const reloadTargetPlugin = async (scope: string) => {
      if (!options.isTransactionCommitted() && didCancel()) return
      const instance = instances.find(item => item.scope === scope)
      if (instance == null) return
      bumpImportVersion(scope)
      nextActivationVersion(targetRegistry, scope)
      targetRegistry.disposeScope(scope)
      if (instance.enabled === false) return
      targetRegistry.registerInstanceContributions(instance)
      await activateInstance(instance)
    }

    for (const instance of instances) {
      if (didCancel()) return
      await activateInstance(instance)
    }
  }, [
    bumpImportVersion,
    disposeRegistryInstances,
    getImportVersion,
    isActivationCurrent,
    nextActivationVersion,
    notifications,
    pluginServerBaseUrl
  ])

  const commitStagedRegistry = useCallback((
    stagedRegistry: PluginRegistry,
    instances: PluginRuntimeInstance[],
    runtime: PluginRuntimeEndpoint | undefined
  ) => {
    const previousRegistry = registryRef.current
    const previousInstances = instancesRef.current
    registryRef.current = stagedRegistry
    instancesRef.current = instances
    runtimeEndpointRef.current = runtime
    retiredRegistriesRef.current.push({
      instances: previousInstances,
      registry: previousRegistry
    })
    setPublishedRuntime({
      registry: stagedRegistry,
      runtimeEndpoint: runtime,
      snapshot: stagedRegistry.getSnapshot()
    })
  }, [])

  useEffect(() => {
    const retired = retiredRegistriesRef.current.splice(0)
    retired.forEach(item => disposeRegistryInstances(item.registry, item.instances))
  }, [disposeRegistryInstances, registry])

  const loadAndActivatePlugins = useCallback(async (
    options: PluginRefreshOptions = {},
    cancelActivationWhenStale = false
  ) => {
    if (pluginServerBaseUrl == null) return undefined
    const requestRevision = requestRevisionRef.current + 1
    requestRevisionRef.current = requestRevision
    const isRequestCurrent = () => options.isCurrent?.() ?? true
    let pluginSnapshot
    try {
      pluginSnapshot = await listPluginSnapshot({ serverBaseUrl: pluginServerBaseUrl })
    } catch (error) {
      if (
        !isRequestCurrent() ||
        requestRevision !== requestRevisionRef.current ||
        requestRevision < committedRequestRevisionRef.current
      ) return undefined
      throw error
    }
    if (!isRequestCurrent() || requestRevision < committedRequestRevisionRef.current) return undefined
    committedRequestRevisionRef.current = requestRevision
    const activationRevision = activationRefreshRevisionRef.current + 1
    activationRefreshRevisionRef.current = activationRevision
    const isActivationCurrent = () => activationRefreshRevisionRef.current === activationRevision
    const isResultCurrent = () => isActivationCurrent() && isRequestCurrent()
    const didCancelActivation = () => !isActivationCurrent() || (cancelActivationWhenStale && !isRequestCurrent())
    let transactionCommitted = false
    const isTransactionCommitted = () => transactionCommitted
    let stagedRegistry: PluginRegistry | undefined
    try {
      if (cancelActivationWhenStale) {
        stagedRegistry = new PluginRegistry()
        stagedRegistry.setRuntimeContext({
          runtime: pluginSnapshot.runtime,
          surfaces: [surface]
        })
        await activateInstances(pluginSnapshot.plugins, didCancelActivation, {
          isTransactionCommitted,
          replacePublishedRegistry: false,
          runtimeEndpoint: pluginSnapshot.runtime,
          targetRegistry: stagedRegistry
        })
        if (didCancelActivation()) {
          disposeRegistryInstances(stagedRegistry, pluginSnapshot.plugins)
        } else {
          transactionCommitted = true
          commitStagedRegistry(stagedRegistry, pluginSnapshot.plugins, pluginSnapshot.runtime)
        }
      } else {
        setRuntimeSnapshot(pluginSnapshot.runtime)
        await activateInstances(pluginSnapshot.plugins, didCancelActivation, {
          isTransactionCommitted,
          runtimeEndpoint: pluginSnapshot.runtime
        })
        if (!didCancelActivation()) transactionCommitted = true
      }
    } catch (error) {
      if (stagedRegistry != null) {
        disposeRegistryInstances(stagedRegistry, pluginSnapshot.plugins)
      }
      throw error
    }
    return isResultCurrent() ? isResultCurrent : undefined
  }, [
    activateInstances,
    commitStagedRegistry,
    disposeRegistryInstances,
    pluginServerBaseUrl,
    setRuntimeSnapshot,
    surface
  ])

  const refreshPlugins = useCallback(async (
    options?: PluginRefreshOptions,
    cancelActivationWhenStale = false
  ) => {
    const isCurrent = await loadAndActivatePlugins(options, cancelActivationWhenStale)
    if (isCurrent?.() !== true) return { applied: false }
    updatePluginSnapshotStatus('ready')
    if (!isCurrent()) return { applied: false }
    setReady(true)
    return { applied: isCurrent() }
  }, [loadAndActivatePlugins, updatePluginSnapshotStatus])

  useEffect(() => {
    let didCancel = false
    updatePluginSnapshotStatus('loading')
    if (pluginServerBaseUrl == null) {
      bootstrapLoadRef.current = undefined
      setReady(true)
      return () => {
        didCancel = true
      }
    }
    const bootstrapLoad = loadAndActivatePlugins({ isCurrent: () => !didCancel })
      .then((isCurrent) => {
        if (isCurrent?.() !== true) return
        updatePluginSnapshotStatus('ready')
        if (!isCurrent()) return
        setReady(true)
      })
      .catch((error) => {
        if (didCancel) return
        updatePluginSnapshotStatus('error')
        registryRef.current.addDiagnostic({
          level: 'warning',
          message: `Failed to load plugins: ${error instanceof Error ? error.message : String(error)}`
        })
        setReady(true)
      })
    bootstrapLoadRef.current = bootstrapLoad
    void bootstrapLoad
    return () => {
      didCancel = true
      if (bootstrapLoadRef.current === bootstrapLoad) {
        bootstrapLoadRef.current = undefined
      }
      activationRefreshRevisionRef.current += 1
      committedRequestRevisionRef.current = requestRevisionRef.current + 1
      const currentRegistry = registryRef.current
      disposeRegistryInstances(currentRegistry, instancesRef.current)
      const retired = retiredRegistriesRef.current.splice(0)
      retired.forEach(item => disposeRegistryInstances(item.registry, item.instances))
      setRuntimeSnapshot(undefined)
    }
  }, [
    disposeRegistryInstances,
    loadAndActivatePlugins,
    pluginServerBaseUrl,
    setRuntimeSnapshot,
    updatePluginSnapshotStatus
  ])

  useEffect(() => {
    if (pluginServerBaseUrl == null) return
    let disposed = false
    let socket: WebSocket | undefined
    let connectTimer: ReturnType<typeof setTimeout> | undefined
    let connectionRevision = 0
    let hasOpenedConnection = false

    const closeSocket = (target: WebSocket | undefined) => {
      if (target == null) return
      if (target.readyState === WebSocket.CLOSED || target.readyState === WebSocket.CLOSING) return
      if (target.readyState === WebSocket.CONNECTING) {
        target.addEventListener('open', () => target.close(), { once: true })
        return
      }
      target.close()
    }

    const scheduleConnect = (delay = 0) => {
      if (disposed) return
      if (connectTimer != null) {
        clearTimeout(connectTimer)
      }
      connectTimer = setTimeout(() => {
        connectTimer = undefined
        connect()
      }, delay)
    }

    const connect = () => {
      if (disposed) return
      connectionRevision += 1
      const currentConnectionRevision = connectionRevision
      let currentSocket: WebSocket | undefined
      const isConnectionCurrent = () =>
        !disposed &&
        connectionRevision === currentConnectionRevision &&
        socket === currentSocket
      const invalidateConnection = () => {
        if (!isConnectionCurrent()) return false
        connectionRevision += 1
        if (socket === currentSocket) {
          socket = undefined
        }
        return true
      }
      const closeAndReconnect = () => {
        if (!invalidateConnection()) return
        closeSocket(currentSocket)
        scheduleConnect(1000)
      }
      currentSocket = createSocket<PluginWatchEvent>(
        {
          onOpen: async () => {
            if (!isConnectionCurrent()) return
            const isFirstOpen = !hasOpenedConnection
            hasOpenedConnection = true
            if (isFirstOpen) {
              if (pluginSnapshotStatusRef.current === 'loading') {
                await bootstrapLoadRef.current
              }
              if (!isConnectionCurrent() || pluginSnapshotStatusRef.current === 'ready') return
            }
            try {
              await refreshPlugins({ isCurrent: isConnectionCurrent }, true)
            } catch {
              closeAndReconnect()
            }
          },
          onMessage: (event) => {
            if (!isConnectionCurrent() || event.type !== 'plugin.changed') return
            if (event.scope === '*') {
              instancesRef.current.forEach(instance => bumpImportVersion(instance.scope))
            } else {
              bumpImportVersion(event.scope)
            }
            void refreshPlugins({ isCurrent: isConnectionCurrent }, true).catch(() => {
              closeAndReconnect()
            })
          },
          onClose: (event) => {
            if (!invalidateConnection()) return
            if (event.code !== 1008) scheduleConnect(1000)
          },
          onError: () => {
            closeAndReconnect()
          }
        },
        { channel: 'plugin', scope: '*' },
        { serverBaseUrl: pluginServerBaseUrl }
      )
      socket = currentSocket
    }

    scheduleConnect()
    return () => {
      disposed = true
      connectionRevision += 1
      if (connectTimer != null) {
        clearTimeout(connectTimer)
      }
      closeSocket(socket)
    }
  }, [bumpImportVersion, pluginServerBaseUrl, refreshPlugins])

  const contributionRuntimeSources = useMemo(() => [{
    pluginServerBaseUrl,
    registry,
    runtimeSource: resolvedRuntimeSource,
    snapshot
  }], [pluginServerBaseUrl, registry, resolvedRuntimeSource, snapshot])

  const value = useMemo<PluginContextValue>(() => ({
    contributionRuntimeSources,
    pluginSnapshotStatus,
    pluginServerBaseUrl,
    ready,
    refreshPlugins,
    registry,
    reloadPlugin,
    runtimeEndpoint,
    snapshot
  }), [
    contributionRuntimeSources,
    pluginServerBaseUrl,
    pluginSnapshotStatus,
    ready,
    refreshPlugins,
    registry,
    reloadPlugin,
    runtimeEndpoint,
    snapshot
  ])

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}
