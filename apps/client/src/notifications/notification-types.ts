export type UiNotificationLevel = 'error' | 'info' | 'success' | 'warning'
export type UiNotificationDescriptionFormat = 'markdown' | 'text'

export interface UiNotificationHostSource {
  icon?: string
  id: string
  kind: 'host'
  title: string
}

export interface UiNotificationPluginSource {
  icon?: string
  kind: 'plugin'
  name?: string
  scope: string
  title?: string
}

export type UiNotificationSource = UiNotificationHostSource | UiNotificationPluginSource

export interface UiNotificationActionContext {
  close: () => void
  id: string
  muteSource: () => void
  source: UiNotificationSource
}

export interface UiNotificationAction {
  closeOnClick?: boolean
  icon?: string
  id: string
  title: string
  tone?: 'danger' | 'default' | 'primary'
  onClick?: (context: UiNotificationActionContext) => unknown | Promise<unknown>
}

export interface UiNotificationInput {
  actions?: UiNotificationAction[]
  dedupeKey?: string
  description?: string
  descriptionFormat?: UiNotificationDescriptionFormat
  id?: string
  level?: UiNotificationLevel
  source?: UiNotificationSource
  title: string
  ttlMs?: number | null
}

export interface UiNotification extends UiNotificationInput {
  createdAt: number
  descriptionFormat: UiNotificationDescriptionFormat
  id: string
  level: UiNotificationLevel
  source: UiNotificationSource
}

export interface UiNotificationHandle {
  close: () => void
  id: string
}

export interface NotificationApi {
  close: (id: string) => void
  isSourceMuted: (source: UiNotificationSource) => boolean
  muteSource: (source: UiNotificationSource) => void
  show: (input: UiNotificationInput) => UiNotificationHandle
  unmuteSource: (source: UiNotificationSource) => void
}
