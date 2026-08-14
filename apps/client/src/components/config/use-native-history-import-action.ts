import { App } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage, runNativeProjectHistoryImport } from '#~/api'
import type {
  NativeHistoryAdapter,
  NativeHistoryProjectScope,
  NativeHistoryThreadScope,
  NativeHistoryTimeFilter,
  NativeHistoryTimeSort
} from '#~/api'
import { useNativeHistoryImportNotification } from '#~/hooks/use-native-history-import-notification'

export function useNativeHistoryImportAction() {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const showNativeHistoryImportNotification = useNativeHistoryImportNotification()
  const [isImporting, setIsImporting] = useState(false)

  const runImport = useCallback(async (request?: {
    adapters?: NativeHistoryAdapter[]
    projectPaths?: string[]
    projectScope?: NativeHistoryProjectScope
    sourcePaths?: string[]
    threadScope?: NativeHistoryThreadScope
    timeFilter?: NativeHistoryTimeFilter
    timeSort?: NativeHistoryTimeSort
  }) => {
    if (isImporting) {
      return undefined
    }

    let retryInFlight = false
    const performImport = async () => {
      if (retryInFlight) return undefined
      retryInFlight = true
      setIsImporting(true)
      try {
        const result = await runNativeProjectHistoryImport(request)
        await showNativeHistoryImportNotification(result, {
          onRetry: () => {
            void performImport()
          },
          showEmpty: true
        })
        return result
      } catch (error) {
        void message.error(getApiErrorMessage(error, t('nativeHistoryImport.failedDescription')))
        return undefined
      } finally {
        retryInFlight = false
        setIsImporting(false)
      }
    }
    return performImport()
  }, [isImporting, message, showNativeHistoryImportNotification, t])

  return {
    isImporting,
    runImport
  }
}
