/* eslint-disable max-lines -- provider coordinates plugin activation, relay-aware sources, and watch lifecycle. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useNotifications } from '#~/notifications/NotificationProvider'
import { getRuntimeWorkspaceId } from '#~/runtime-config'
import {
  WORKSPACE_CONNECTION_CHANGE_EVENT,
  readRememberedWorkspaceConnectionMetadata
} from '#~/workspace-connection-state'
import { createSocket } from '#~/ws.js'

import { listPlugins } from './api'
import { PluginContext } from './plugin-context'
import type { PluginContextValue } from './plugin-context'
import type { PluginRuntimeInstance } from './plugin-manifest'
import { PluginRegistry } from './plugin-registry'
import { activatePluginClient } from './plugin-runtime'

interface PluginWatchEvent {
  type: 'plugin.changed' | 'plugin.ready' | 'plugin.watch.updated'
  scope: string
}

export function PluginProvider({ children }: { children: ReactNode }) {
  const notifications = useNotifications()
  const registry = useMemo(() => new PluginRegistry(), [])
  const instancesRef = useRef<PluginRuntimeInstance[]>([])
  const activationVersionsRef = useRef(new Map<string, number>())
  const importVersionsRef = useRef(new Map<string, number>())
  const [snapshot, setSnapshot] = useState(() => registry.getSnapshot())
  const [workspaceConnectionRevision, setWorkspaceConnectionRevision] = useState(0)

  useEffect(() =>
    registry.subscribe(() => {
      setSnapshot(registry.getSnapshot())
    }), [registry])

  useEffect(() => {
    const handleWorkspaceConnectionChange = () => {
      setWorkspaceConnectionRevision(revision => revision + 1)
    }
    window.addEventListener(WORKSPACE_CONNECTION_CHANGE_EVENT, handleWorkspaceConnectionChange)
    return () => {
      window.removeEventListener(WORKSPACE_CONNECTION_CHANGE_EVENT, handleWorkspaceConnectionChange)
    }
  }, [])

  const pluginServerBaseUrl = useMemo(() => {
    const workspaceId = getRuntimeWorkspaceId()
    if (workspaceId == null) return undefined
    return readRememberedWorkspaceConnectionMetadata(workspaceId, 'relay')?.managerServerBaseUrl
  }, [workspaceConnectionRevision])

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
    const instances = await listPlugins({ serverBaseUrl: pluginServerBaseUrl })
    await activateInstances(instances, () => false)
  }, [activateInstances, pluginServerBaseUrl])

  useEffect(() => {
    let didCancel = false
    void listPlugins({ serverBaseUrl: pluginServerBaseUrl })
      .then(async instances => {
        if (didCancel) return
        await activateInstances(instances, () => didCancel)
      })
      .catch((error) => {
        if (didCancel) return
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
    }
  }, [activateInstances, nextActivationVersion, pluginServerBaseUrl, registry])

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
    refreshPlugins,
    registry,
    reloadPlugin,
    snapshot
  }), [refreshPlugins, registry, reloadPlugin, snapshot])

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}
