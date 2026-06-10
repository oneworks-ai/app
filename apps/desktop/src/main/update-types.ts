export const desktopUpdateChannels = ['stable', 'rc', 'beta', 'alpha'] as const
export type DesktopUpdateChannel = typeof desktopUpdateChannels[number]
export const DEFAULT_DESKTOP_UPDATE_CHANNEL: DesktopUpdateChannel = 'stable'
export const DEFAULT_DESKTOP_AUTO_UPDATE = true

export const isDesktopUpdateChannel = (value: unknown): value is DesktopUpdateChannel => (
  typeof value === 'string' && desktopUpdateChannels.includes(value as DesktopUpdateChannel)
)

export const normalizeDesktopUpdateChannel = (value: unknown): DesktopUpdateChannel => (
  isDesktopUpdateChannel(value) ? value : DEFAULT_DESKTOP_UPDATE_CHANNEL
)

export const normalizeDesktopAutoUpdate = (value: unknown) => (
  typeof value === 'boolean' ? value : DEFAULT_DESKTOP_AUTO_UPDATE
)

export interface DesktopUpdateStatus {
  autoUpdate: boolean
  autoDownload: boolean
  currentVersion: string
  enabled: boolean
  errorMessage?: string
  lastCheckedAt?: string
  progress?: number
  reason?: 'disabled' | 'missing-config' | 'not-packaged'
  status: 'available' | 'checking' | 'downloaded' | 'downloading' | 'error' | 'idle' | 'unavailable'
  updateChannel: DesktopUpdateChannel
  updateTag?: string
  updateVersion?: string
}
