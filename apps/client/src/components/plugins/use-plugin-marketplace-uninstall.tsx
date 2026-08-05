import { App } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PluginMarketplaceUninstallIdentity } from '@oneworks/types'

import { ApiError, getApiErrorMessage } from '#~/api.js'
import { getPluginMarketplaceUninstallPlan, uninstallPluginMarketplacePlugin } from '#~/plugins/marketplace-api'
import { projectPluginPresentationValue } from '#~/plugins/plugin-presentation'

import { PluginUninstallIntentConfirmContent } from './PluginUninstallConfirmContent'

interface PluginUninstallOperation {
  controller: AbortController
  generation: number
  identity: PluginMarketplaceUninstallIdentity
  phase: 'committed' | 'quoting' | 'removing'
}

interface UsePluginMarketplaceUninstallOptions {
  displayName?: string
  identity?: PluginMarketplaceUninstallIdentity
  onRemoved?: () => void
  refreshAfterRemoval: () => Promise<unknown>[]
  serverBaseUrl?: string
  surfaceKey: string
}

const identitiesMatch = (
  left: PluginMarketplaceUninstallIdentity | undefined,
  right: PluginMarketplaceUninstallIdentity | undefined
) => (
  left?.adapter === right?.adapter &&
  left?.marketplace === right?.marketplace &&
  left?.plugin === right?.plugin &&
  left?.scope === right?.scope
)

const createIdentityKey = (identity: PluginMarketplaceUninstallIdentity | undefined) => (
  identity == null
    ? ''
    : JSON.stringify([identity.adapter, identity.marketplace, identity.plugin, identity.scope])
)

export const usePluginMarketplaceUninstall = ({
  displayName,
  identity,
  onRemoved,
  refreshAfterRemoval,
  serverBaseUrl,
  surfaceKey
}: UsePluginMarketplaceUninstallOptions) => {
  const { message, modal } = App.useApp()
  const { t } = useTranslation()
  const [operation, setOperation] = useState<PluginUninstallOperation>()
  const activeIdentityRef = useRef(identity)
  const generationRef = useRef(0)
  const latestIdentityRef = useRef(identity)
  const modalRef = useRef<ReturnType<typeof modal.confirm>>()
  const operationRef = useRef<PluginUninstallOperation>()
  latestIdentityRef.current = identity
  const identityKey = createIdentityKey(identity)

  useEffect(() => {
    generationRef.current += 1
    operationRef.current?.controller.abort()
    operationRef.current = undefined
    activeIdentityRef.current = latestIdentityRef.current
    setOperation(undefined)
    modalRef.current?.destroy()
    modalRef.current = undefined

    return () => {
      generationRef.current += 1
      operationRef.current?.controller.abort()
      operationRef.current = undefined
      modalRef.current?.destroy()
      modalRef.current = undefined
    }
  }, [surfaceKey])

  useEffect(() => {
    const currentOperation = operationRef.current
    if (currentOperation == null) {
      activeIdentityRef.current = latestIdentityRef.current
      return
    }
    if (currentOperation.phase !== 'committed') {
      currentOperation.controller.abort()
      operationRef.current = undefined
      activeIdentityRef.current = latestIdentityRef.current
      setOperation(undefined)
      modalRef.current?.destroy()
      modalRef.current = undefined
    }
  }, [identityKey])

  const confirm = useCallback(() => {
    if (identity == null || operationRef.current != null) return
    const confirmedIdentity = identity
    const modalGeneration = generationRef.current
    modalRef.current?.destroy()
    modalRef.current = modal.confirm({
      autoFocusButton: 'cancel',
      cancelText: t('pluginStore.uninstall.cancel'),
      content: <PluginUninstallIntentConfirmContent identity={confirmedIdentity} />,
      okButtonProps: { danger: true },
      okText: t('pluginStore.uninstall.confirm'),
      title: t('pluginStore.uninstall.title', {
        name: projectPluginPresentationValue(displayName ?? confirmedIdentity.plugin)
      }),
      onCancel: () => {
        const currentOperation = operationRef.current
        if (
          identitiesMatch(currentOperation?.identity, confirmedIdentity) &&
          currentOperation?.generation === modalGeneration
        ) {
          currentOperation.controller.abort()
        }
      },
      onOk: async () => {
        if (
          operationRef.current != null ||
          !identitiesMatch(activeIdentityRef.current, confirmedIdentity)
        ) {
          return
        }
        const currentOperation: PluginUninstallOperation = {
          controller: new AbortController(),
          generation: generationRef.current,
          identity: confirmedIdentity,
          phase: 'quoting'
        }
        operationRef.current = currentOperation
        setOperation(currentOperation)
        const isCurrentOperation = () => (
          operationRef.current === currentOperation &&
          generationRef.current === currentOperation.generation
        )
        try {
          const plan = await getPluginMarketplaceUninstallPlan(confirmedIdentity.scope, {
            serverBaseUrl,
            signal: currentOperation.controller.signal
          })
          if (
            currentOperation.controller.signal.aborted ||
            !isCurrentOperation() ||
            plan.available !== true ||
            !identitiesMatch(plan.identity, confirmedIdentity)
          ) {
            if (!currentOperation.controller.signal.aborted && isCurrentOperation()) {
              throw new Error(t('pluginStore.uninstall.failed'))
            }
            return
          }
          currentOperation.phase = 'removing'
          await uninstallPluginMarketplacePlugin(confirmedIdentity.scope, plan.token, {
            serverBaseUrl,
            signal: currentOperation.controller.signal
          })
          if (currentOperation.controller.signal.aborted || !isCurrentOperation()) return
          currentOperation.phase = 'committed'
          const refreshResults = await Promise.allSettled(refreshAfterRemoval())
          if (currentOperation.controller.signal.aborted || !isCurrentOperation()) return
          if (refreshResults.some(result => result.status === 'rejected')) {
            void message.error(t('pluginStore.uninstall.refreshFailed'))
          } else {
            void message.success(t('pluginStore.uninstall.success'))
          }
          onRemoved?.()
        } catch (error) {
          if (currentOperation.controller.signal.aborted || !isCurrentOperation()) return
          if (error instanceof ApiError && error.code === 'plugin_uninstall_plan_stale') {
            modalRef.current?.destroy()
            modalRef.current = undefined
            void message.error(t('pluginStore.uninstall.stale'))
            return
          }
          void message.error(getApiErrorMessage(error, t('pluginStore.uninstall.failed')))
          throw error
        } finally {
          if (operationRef.current === currentOperation) {
            operationRef.current = undefined
            activeIdentityRef.current = latestIdentityRef.current
            setOperation(undefined)
          }
        }
      }
    })
  }, [displayName, identity, message, modal, onRemoved, refreshAfterRemoval, serverBaseUrl, t])

  return {
    available: identity != null,
    confirm,
    pending: operation != null
  }
}
