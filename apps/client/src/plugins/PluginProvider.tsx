/* eslint-disable max-lines -- provider coordinates plugin activation, relay-aware sources, and watch lifecycle. */
import type { PluginRuntimeEndpoint } from '@oneworks/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { getLauncherManagerServerBaseUrl } from '#~/api/launcher'
import { useNotifications } from '#~/notifications/NotificationProvider'
import { getRuntimeWorkspaceId, isServerManagerRole } from '#~/runtime-config'
import { createSocket } from '#~/ws.js'

import { listPluginSnapshot } from './api'
import { PluginContext } from './plugin-context'
import type { PluginContextValue } from './plugin-context'
import type { PluginContributionSurface, PluginRuntimeInstance } from './plugin-manifest'
import { PluginRegistry } from './plugin-registry'
import { activatePluginClient } from './plugin-runtime'

interface PluginWatchEvent {
  type: 'plugin.changed' | 'plugin.ready' | 'plugin.watch.updated'
  scope: string
}

type PluginRuntimeSource = 'current' | 'manager'

interface PluginProviderProps {
  children: ReactNode
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
  runtimeSource,
  surface = 'workspace'
}: PluginProviderProps) {
  const notifications = useNotifications()
  const registry = useMemo(() => new PluginRegistry(), [])
  const instancesRef = useRef<PluginRuntimeInstance[]>([])
  const activationVersionsRef = useRef(new Map<string, number>())
  const importVersionsRef = useRef(new Map<string, number>())
  const runtimeEndpointRef = useRef<PluginRuntimeEndpoint | undefined>(undefined)
  const [runtimeEndpoint, setRuntimeEndpoint] = useState<PluginRuntimeEndpoint | undefined>(undefined)
  const [pluginSnapshotStatus, setPluginSnapshotStatus] = useState<'error' | 'loading' | 'ready'>('loading')
  const [snapshot, setSnapshot] = useState(() => registry.getSnapshot())

  useEffect(() =>
    registry.subscribe(() => {
      setSnapshot(registry.getSnapshot())
    }), [registry])

  const pluginServerBaseUrl = useMemo(() => {
    return resolvePluginRuntimeSource(runtimeSource) === 'manager'
      ? getLauncherManagerServerBaseUrl()
      : undefined
  }, [runtimeSource])

  const setRuntimeSnapshot = useCallback((runtime: PluginRuntimeEndpoint | undefined) => {
    registry.setRuntimeContext({
      runtime,
      surfaces: [surface]
    })
    runtimeEndpointRef.current = runtime
    setRuntimeEndpoint(runtime)
  }, [registry, surface])

  const getImportVersion = useCallback((scope: string) => importVersionsRef.current.get(scope) ?? 0, [])
  const bumpImportVersion = useCallback((scope: string) => {
    importVersionsRef.current.set(scope, (importVersionsRef.current.get(scope) ?? 0) + 1)
  }, [])
  const nextActivationVersion = useCallback((scope: string) => {
    const next = (activationVersionsRef.current.get(scope) ?? 0) + 1
    activationVersionsRef.current.set(scope, next)
    return next
  }, [])
  const isActivationCurrent = useCallback(
    (scope: string, version: number) => activationVersionsRef.current.get(scope) === version,
    []
  )

  const reloadPlugin = useCallback(async (scope: string) => {
    const instance = instancesRef.current.find(item => item.scope === scope)
    if (instance == null) return
    bumpImportVersion(scope)
    const activationVersion = nextActivationVersion(scope)
    registry.disposeScope(scope)
    if (instance.enabled === false) return
    registry.registerInstanceContributions(instance)
    await activatePluginClient({
      getImportVersion: () => getImportVersion(scope),
      instance,
      isActivationCurrent: () => isActivationCurrent(scope, activationVersion),
      notifications,
      registry,
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
    pluginServerBaseUrl,
    registry
  ])

  const activateInstances = useCallback(async (instances: PluginRuntimeInstance[], didCancel: () => boolean) => {
    instancesRef.current.forEach((instance) => {
      nextActivationVersion(instance.scope)
      registry.disposeScope(instance.scope)
    })
    instancesRef.current = instances
    registry.setInstances(instances)
    for (const instance of instances) {
      if (didCancel()) return
      if (instance.enabled === false) continue
      const activationVersion = nextActivationVersion(instance.scope)
      await activatePluginClient({
        getImportVersion: () => getImportVersion(instance.scope),
        instance,
        isActivationCurrent: () => !didCancel() && isActivationCurrent(instance.scope, activationVersion),
        notifications,
        registry,
        reloadPlugin,
        runtimeEndpoint: runtimeEndpointRef.current,
        serverBaseUrl: pluginServerBaseUrl
      })
    }
  }, [
    getImportVersion,
    isActivationCurrent,
    nextActivationVersion,
    notifications,
    pluginServerBaseUrl,
    registry,
    reloadPlugin
  ])

  const refreshPlugins = useCallback(async () => {
    const pluginSnapshot = await listPluginSnapshot({ serverBaseUrl: pluginServerBaseUrl })
    setRuntimeSnapshot(pluginSnapshot.runtime)
    await activateInstances(pluginSnapshot.plugins, () => false)
  }, [activateInstances, pluginServerBaseUrl, setRuntimeSnapshot])

  useEffect(() => {
    let didCancel = false
    setPluginSnapshotStatus('loading')
    void listPluginSnapshot({ serverBaseUrl: pluginServerBaseUrl })
      .then(async pluginSnapshot => {
        if (didCancel) return
        setRuntimeSnapshot(pluginSnapshot.runtime)
        await activateInstances(pluginSnapshot.plugins, () => didCancel)
        if (!didCancel) setPluginSnapshotStatus('ready')
      })
      .catch((error) => {
        if (didCancel) return
        setPluginSnapshotStatus('error')
        registry.addDiagnostic({
          level: 'warning',
          message: `Failed to load plugins: ${error instanceof Error ? error.message : String(error)}`
        })
      })
    return () => {
      didCancel = true
      instancesRef.current.forEach((instance) => {
        nextActivationVersion(instance.scope)
        registry.disposeScope(instance.scope)
      })
      setRuntimeSnapshot(undefined)
    }
  }, [activateInstances, nextActivationVersion, pluginServerBaseUrl, registry, setRuntimeSnapshot])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | undefined
    let connectTimer: ReturnType<typeof setTimeout> | undefined

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
      socket = createSocket<PluginWatchEvent>(
        {
          onMessage: (event) => {
            if (disposed || event.type !== 'plugin.changed') return
            if (event.scope === '*') {
              instancesRef.current.forEach(instance => bumpImportVersion(instance.scope))
            } else {
              bumpImportVersion(event.scope)
            }
            void refreshPlugins()
          },
          onClose: (event) => {
            if (disposed) return
            if (event.code === 1008) return
            scheduleConnect(1000)
          },
          onError: () => {
            closeSocket(socket)
          }
        },
        { channel: 'plugin', scope: '*' },
        { serverBaseUrl: pluginServerBaseUrl }
      )
    }

    scheduleConnect()
    return () => {
      disposed = true
      if (connectTimer != null) {
        clearTimeout(connectTimer)
      }
      closeSocket(socket)
    }
  }, [bumpImportVersion, pluginServerBaseUrl, refreshPlugins])

  const value = useMemo<PluginContextValue>(() => ({
    pluginSnapshotStatus,
    pluginServerBaseUrl,
    refreshPlugins,
    registry,
    reloadPlugin,
    runtimeEndpoint,
    snapshot
  }), [
    pluginServerBaseUrl,
    pluginSnapshotStatus,
    refreshPlugins,
    registry,
    reloadPlugin,
    runtimeEndpoint,
    snapshot
  ])

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}
