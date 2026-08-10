import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, getApiErrorMessage } from '#~/api/base'
import { getPluginMarketplaceUninstallPlan, uninstallPluginMarketplacePlugin } from '#~/plugins/marketplace-api'
import {
  publishMarketplaceUninstallAuthority,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'
import { projectPluginPresentationValue } from '#~/plugins/plugin-presentation'

import {
  createPluginMarketplaceUninstallIdentityKey,
  pluginMarketplaceUninstallIdentitiesMatch
} from './@core/plugin-marketplace-uninstall'
import type { UsePluginMarketplaceUninstallOptions } from './@core/plugin-marketplace-uninstall'
import {
  isPluginMarketplaceUninstallCommitUnknownError,
  reconcilePluginMarketplaceUninstall
} from './@core/plugin-marketplace-uninstall-convergence'
import { usePluginMarketplaceUninstallLifecycle } from './@hooks/use-plugin-marketplace-uninstall-lifecycle'
import { PluginUninstallIntentConfirmContent } from './PluginUninstallConfirmContent'

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
  const modalRef = useRef<ReturnType<typeof modal.confirm>>()
  const serverKey = resolveMarketplaceServerKey(serverBaseUrl)
  const identityKey = createPluginMarketplaceUninstallIdentityKey(identity)
  const notifyCommitted = useCallback((refreshFailed: boolean) => {
    if (refreshFailed) {
      void message.error(t('pluginStore.uninstall.refreshFailed'))
    } else {
      void message.success(t('pluginStore.uninstall.success'))
    }
    onRemoved?.()
  }, [message, onRemoved, t])
  const lifecycle = usePluginMarketplaceUninstallLifecycle({
    identity,
    serverBaseUrl,
    surfaceKey
  })

  useEffect(() => {
    modalRef.current?.destroy()
    modalRef.current = undefined
    return () => {
      modalRef.current?.destroy()
      modalRef.current = undefined
    }
  }, [identityKey, serverKey, surfaceKey])

  const confirm = useCallback(() => {
    if (identity == null || lifecycle.pending) return
    const confirmedIdentity = identity
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
      onCancel: () => lifecycle.cancel(confirmedIdentity),
      onOk: async () => {
        const current = lifecycle.begin(confirmedIdentity)
        if (current == null) return
        try {
          const plan = await getPluginMarketplaceUninstallPlan(confirmedIdentity.scope, {
            serverBaseUrl,
            signal: current.controller.signal
          })
          if (
            current.controller.signal.aborted ||
            !lifecycle.isViewCurrent(current) ||
            plan.available !== true ||
            !pluginMarketplaceUninstallIdentitiesMatch(plan.identity, confirmedIdentity)
          ) {
            if (!current.controller.signal.aborted && lifecycle.isViewCurrent(current)) {
              throw new Error(t('pluginStore.uninstall.failed'))
            }
            return
          }
          lifecycle.transition(current, 'removing')
          await uninstallPluginMarketplacePlugin(confirmedIdentity.scope, plan.token, {
            serverBaseUrl,
            signal: current.controller.signal
          })
          if (!lifecycle.isServerCurrent(current)) return
          lifecycle.transition(current, 'committed')
          publishMarketplaceUninstallAuthority(current.serverKey, confirmedIdentity)
          const reconciliation = await reconcilePluginMarketplaceUninstall({
            identity: confirmedIdentity,
            isServerCurrent: () => lifecycle.isServerCurrent(current),
            refresh: refreshAfterRemoval,
            serverKey: current.serverKey
          })
          try {
            if (!reconciliation.isCurrent() || !lifecycle.isServerCurrent(current)) return
            if (lifecycle.isViewCurrent(current)) notifyCommitted(reconciliation.refreshFailed)
          } finally {
            reconciliation.release()
          }
        } catch (error) {
          if (
            current.phase === 'removing' &&
            isPluginMarketplaceUninstallCommitUnknownError(error) &&
            lifecycle.isServerCurrent(current)
          ) {
            let attempt = 0
            while (lifecycle.isServerCurrent(current)) {
              lifecycle.transition(current, 'reconciling')
              const reconciliation = await reconcilePluginMarketplaceUninstall({
                identity: confirmedIdentity,
                isServerCurrent: () => lifecycle.isServerCurrent(current),
                refresh: refreshAfterRemoval,
                serverKey: current.serverKey
              })
              let committed = false
              try {
                if (!lifecycle.isServerCurrent(current)) return
                if (reconciliation.isCurrent() && reconciliation.state === 'committed') {
                  lifecycle.transition(current, 'committed')
                  publishMarketplaceUninstallAuthority(current.serverKey, confirmedIdentity)
                  if (lifecycle.isViewCurrent(current)) notifyCommitted(false)
                  committed = true
                }
              } finally {
                reconciliation.release()
              }
              if (committed) return
              const shouldNotify = current.indeterminateNotified !== true
              current.indeterminateNotified = true
              lifecycle.transition(current, 'indeterminate')
              if (lifecycle.isViewCurrent(current) && shouldNotify) {
                void message.info(t('pluginStore.uninstall.indeterminate'))
              }
              if (!await lifecycle.waitForReconciliation(current, attempt)) return
              attempt += 1
            }
            return
          }
          if (current.controller.signal.aborted || !lifecycle.isViewCurrent(current)) return
          if (error instanceof ApiError && error.code === 'plugin_uninstall_plan_stale') {
            modalRef.current?.destroy()
            modalRef.current = undefined
            void message.error(t('pluginStore.uninstall.stale'))
            return
          }
          void message.error(getApiErrorMessage(error, t('pluginStore.uninstall.failed')))
          throw error
        } finally {
          lifecycle.finish(current)
        }
      }
    })
  }, [displayName, identity, lifecycle, message, modal, notifyCommitted, refreshAfterRemoval, serverBaseUrl, t])
  return {
    available: identity != null,
    confirm,
    indeterminate: lifecycle.indeterminate,
    pending: lifecycle.pending
  }
}
