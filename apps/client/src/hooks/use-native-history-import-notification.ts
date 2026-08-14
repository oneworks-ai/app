import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'

import type { NativeHistoryImportResult } from '#~/api/sessions'
import { useNotifications } from '#~/notifications/NotificationProvider'

import {
  getNativeHistoryImportAdapterSummary,
  selectNativeHistoryImportPromptSession
} from './native-history-import-prompt-model'

const NOTIFICATION_DEDUPE_KEY = 'native-history-import'

const formatDiagnosticBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const mebibytes = value / 1024 / 1024
  return mebibytes >= 1 ? `${mebibytes.toFixed(1)} MiB` : `${value} B`
}

export function useNativeHistoryImportNotification() {
  const navigate = useNavigate()
  const notifications = useNotifications()
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()

  return useCallback(async (
    result: NativeHistoryImportResult,
    options: { onRetry?: () => void; showEmpty?: boolean } = {}
  ) => {
    const diagnosticParts = [
      result.rejectedFiles > 0
        ? t('nativeHistoryImport.rejectedDescription', { count: result.rejectedFiles })
        : undefined,
      result.perFileLimitedFiles > 0
        ? t('nativeHistoryImport.perFileLimitedDescription', {
          count: result.perFileLimitedFiles,
          size: formatDiagnosticBytes(result.perFileLimitedBytes)
        })
        : undefined,
      result.aggregateLimitedFiles > 0
        ? t('nativeHistoryImport.aggregateLimitedDescription', {
          count: result.aggregateLimitedFiles,
          size: formatDiagnosticBytes(result.aggregateLimitedBytes)
        })
        : undefined
    ].filter((value): value is string => value != null)

    if (result.sessions.length === 0) {
      if (options.showEmpty !== true) {
        return
      }

      notifications.show({
        ...(diagnosticParts.length > 0 && options.onRetry != null
          ? {
            actions: [{
              icon: 'refresh',
              id: 'retry',
              onClick: options.onRetry,
              title: t('nativeHistoryImport.retry'),
              tone: 'primary' as const
            }]
          }
          : {}),
        dedupeKey: NOTIFICATION_DEDUPE_KEY,
        description: diagnosticParts.length > 0
          ? diagnosticParts.join(' ')
          : t('nativeHistoryImport.emptyDescription'),
        descriptionFormat: 'text',
        level: diagnosticParts.length > 0 ? 'warning' : 'info',
        source: {
          icon: 'history',
          id: 'native-history-import',
          kind: 'host',
          title: t('nativeHistoryImport.source')
        },
        title: t(
          diagnosticParts.length > 0
            ? 'nativeHistoryImport.incompleteTitle'
            : 'nativeHistoryImport.emptyTitle'
        )
      })
      return
    }

    await Promise.all([
      mutate('/api/sessions'),
      mutate('/api/sessions/archived')
    ])

    const targetSession = selectNativeHistoryImportPromptSession(result.sessions)
    if (targetSession == null) {
      return
    }

    notifications.show({
      actions: [
        {
          icon: 'open_in_new',
          id: 'open',
          title: t('nativeHistoryImport.open'),
          tone: 'primary',
          onClick: () => {
            void navigate(`/session/${encodeURIComponent(targetSession.sessionId)}`)
          }
        },
        {
          icon: 'close',
          id: 'dismiss',
          title: t('nativeHistoryImport.dismiss')
        }
      ],
      dedupeKey: NOTIFICATION_DEDUPE_KEY,
      description: [
        t('nativeHistoryImport.description', {
          adapters: getNativeHistoryImportAdapterSummary(result.sessions),
          count: result.sessions.length
        }),
        ...diagnosticParts
      ].join(' '),
      descriptionFormat: 'text',
      level: diagnosticParts.length > 0
        ? 'warning'
        : result.importedEvents > 0
        ? 'success'
        : 'info',
      source: {
        icon: 'history',
        id: 'native-history-import',
        kind: 'host',
        title: t('nativeHistoryImport.source')
      },
      title: t('nativeHistoryImport.title'),
      ttlMs: null
    })
  }, [mutate, navigate, notifications, t])
}
