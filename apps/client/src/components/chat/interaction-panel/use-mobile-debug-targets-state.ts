import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { readMobileDebugConfig, writeMobileDebugConfig } from './mobile-debug-config-state'
import type { MobileDebugConfigState } from './mobile-debug-config-state'
import { listMobileDebugTargets } from './mobile-debug-platform'
import {
  isMobileDebugTargetsCacheFresh,
  readMobileDebugTargetsCacheEntry,
  writeMobileDebugTargetsCacheEntry
} from './mobile-debug-targets-cache-state'

const refreshIntervalMs = 3000

const buildMobileDebugTargetsRequestConfig = (
  config: MobileDebugConfigState,
  selectedDeviceId: string | undefined
): DesktopMobileDebugConfig => ({ ...config, selectedDeviceId })

export function useMobileDebugTargetsState({
  isActive,
  isConfigMode,
  selectedDeviceId
}: {
  isActive: boolean
  isConfigMode: boolean
  selectedDeviceId: string | undefined
}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(readMobileDebugConfig)
  const [state, setState] = useState<DesktopMobileDebugTargetsResponse | null>(() => {
    if (isConfigMode) return null
    return readMobileDebugTargetsCacheEntry(
      buildMobileDebugTargetsRequestConfig(readMobileDebugConfig(), selectedDeviceId)
    )?.state ?? null
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const isRefreshingRef = useRef(false)

  const updateConfig = useCallback((updater: (current: MobileDebugConfigState) => MobileDebugConfigState) => {
    setConfig(current => {
      const nextConfig = updater(current)
      writeMobileDebugConfig(nextConfig)
      return nextConfig
    })
  }, [])

  const refreshTargets = useCallback(async () => {
    if (isRefreshingRef.current) return

    isRefreshingRef.current = true
    setIsLoading(true)
    setError(null)
    const requestConfig = buildMobileDebugTargetsRequestConfig(config, selectedDeviceId)
    try {
      const nextState = await listMobileDebugTargets(requestConfig)
      writeMobileDebugTargetsCacheEntry(requestConfig, nextState)
      setState(nextState)
    } catch {
      setError(t('common.operationFailed'))
    } finally {
      isRefreshingRef.current = false
      setIsLoading(false)
    }
  }, [config, selectedDeviceId, t])

  const refreshAdbStatus = useCallback(async () => {
    if (isRefreshingRef.current) return

    isRefreshingRef.current = true
    try {
      setState(
        await listMobileDebugTargets({
          discoverNetworkTargets: false,
          discoverUsbDevices: true,
          networkTargets: [],
          portForwardingRules: []
        })
      )
    } catch {
      // Keep the existing settings page visible when lightweight status probing fails.
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isActive || isConfigMode) return
    const requestConfig = buildMobileDebugTargetsRequestConfig(config, selectedDeviceId)
    const cachedEntry = readMobileDebugTargetsCacheEntry(requestConfig)
    if (cachedEntry != null) setState(cachedEntry.state)
    else setState(null)
    if (cachedEntry == null || !isMobileDebugTargetsCacheFresh(cachedEntry)) {
      void refreshTargets()
    }
    const refreshTimer = window.setInterval(() => void refreshTargets(), refreshIntervalMs)
    return () => window.clearInterval(refreshTimer)
  }, [config, isActive, isConfigMode, refreshTargets, selectedDeviceId])

  useEffect(() => {
    if (!isActive || !isConfigMode) return
    void refreshAdbStatus()
    const refreshTimer = window.setInterval(() => void refreshAdbStatus(), refreshIntervalMs)
    return () => window.clearInterval(refreshTimer)
  }, [isActive, isConfigMode, refreshAdbStatus])

  return {
    config,
    error,
    isAdbMissing: state?.adbMissing === true || state?.errors.includes('ADB was not found.') === true,
    isLoading,
    state,
    updateConfig
  }
}
