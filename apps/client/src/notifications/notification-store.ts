import type { UiNotificationSource } from './notification-types'

const MUTED_SOURCES_STORAGE_KEY = 'oneworks:ui-notifications:muted-sources'

export const defaultNotificationSource: UiNotificationSource = {
  icon: 'notifications',
  id: 'app',
  kind: 'host',
  title: 'OneWorks'
}

export const getNotificationSourceKey = (source: UiNotificationSource) => (
  source.kind === 'plugin'
    ? `plugin:${source.scope}`
    : `host:${source.id}`
)

export const getNotificationSourceTitle = (source: UiNotificationSource) => (
  source.kind === 'plugin'
    ? source.title ?? source.name ?? source.scope
    : source.title
)

export const getNotificationSourceIcon = (source: UiNotificationSource) => (
  source.icon ?? (source.kind === 'plugin' ? 'extension' : 'notifications')
)

export const readMutedNotificationSources = () => {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const value = window.localStorage.getItem(MUTED_SOURCES_STORAGE_KEY)
    const parsed = value == null ? [] : JSON.parse(value)
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

export const writeMutedNotificationSources = (sources: Set<string>) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MUTED_SOURCES_STORAGE_KEY, JSON.stringify([...sources].sort()))
}
