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

export function useNativeHistoryImportNotification() {
  const navigate = useNavigate()
  const notifications = useNotifications()
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()

  return useCallback(async (
    result: NativeHistoryImportResult,
    options: { showEmpty?: boolean } = {}
  ) => {
    if (result.sessions.length === 0) {
      if (options.showEmpty !== true) {
        return
      }

      notifications.show({
        dedupeKey: NOTIFICATION_DEDUPE_KEY,
        description: t('nativeHistoryImport.emptyDescription'),
        descriptionFormat: 'text',
        level: 'info',
        source: {
          icon: 'history',
          id: 'native-history-import',
          kind: 'host',
          title: t('nativeHistoryImport.source')
        },
        title: t('nativeHistoryImport.emptyTitle')
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
      description: t('nativeHistoryImport.description', {
        adapters: getNativeHistoryImportAdapterSummary(result.sessions),
        count: result.sessions.length
      }),
      descriptionFormat: 'text',
      level: result.importedEvents > 0 ? 'success' : 'info',
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
