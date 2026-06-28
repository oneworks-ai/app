export type MobileDebugConfigState =
  & Omit<Required<DesktopMobileDebugConfig>, 'selectedDeviceId'>
  & Pick<DesktopMobileDebugConfig, 'selectedDeviceId'>

const mobileDebugConfigStorageKey = 'chatInteractionMobileDebugConfig'

export const createMobileDebugConfigId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const createDefaultIosWdaTargets = (): DesktopMobileDebugIosWdaTargetConfig[] => [
  {
    autoStart: true,
    destinationPlatform: 'device',
    enabled: true,
    id: 'ios-wda-local',
    label: 'iOS WDA',
    mjpegUrl: '127.0.0.1:9100',
    wdaUrl: '127.0.0.1:8100'
  },
  {
    autoStart: true,
    destinationPlatform: 'simulator',
    enabled: true,
    id: 'ios-wda-simulator',
    label: 'iOS Simulator WDA',
    mjpegUrl: '127.0.0.1:9200',
    wdaUrl: '127.0.0.1:8200'
  }
]

const mergeDefaultIosWdaTargets = (targets: DesktopMobileDebugIosWdaTargetConfig[]) => {
  const targetIds = new Set(targets.map(target => target.id).filter((id): id is string => id != null && id !== ''))
  const targetUrls = new Set(targets.map(target => target.wdaUrl.trim()).filter(Boolean))
  return [
    ...targets,
    ...createDefaultIosWdaTargets().filter(target =>
      (target.id == null || !targetIds.has(target.id)) &&
      !targetUrls.has(target.wdaUrl.trim())
    )
  ]
}

const createDefaultMobileDebugConfig = (): MobileDebugConfigState => ({
  discoverIosDevices: true,
  discoverNetworkTargets: true,
  discoverUsbDevices: true,
  iosWdaTargets: createDefaultIosWdaTargets(),
  networkTargets: [],
  portForwardingRules: [],
  selectedDeviceId: undefined
})

const normalizeMobileDebugConfig = (value: unknown): MobileDebugConfigState => {
  const defaults = createDefaultMobileDebugConfig()
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return defaults
  const record = value as Partial<DesktopMobileDebugConfig>
  return {
    discoverIosDevices: record.discoverIosDevices !== false,
    discoverNetworkTargets: record.discoverNetworkTargets !== false,
    discoverUsbDevices: record.discoverUsbDevices !== false,
    iosWdaTargets: Array.isArray(record.iosWdaTargets)
      ? mergeDefaultIosWdaTargets(record.iosWdaTargets.filter(item => item.wdaUrl.trim() !== ''))
      : defaults.iosWdaTargets,
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
