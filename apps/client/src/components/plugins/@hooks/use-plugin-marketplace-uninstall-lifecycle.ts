import { useEffect, useRef, useState } from 'react'

import type { PluginMarketplaceUninstallIdentity } from '@oneworks/types'

import {
  claimMarketplaceSelectionIntentAuthority,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'

import {
  createPluginMarketplaceUninstallIdentityKey,
  pluginMarketplaceUninstallIdentitiesMatch
} from '../@core/plugin-marketplace-uninstall'
import type { PluginUninstallOperation } from '../@core/plugin-marketplace-uninstall'

const reconciliationRetryDelaysMs = [250, 1_000, 3_000, 10_000, 30_000]

export const usePluginMarketplaceUninstallLifecycle = (params: {
  identity?: PluginMarketplaceUninstallIdentity
  serverBaseUrl?: string
  surfaceKey: string
}) => {
  const [operation, setOperation] = useState<PluginUninstallOperation>()
  const activeIdentityRef = useRef(params.identity)
  const generationRef = useRef(0)
  const latestIdentityRef = useRef(params.identity)
  const mountedRef = useRef(false)
  const operationRef = useRef<PluginUninstallOperation>()
  const serverOperationsRef = useRef(new Set<PluginUninstallOperation>())
  const serverKey = resolveMarketplaceServerKey(params.serverBaseUrl)
  const latestServerKeyRef = useRef(serverKey)
  const serverRevisionRef = useRef(0)
  latestIdentityRef.current = params.identity
  if (latestServerKeyRef.current !== serverKey) {
    latestServerKeyRef.current = serverKey
    serverRevisionRef.current += 1
  }
  const identityKey = createPluginMarketplaceUninstallIdentityKey(params.identity)

  const clearView = (current: PluginUninstallOperation) => {
    if (operationRef.current !== current) return
    operationRef.current = undefined
    activeIdentityRef.current = latestIdentityRef.current
    setOperation(undefined)
  }
  const transition = (
    current: PluginUninstallOperation,
    phase: PluginUninstallOperation['phase']
  ) => {
    current.phase = phase
    if (operationRef.current === current) setOperation({ ...current })
  }
  const finish = (current: PluginUninstallOperation) => {
    current.reconciliationWait?.cancel()
    current.reconciliationWait = undefined
    current.authority.release()
    serverOperationsRef.current.delete(current)
    clearView(current)
  }
  const isServerCurrent = (current: PluginUninstallOperation) => (
    mountedRef.current &&
    current.authority.isCurrent() &&
    serverRevisionRef.current === current.serverRevision
  )
  const isViewCurrent = (current: PluginUninstallOperation) => (
    operationRef.current === current &&
    isServerCurrent(current) &&
    generationRef.current === current.generation &&
    latestServerKeyRef.current === current.serverKey
  )
  const waitForReconciliation = async (current: PluginUninstallOperation, attempt: number) => {
    if (!isServerCurrent(current)) return false
    const delay = reconciliationRetryDelaysMs[Math.min(attempt, reconciliationRetryDelaysMs.length - 1)]!
    let settle = () => undefined
    let active = true
    const promise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!active) return
        active = false
        resolve()
      }, delay)
      settle = () => {
        if (!active) return
        active = false
        clearTimeout(timer)
        resolve()
      }
    })
    const wait = { cancel: settle, promise }
    current.reconciliationWait = wait
    await promise
    if (current.reconciliationWait === wait) current.reconciliationWait = undefined
    return isServerCurrent(current)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      for (const current of serverOperationsRef.current) {
        current.controller.abort()
        current.reconciliationWait?.cancel()
        current.authority.release()
      }
      serverOperationsRef.current.clear()
      operationRef.current = undefined
    }
  }, [])
  useEffect(() => {
    generationRef.current += 1
    const previous = operationRef.current
    const keepServerOperation = previous != null &&
      previous.phase !== 'quoting' &&
      previous.serverKey === serverKey &&
      previous.serverRevision === serverRevisionRef.current
    if (!keepServerOperation) previous?.controller.abort()
    const reboundOperation = [...serverOperationsRef.current].find(current =>
      current.phase !== 'quoting' &&
      current.serverKey === serverKey &&
      current.serverRevision === serverRevisionRef.current &&
      isServerCurrent(current) &&
      pluginMarketplaceUninstallIdentitiesMatch(current.identity, latestIdentityRef.current)
    )
    operationRef.current = reboundOperation
    activeIdentityRef.current = latestIdentityRef.current
    setOperation(reboundOperation == null ? undefined : { ...reboundOperation })
    if (previous?.phase === 'quoting') finish(previous)
    for (const current of serverOperationsRef.current) {
      if (isServerCurrent(current)) continue
      current.controller.abort()
      current.reconciliationWait?.cancel()
      current.authority.release()
      serverOperationsRef.current.delete(current)
    }
  }, [serverKey, params.surfaceKey])
  useEffect(() => {
    const current = operationRef.current
    if (current == null) {
      activeIdentityRef.current = latestIdentityRef.current
      return
    }
    if (current.phase === 'quoting') {
      current.controller.abort()
      finish(current)
    }
  }, [identityKey])

  const begin = (identity: PluginMarketplaceUninstallIdentity) => {
    if (
      operationRef.current != null ||
      !pluginMarketplaceUninstallIdentitiesMatch(activeIdentityRef.current, identity)
    ) return undefined
    const current: PluginUninstallOperation = {
      authority: claimMarketplaceSelectionIntentAuthority(serverKey, {
        marketplace: identity.marketplace,
        plugin: identity.plugin,
        target: 'project'
      }),
      controller: new AbortController(),
      generation: generationRef.current,
      identity,
      phase: 'quoting',
      serverKey,
      serverRevision: serverRevisionRef.current
    }
    serverOperationsRef.current.add(current)
    operationRef.current = current
    setOperation(current)
    return current
  }
  const cancel = (identity: PluginMarketplaceUninstallIdentity) => {
    const current = operationRef.current
    if (pluginMarketplaceUninstallIdentitiesMatch(current?.identity, identity)) current?.controller.abort()
  }

  return {
    begin,
    cancel,
    finish,
    isServerCurrent,
    isViewCurrent,
    indeterminate: operation?.indeterminateNotified === true,
    pending: operation != null,
    phase: operation?.phase,
    transition,
    waitForReconciliation
  }
}
