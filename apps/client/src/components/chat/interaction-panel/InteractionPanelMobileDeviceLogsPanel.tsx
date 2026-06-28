import { Input } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceLunaConsole } from './InteractionPanelMobileDeviceLunaConsole'
import { readMobileDeviceLogs } from './mobile-debug-platform'

const defaultLogLineLimit = 500

export function InteractionPanelMobileDeviceLogsPanel({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [logQuery, setLogQuery] = useState('')
  const [logs, setLogs] = useState<DesktopMobileDeviceLogsResponse | null>(null)
  const filteredLogLines = useMemo(() => {
    const lines = logs?.lines ?? []
    const query = logQuery.trim().toLowerCase()
    if (query === '') return lines
    return lines.filter(line => line.toLowerCase().includes(query))
  }, [logQuery, logs?.lines])
  const emptyMessage = logQuery.trim() === ''
    ? t('chat.interactionPanel.mobileDebugNoLogs')
    : t('chat.interactionPanel.mobileDebugNoMatchingLogs')

  const refreshLogs = useCallback(async () => {
    setError(null)
    try {
      setLogs(await readMobileDeviceLogs(deviceId, defaultLogLineLimit))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [deviceId])

  useEffect(() => {
    void refreshLogs()
  }, [refreshLogs])

  return (
    <div className='chat-interaction-panel-mobile-debug__logs-tab'>
      <div className='chat-interaction-panel-mobile-debug__logs-toolbar'>
        <Input
          allowClear
          className='chat-interaction-panel-mobile-debug__logs-search'
          placeholder={t('chat.interactionPanel.mobileDebugSearchLogs')}
          prefix={<span className='material-symbols-rounded' aria-hidden='true'>search</span>}
          size='small'
          value={logQuery}
          onChange={event => setLogQuery(event.target.value)}
        />
      </div>
      {error != null && <div className='chat-interaction-panel-mobile-debug__preview-error'>{error}</div>}
      <InteractionPanelMobileDeviceLunaConsole
        emptyMessage={emptyMessage}
        lines={filteredLogLines}
      />
    </div>
  )
}
