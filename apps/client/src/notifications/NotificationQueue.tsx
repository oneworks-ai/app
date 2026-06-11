import './NotificationQueue.scss'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NotificationCard } from './NotificationCard'
import type { UiNotification, UiNotificationSource } from './notification-types'

interface NotificationQueueProps {
  notifications: UiNotification[]
  onClose: (id: string) => void
  onMuteSource: (source: UiNotificationSource) => void
}

const EXIT_ANIMATION_MS = 320
const MAX_VISIBLE_NOTIFICATIONS = 4

export function NotificationQueue({ notifications, onClose, onMuteSource }: NotificationQueueProps) {
  const { i18n, t } = useTranslation()
  const autoCloseDeadlinesRef = useRef(new Map<string, number>())
  const autoCloseTimersRef = useRef(new Map<string, number>())
  const exitTimersRef = useRef(new Map<string, number>())
  const hoveredNotificationIdsRef = useRef(new Set<string>())
  const pausedAutoCloseMsRef = useRef(new Map<string, number>())
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set())
  const language = i18n.resolvedLanguage ?? i18n.language

  const clearAutoCloseTimer = useCallback((id: string) => {
    const timer = autoCloseTimersRef.current.get(id)
    if (timer != null) {
      window.clearTimeout(timer)
      autoCloseTimersRef.current.delete(id)
      autoCloseDeadlinesRef.current.delete(id)
    }
  }, [])

  const requestClose = useCallback((id: string) => {
    clearAutoCloseTimer(id)
    setExitingIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
    if (exitTimersRef.current.has(id)) return
    const timer = window.setTimeout(() => {
      exitTimersRef.current.delete(id)
      pausedAutoCloseMsRef.current.delete(id)
      onClose(id)
      setExitingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }, EXIT_ANIMATION_MS)
    exitTimersRef.current.set(id, timer)
  }, [clearAutoCloseTimer, onClose])

  const scheduleAutoClose = useCallback((notification: UiNotification, delayMs?: number) => {
    if (typeof notification.ttlMs !== 'number' || notification.ttlMs <= 0) return
    clearAutoCloseTimer(notification.id)
    const remainingMs = Math.max(
      0,
      delayMs ?? notification.createdAt + notification.ttlMs - Date.now()
    )
    const timer = window.setTimeout(() => {
      if (hoveredNotificationIdsRef.current.has(notification.id)) {
        autoCloseTimersRef.current.delete(notification.id)
        autoCloseDeadlinesRef.current.delete(notification.id)
        pausedAutoCloseMsRef.current.set(notification.id, 1000)
        return
      }
      requestClose(notification.id)
    }, remainingMs)
    autoCloseTimersRef.current.set(notification.id, timer)
    autoCloseDeadlinesRef.current.set(notification.id, Date.now() + remainingMs)
  }, [clearAutoCloseTimer, requestClose])

  const pauseAutoClose = useCallback((id: string) => {
    hoveredNotificationIdsRef.current.add(id)
    const timer = autoCloseTimersRef.current.get(id)
    const deadline = autoCloseDeadlinesRef.current.get(id)
    if (timer == null || deadline == null) {
      pausedAutoCloseMsRef.current.set(id, pausedAutoCloseMsRef.current.get(id) ?? 1000)
      return
    }
    window.clearTimeout(timer)
    autoCloseTimersRef.current.delete(id)
    autoCloseDeadlinesRef.current.delete(id)
    pausedAutoCloseMsRef.current.set(id, Math.max(1000, deadline - Date.now()))
  }, [])

  const resumeAutoClose = useCallback((notification: UiNotification) => {
    hoveredNotificationIdsRef.current.delete(notification.id)
    const pausedMs = pausedAutoCloseMsRef.current.get(notification.id)
    if (pausedMs == null || exitingIds.has(notification.id)) return
    pausedAutoCloseMsRef.current.delete(notification.id)
    scheduleAutoClose(notification, pausedMs)
  }, [exitingIds, scheduleAutoClose])

  useEffect(() => {
    const activeIds = new Set(notifications.map(notification => notification.id))
    for (const id of [...autoCloseTimersRef.current.keys()]) {
      if (!activeIds.has(id)) clearAutoCloseTimer(id)
    }
    for (const id of [...pausedAutoCloseMsRef.current.keys()]) {
      if (!activeIds.has(id)) pausedAutoCloseMsRef.current.delete(id)
    }
    for (const id of [...hoveredNotificationIdsRef.current.keys()]) {
      if (!activeIds.has(id)) hoveredNotificationIdsRef.current.delete(id)
    }
    for (const notification of notifications) {
      if (
        exitingIds.has(notification.id) ||
        hoveredNotificationIdsRef.current.has(notification.id) ||
        autoCloseTimersRef.current.has(notification.id) ||
        pausedAutoCloseMsRef.current.has(notification.id)
      ) {
        continue
      }
      scheduleAutoClose(notification)
    }
  }, [clearAutoCloseTimer, exitingIds, notifications, scheduleAutoClose])

  useEffect(() => () => {
    for (const timer of autoCloseTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    for (const timer of exitTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
  }, [])

  const visibleNotifications = useMemo(() => [...notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS)].reverse(), [
    notifications
  ])
  const overflowCount = notifications.length - visibleNotifications.length

  if (notifications.length === 0) return null

  return (
    <section className='oneworks-notification-queue' aria-label={t('common.notifications.queueLabel')}>
      {overflowCount > 0 && (
        <div className='oneworks-notification-queue__overflow' aria-hidden='true'>
          +{overflowCount}
        </div>
      )}
      {visibleNotifications.map((notification, index) => (
        <NotificationCard
          index={index}
          isExiting={exitingIds.has(notification.id)}
          key={notification.id}
          language={language}
          notification={notification}
          onClose={requestClose}
          onMuteSource={onMuteSource}
          onPauseAutoClose={pauseAutoClose}
          onResumeAutoClose={resumeAutoClose}
        />
      ))}
    </section>
  )
}
