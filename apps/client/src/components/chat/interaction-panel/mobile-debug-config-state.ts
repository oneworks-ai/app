export type MobileDebugConfigState =
  & Omit<Required<DesktopMobileDebugConfig>, 'selectedDeviceId'>
  & Pick<DesktopMobileDebugConfig, 'selectedDeviceId'>

const mobileDebugConfigStorageKey = 'chatInteractionMobileDebugConfig'

export const createMobileDebugConfigId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const createDefaultMobileDebugConfig = (): MobileDebugConfigState => ({
  discoverNetworkTargets: true,
  discoverUsbDevices: true,
  networkTargets: [],
  portForwardingRules: [],
  selectedDeviceId: undefined
})

const normalizeMobileDebugConfig = (value: unknown): MobileDebugConfigState => {
  const defaults = createDefaultMobileDebugConfig()
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return defaults
  const record = value as Partial<DesktopMobileDebugConfig>
  return {
    discoverNetworkTargets: record.discoverNetworkTargets !== false,
    discoverUsbDevices: record.discoverUsbDevices !== false,
    networkTargets: Array.isArray(record.networkTargets)
      ? record.networkTargets.filter(item => item.address.trim() !== '')
      : [],
    portForwardingRules: Array.isArray(record.portForwardingRules)
      ? record.portForwardingRules.filter(item => item.localAddress.trim() !== '')
      : [],
    selectedDeviceId: typeof record.selectedDeviceId === 'string' && record.selectedDeviceId.trim() !== ''
      ? record.selectedDeviceId.trim()
      : undefined
  }
}

export const readMobileDebugConfig = () => {
  if (typeof window === 'undefined') return createDefaultMobileDebugConfig()
  try {
    const rawValue = window.localStorage.getItem(mobileDebugConfigStorageKey)
    return normalizeMobileDebugConfig(rawValue == null ? undefined : JSON.parse(rawValue))
  } catch {
    return createDefaultMobileDebugConfig()
  }
}

export const writeMobileDebugConfig = (config: MobileDebugConfigState) => {
  try {
    window.localStorage.setItem(mobileDebugConfigStorageKey, JSON.stringify(config))
  } catch {
    // Debug config is local UI state; persistence is best-effort.
  }
}
