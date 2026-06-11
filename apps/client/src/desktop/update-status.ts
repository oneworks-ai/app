const updateStatuses = new Set<DesktopUpdateStatus['status']>([
  'available',
  'checking',
  'downloaded',
  'downloading',
  'error',
  'idle',
  'unavailable'
])
const updateUnavailableReasons = new Set<NonNullable<DesktopUpdateStatus['reason']>>([
  'disabled',
  'missing-config',
  'not-packaged'
])
const updateChannels = new Set<DesktopUpdateStatus['updateChannel']>(['stable', 'rc', 'beta', 'alpha'])

export const emptyDesktopUpdateStatus: DesktopUpdateStatus = {
  autoUpdate: true,
  autoDownload: false,
  currentVersion: '',
  enabled: false,
  status: 'unavailable',
  updateChannel: 'stable'
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeProgress = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

export const normalizeDesktopUpdateStatus = (value: unknown): DesktopUpdateStatus => {
  if (!isRecord(value)) return emptyDesktopUpdateStatus
  return {
    autoUpdate: value.autoUpdate !== false,
    autoDownload: value.autoDownload === true,
    currentVersion: typeof value.currentVersion === 'string' ? value.currentVersion : '',
    enabled: value.enabled === true,
    errorMessage: typeof value.errorMessage === 'string' && value.errorMessage.trim() !== ''
      ? value.errorMessage
      : undefined,
    lastCheckedAt: typeof value.lastCheckedAt === 'string' && value.lastCheckedAt.trim() !== ''
      ? value.lastCheckedAt
      : undefined,
    progress: normalizeProgress(value.progress),
    reason: typeof value.reason === 'string' &&
        updateUnavailableReasons.has(value.reason as NonNullable<DesktopUpdateStatus['reason']>)
      ? value.reason as DesktopUpdateStatus['reason']
      : undefined,
    status: typeof value.status === 'string' && updateStatuses.has(value.status as DesktopUpdateStatus['status'])
      ? value.status as DesktopUpdateStatus['status']
      : 'unavailable',
    updateChannel: typeof value.updateChannel === 'string' &&
        updateChannels.has(value.updateChannel as DesktopUpdateStatus['updateChannel'])
      ? value.updateChannel as DesktopUpdateStatus['updateChannel']
      : 'stable',
    updateTag: typeof value.updateTag === 'string' && value.updateTag.trim() !== ''
      ? value.updateTag
      : undefined,
    updateVersion: typeof value.updateVersion === 'string' && value.updateVersion.trim() !== ''
      ? value.updateVersion
      : undefined
  }
}

export const hasVisibleDesktopUpdateAction = (status: DesktopUpdateStatus) => (
  status.status === 'available' ||
  status.status === 'downloaded' ||
  status.status === 'downloading'
)
