import { App, Button } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildWebDebugDevtoolsUrl, readWebDebugChiiRuntime, readWebDebugTargets } from '#~/api/web-debug'
import type { WebDebugChiiRuntime, WebDebugDevtoolsDockSide, WebDebugTarget } from '#~/api/web-debug'

import { buildChiiScriptSnippet } from './interaction-panel-iframe-debug'
import { getWebDebugTargetTitle } from './interaction-panel-page-debugger'

const PAGE_DEBUGGER_REFRESH_INTERVAL_MS = 2_000

export function InteractionPanelPageDebuggerListView({
  isActive,
  devtoolsDockSide,
  onOpenDevtoolsUrl
}: {
  devtoolsDockSide?: WebDebugDevtoolsDockSide
  isActive: boolean
  onOpenDevtoolsUrl?: (url: string, target: WebDebugTarget) => void
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [inlineDevtoolsUrl, setInlineDevtoolsUrl] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<WebDebugChiiRuntime | null>(null)
  const [targets, setTargets] = useState<WebDebugTarget[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const sortedTargets = useMemo(() => targets.filter(target => target.id.trim() !== ''), [targets])

  const refreshTargets = useCallback(async () => {
    setIsLoading(current => current || targets.length === 0)
    try {
      const nextRuntime = runtime ?? await readWebDebugChiiRuntime()
      const nextTargets = await readWebDebugTargets(nextRuntime)
      setRuntime(nextRuntime)
      setTargets(nextTargets.targets)
      setError(null)
    } catch {
      setError(t('chat.interactionPanel.pageDebuggerListLoadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [runtime, t, targets.length])

  useEffect(() => {
    if (!isActive || inlineDevtoolsUrl != null) return

    void refreshTargets()
    const timer = window.setInterval(() => void refreshTargets(), PAGE_DEBUGGER_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [inlineDevtoolsUrl, isActive, refreshTargets])

  const handleOpenTarget = async (target: WebDebugTarget) => {
    try {
      const nextRuntime = runtime ?? await readWebDebugChiiRuntime()
      setRuntime(nextRuntime)
      const devtoolsUrl = buildWebDebugDevtoolsUrl(nextRuntime, target, {
        dockControls: 'menu',
        dockSide: devtoolsDockSide
      })
      if (onOpenDevtoolsUrl != null) {
        onOpenDevtoolsUrl(devtoolsUrl, target)
        return
      }
      setInlineDevtoolsUrl(devtoolsUrl)
    } catch {
      void message.error(t('chat.interactionPanel.iframeDebugServiceUnavailable'))
    }
  }

  const handleCopyScript = async () => {
    try {
      if (navigator.clipboard?.writeText == null) {
        void message.warning(t('common.notSupportedYet'))
        return
      }
      const nextRuntime = runtime ?? await readWebDebugChiiRuntime()
      setRuntime(nextRuntime)
      await navigator.clipboard.writeText(buildChiiScriptSnippet(nextRuntime.targetUrl))
      void message.success(t('chat.interactionPanel.iframeDebugScriptCopied'))
    } catch {
      void message.error(t('common.operationFailed'))
    }
  }

  if (inlineDevtoolsUrl != null) {
    return (
      <div className='chat-interaction-panel-page-debugger is-devtools'>
        <iframe
          className='chat-interaction-panel-page-debugger__devtools-frame'
          src={inlineDevtoolsUrl}
          title={t('chat.interactionPanel.iframeDebugDeveloperToolsTitle')}
        />
      </div>
    )
  }

  return (
    <div className='chat-interaction-panel-page-debugger'>
      {error != null && (
        <div className='chat-interaction-panel-page-debugger__notice is-error'>
          {error}
        </div>
      )}
      {sortedTargets.length === 0
        ? (
          <div className='chat-interaction-panel-page-debugger__empty'>
            <span>
              {isLoading
                ? t('chat.interactionPanel.pageDebuggerListLoading')
                : t('chat.interactionPanel.pageDebuggerListEmpty')}
            </span>
            <Button
              type='text'
              className='chat-interaction-panel-page-debugger__copy-script'
              onClick={() => void handleCopyScript()}
            >
              <span className='material-symbols-rounded' aria-hidden='true'>content_copy</span>
              <span>{t('chat.interactionPanel.iframeDebugCopyScript')}</span>
            </Button>
          </div>
        )
        : (
          <div className='chat-interaction-panel-page-debugger__targets'>
            {sortedTargets.map(target => {
              const title = getWebDebugTargetTitle(target, t('chat.interactionPanel.pageDebuggerUntitledTarget'))
              return (
                <button
                  key={target.id}
                  type='button'
                  className='chat-interaction-panel-page-debugger__target'
                  onClick={() => void handleOpenTarget(target)}
                >
                  {target.favicon == null
                    ? (
                      <span className='material-symbols-rounded chat-interaction-panel-page-debugger__target-icon'>
                        language
                      </span>
                    )
                    : (
                      <img
                        className='chat-interaction-panel-page-debugger__target-favicon'
                        src={target.favicon}
                        alt=''
                        draggable={false}
                      />
                    )}
                  <span className='chat-interaction-panel-page-debugger__target-copy'>
                    <span className='chat-interaction-panel-page-debugger__target-title'>{title}</span>
                    <span className='chat-interaction-panel-page-debugger__target-url'>
                      {target.url ?? target.id}
                    </span>
                  </span>
                  <span className='chat-interaction-panel-page-debugger__target-action'>
                    {t('chat.interactionPanel.iframeDebugOpenDeveloperTools')}
                  </span>
                </button>
              )
            })}
          </div>
        )}
    </div>
  )
}
