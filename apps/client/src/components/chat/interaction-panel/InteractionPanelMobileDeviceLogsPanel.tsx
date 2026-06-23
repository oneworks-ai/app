import { Button } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { readMobileDeviceLogs } from './mobile-debug-platform'

const defaultLogLineLimit = 500

export function InteractionPanelMobileDeviceLogsPanel({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [logs, setLogs] = useState<DesktopMobileDeviceLogsResponse | null>(null)

  const refreshLogs = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      setLogs(await readMobileDeviceLogs(deviceId, defaultLogLineLimit))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [deviceId])

  useEffect(() => {
    void refreshLogs()
  }, [refreshLogs])

  return (
    <div className='chat-interaction-panel-mobile-debug__logs-tab'>
      <div className='chat-interaction-panel-mobile-debug__logs-toolbar'>
        <span>
          logcat
          {logs == null ? '' : ` · ${logs.lines.length}`}
        </span>
        <Button
          type='text'
          size='small'
          loading={isLoading}
          title={t('chat.interactionPanel.mobileDebugRefreshLogs')}
          aria-label={t('chat.interactionPanel.mobileDebugRefreshLogs')}
          onClick={() => {
            void refreshLogs()
          }}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>refresh</span>
        </Button>
      </div>
      {error != null && <div className='chat-interaction-panel-mobile-debug__preview-error'>{error}</div>}
      <pre className='chat-interaction-panel-mobile-debug__logs-output'>
        {logs == null || logs.lines.length === 0
          ? t('chat.interactionPanel.mobileDebugNoLogs')
          : logs.lines.join('\n')}
      </pre>
    </div>
  )
}
