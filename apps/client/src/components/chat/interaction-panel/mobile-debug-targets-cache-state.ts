const mobileDebugTargetsCacheStoragePrefix = 'chatInteractionMobileDebugTargetsCache'
const mobileDebugTargetsCacheTtlMs = 30_000
const mobileDebugTargetsImmediateRefreshGraceMs = 5_000

export interface MobileDebugTargetsCacheEntry {
  cachedAt: number
  state: DesktopMobileDebugTargetsResponse
}

interface StoredMobileDebugTargetsCacheEntry extends MobileDebugTargetsCacheEntry {
  cacheKey: string
}

const memoryCache = new Map<string, StoredMobileDebugTargetsCacheEntry>()

const normalizeTargetsConfig = (config?: DesktopMobileDebugConfig) => ({
  discoverNetworkTargets: config?.discoverNetworkTargets !== false,
  discoverUsbDevices: config?.discoverUsbDevices !== false,
  networkTargets: (config?.networkTargets ?? []).map(target => ({
    address: target.address.trim(),
    enabled: target.enabled !== false,
    id: target.id ?? ''
  })),
  portForwardingRules: (config?.portForwardingRules ?? []).map(rule => ({
    deviceId: rule.deviceId ?? '',
    devicePort: rule.devicePort,
    enabled: rule.enabled !== false,
    id: rule.id ?? '',
    localAddress: rule.localAddress.trim()
  })),
  selectedDeviceId: config?.selectedDeviceId ?? ''
})

const hashString = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647
  }
  return hash.toString(36)
}

export const buildMobileDebugTargetsCacheKey = (config?: DesktopMobileDebugConfig) => (
  JSON.stringify(normalizeTargetsConfig(config))
)

const buildStorageKey = (cacheKey: string) => `${mobileDebugTargetsCacheStoragePrefix}:${hashString(cacheKey)}`

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeStoredEntry = (
  cacheKey: string,
  value: unknown
): StoredMobileDebugTargetsCacheEntry | null => {
  if (!isRecord(value)) return null
  if (value.cacheKey !== cacheKey || typeof value.cachedAt !== 'number') return null
  if (!isRecord(value.state)) return null
  const state = value.state as Partial<DesktopMobileDebugTargetsResponse>
  if (!Array.isArray(state.devices) || !Array.isArray(state.targets) || !Array.isArray(state.errors)) return null
  if (!Array.isArray(state.portForwarding) || typeof state.scannedAt !== 'number') return null
  return {
    cacheKey,
    cachedAt: value.cachedAt,
    state: state as DesktopMobileDebugTargetsResponse
  }
}

const isExpired = (entry: MobileDebugTargetsCacheEntry, now = Date.now()) =>
  now - entry.cachedAt > mobileDebugTargetsCacheTtlMs

export const isMobileDebugTargetsCacheFresh = (entry: MobileDebugTargetsCacheEntry, now = Date.now()) =>
  now - entry.cachedAt <= mobileDebugTargetsImmediateRefreshGraceMs

export const readMobileDebugTargetsCacheEntry = (
  config?: DesktopMobileDebugConfig
): MobileDebugTargetsCacheEntry | null => {
  const cacheKey = buildMobileDebugTargetsCacheKey(config)
  const memoryEntry = memoryCache.get(cacheKey)
  if (memoryEntry != null && !isExpired(memoryEntry)) return memoryEntry
  if (memoryEntry != null) memoryCache.delete(cacheKey)
  if (typeof window === 'undefined') return null

  try {
    const storageKey = buildStorageKey(cacheKey)
    const rawValue = window.sessionStorage.getItem(storageKey)
    const entry = normalizeStoredEntry(cacheKey, rawValue == null ? undefined : JSON.parse(rawValue))
    if (entry == null || isExpired(entry)) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }
    memoryCache.set(cacheKey, entry)
    return entry
  } catch {
    return null
  }
}

export const writeMobileDebugTargetsCacheEntry = (
  config: DesktopMobileDebugConfig | undefined,
  state: DesktopMobileDebugTargetsResponse
) => {
  const cacheKey = buildMobileDebugTargetsCacheKey(config)
  const entry: StoredMobileDebugTargetsCacheEntry = { cacheKey, cachedAt: Date.now(), state }
  memoryCache.set(cacheKey, entry)
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(buildStorageKey(cacheKey), JSON.stringify(entry))
  } catch {
    // Target discovery cache is a best-effort refresh optimization.
  }
}
