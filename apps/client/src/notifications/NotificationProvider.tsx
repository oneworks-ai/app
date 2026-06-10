import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { NotificationQueue } from './NotificationQueue'
import {
  defaultNotificationSource,
  getNotificationSourceKey,
  readMutedNotificationSources,
  writeMutedNotificationSources
} from './notification-store'
import type { NotificationApi, UiNotification, UiNotificationInput, UiNotificationSource } from './notification-types'

const MAX_NOTIFICATION_COUNT = 24
const DEFAULT_NOTIFICATION_TTL_MS = 6500
const DEFAULT_ACTION_NOTIFICATION_TTL_MS = 9500

const NotificationContext = createContext<NotificationApi | null>(null)

const createNotificationId = () => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`
)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<UiNotification[]>([])
  const [mutedSources, setMutedSources] = useState(() => readMutedNotificationSources())
  const mutedSourcesRef = useRef(mutedSources)

  useEffect(() => {
    mutedSourcesRef.current = mutedSources
  }, [mutedSources])

  const close = useCallback((id: string) => {
    setNotifications(current => current.filter(item => item.id !== id))
  }, [])

  const isSourceMuted = useCallback((source: UiNotificationSource) => (
    mutedSourcesRef.current.has(getNotificationSourceKey(source))
  ), [])

  const muteSource = useCallback((source: UiNotificationSource) => {
    const sourceKey = getNotificationSourceKey(source)
    setMutedSources((current) => {
      const next = new Set(current)
      next.add(sourceKey)
      writeMutedNotificationSources(next)
      return next
    })
    setNotifications(current => current.filter(item => getNotificationSourceKey(item.source) !== sourceKey))
  }, [])

  const unmuteSource = useCallback((source: UiNotificationSource) => {
    const sourceKey = getNotificationSourceKey(source)
    setMutedSources((current) => {
      const next = new Set(current)
      next.delete(sourceKey)
      writeMutedNotificationSources(next)
      return next
    })
  }, [])

  const show = useCallback((input: UiNotificationInput) => {
    const source = input.source ?? defaultNotificationSource
    const id = input.id ?? createNotificationId()
    const level = input.level ?? 'info'
    if (isSourceMuted(source)) {
      return {
        close: () => {},
        id
      }
    }

    const notification: UiNotification = {
      ...input,
      createdAt: Date.now(),
      descriptionFormat: input.descriptionFormat ?? 'markdown',
      id,
      level,
      source,
      ttlMs: input.ttlMs === undefined
        ? (input.actions?.length ? DEFAULT_ACTION_NOTIFICATION_TTL_MS : DEFAULT_NOTIFICATION_TTL_MS)
        : input.ttlMs
    }

    setNotifications((current) => {
      const dedupeKey = notification.dedupeKey
      const sourceKey = getNotificationSourceKey(source)
      const filtered = dedupeKey == null
        ? current.filter(item => item.id !== notification.id)
        : current.filter(item =>
          item.id !== notification.id &&
          (item.dedupeKey !== dedupeKey || getNotificationSourceKey(item.source) !== sourceKey)
        )
      return [notification, ...filtered].slice(0, MAX_NOTIFICATION_COUNT)
    })

    return {
      close: () => close(id),
      id
    }
  }, [close, isSourceMuted])

  const api = useMemo<NotificationApi>(() => ({
    close,
    isSourceMuted,
    muteSource,
    show,
    unmuteSource
  }), [close, isSourceMuted, muteSource, show, unmuteSource])

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <NotificationQueue
        notifications={notifications}
        onClose={close}
        onMuteSource={muteSource}
      />
    </NotificationContext.Provider>
  )
}

export const useNotifications = () => {
  const value = useContext(NotificationContext)
  if (value == null) {
    throw new Error('NotificationProvider is missing')
  }
  return value
}
