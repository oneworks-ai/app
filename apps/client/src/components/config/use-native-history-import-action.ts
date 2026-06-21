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
    projectScope?: NativeHistoryProjectScope
    sourcePaths?: string[]
    threadScope?: NativeHistoryThreadScope
    timeFilter?: NativeHistoryTimeFilter
    timeSort?: NativeHistoryTimeSort
  }) => {
    if (isImporting) {
      return undefined
    }

    setIsImporting(true)
    try {
      const result = await runNativeProjectHistoryImport(request)
      await showNativeHistoryImportNotification(result, { showEmpty: true })
      return result
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('nativeHistoryImport.failedDescription')))
      return undefined
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, message, showNativeHistoryImportNotification, t])

  return {
    isImporting,
    runImport
  }
}
