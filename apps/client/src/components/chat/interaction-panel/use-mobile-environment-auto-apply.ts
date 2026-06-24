import { useEffect, useRef } from 'react'

import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'

export function useMobileEnvironmentAutoApply({
  action,
  actionKey,
  delayMs = 300,
  disabled = false,
  runEnvironmentAction,
  signature
}: {
  action: DesktopMobileDeviceEnvironmentAction
  actionKey: string
  delayMs?: number
  disabled?: boolean
  runEnvironmentAction: MobileEnvironmentActionRunner
  signature: string
}) {
  const lastAppliedSignatureRef = useRef(signature)

  useEffect(() => {
    if (disabled || lastAppliedSignatureRef.current === signature) return

    const timer = window.setTimeout(() => {
      lastAppliedSignatureRef.current = signature
      void runEnvironmentAction(actionKey, action, { silentSuccess: true })
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [action, actionKey, delayMs, disabled, runEnvironmentAction, signature])
}
