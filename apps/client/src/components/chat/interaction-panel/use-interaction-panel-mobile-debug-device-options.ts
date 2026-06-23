import { useCallback, useEffect, useRef, useState } from 'react'

import type { InteractionPanelMobileDebugDeviceOption } from './interaction-panel-mobile-debug-pages'
import { listMobileDebugTargets } from './mobile-debug-platform'

const toDeviceOptions = (devices: DesktopMobileDebugDevice[]): InteractionPanelMobileDebugDeviceOption[] =>
  devices.map(device => ({
    id: device.id,
    label: device.label,
    state: device.state
  }))

const hasSameDeviceOptions = (
  left: InteractionPanelMobileDebugDeviceOption[],
  right: InteractionPanelMobileDebugDeviceOption[]
) =>
  left.length === right.length &&
  left.every((device, index) => {
    const nextDevice = right[index]
    return nextDevice != null &&
      device.id === nextDevice.id &&
      device.label === nextDevice.label &&
      device.state === nextDevice.state
  })

export function useInteractionPanelMobileDebugDeviceOptions(
  seedDeviceOptions?: InteractionPanelMobileDebugDeviceOption[]
) {
  const [deviceOptions, setDeviceOptions] = useState<InteractionPanelMobileDebugDeviceOption[]>(
    () => seedDeviceOptions ?? []
  )
  const isRefreshingRef = useRef(false)

  useEffect(() => {
    if (seedDeviceOptions == null || hasSameDeviceOptions(deviceOptions, seedDeviceOptions)) return
    setDeviceOptions(seedDeviceOptions)
  }, [deviceOptions, seedDeviceOptions])

  const refreshDeviceOptions = useCallback(async () => {
    if (isRefreshingRef.current) return

    isRefreshingRef.current = true
    try {
      const state = await listMobileDebugTargets({
        discoverNetworkTargets: false,
        discoverUsbDevices: true,
        networkTargets: [],
        portForwardingRules: []
      })
      setDeviceOptions(toDeviceOptions(state.devices))
    } catch {
      // The add menu can still open with the cached options or empty state.
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  return { deviceOptions, refreshDeviceOptions }
}
