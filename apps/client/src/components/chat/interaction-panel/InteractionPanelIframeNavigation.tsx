import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { getIframePageHostTitle } from './interaction-panel-iframe-pages'

export function InteractionPanelIframeNavigation({
  canGoBack,
  canGoForward,
  frameUrl,
  history,
  historyIndex,
  onNavigateHistory,
  onRefresh,
  onSelectHistory,
  pageId
}: {
  canGoBack: boolean
  canGoForward: boolean
  frameUrl: string
  history: string[]
  historyIndex: number
  onNavigateHistory: (delta: -1 | 1) => void
  onRefresh: () => void
  onSelectHistory: (pageId: string, index: number) => void
  pageId: string
}) {
  const { t } = useTranslation()
  const backLabel = t('chat.interactionPanel.iframeBack')
  const backTooltip = canGoBack ? backLabel : t('chat.interactionPanel.iframeBackUnavailable')
  const forwardLabel = t('chat.interactionPanel.iframeForward')
  const forwardTooltip = canGoForward ? forwardLabel : t('chat.interactionPanel.iframeForwardUnavailable')
  const refreshLabel = t('chat.interactionPanel.iframeRefresh')
  const refreshTooltip = frameUrl === '' ? t('chat.interactionPanel.iframeRefreshUnavailable') : refreshLabel
  const backTriggerClassName = `chat-interaction-panel__iframe-navigation-trigger ${canGoBack ? '' : 'is-disabled'}`
  const forwardTriggerClassName = `chat-interaction-panel__iframe-navigation-trigger ${
    canGoForward ? '' : 'is-disabled'
  }`
  const refreshTriggerClassName = `chat-interaction-panel__iframe-navigation-trigger ${
    frameUrl === '' ? 'is-disabled' : ''
  }`
  const visibleHistory = history.length > 0 ? history : frameUrl === '' ? [] : [frameUrl]
  const visibleHistoryIndex = history.length > 0 ? historyIndex : 0
  const historyMenuItems: MenuProps['items'] = visibleHistory.map((url, index) => ({
    key: index.toString(),
    icon: (
      <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>
        {index === visibleHistoryIndex ? 'check' : 'history'}
      </span>
    ),
    label: (
      <span className='chat-interaction-panel__iframe-history-item'>
        <span className='chat-interaction-panel__iframe-history-title'>
          {getIframePageHostTitle(url, url)}
        </span>
        <span className='chat-interaction-panel__iframe-history-url'>{url}</span>
      </span>
    )
  }))
  const handleHistoryMenuClick: MenuProps['onClick'] = ({ key }) => {
    const nextIndex = Number(key)
    if (!Number.isFinite(nextIndex) || nextIndex === visibleHistoryIndex) return
    onSelectHistory(pageId, nextIndex)
  }

  return (
    <div className='chat-interaction-panel__iframe-navigation'>
      <Dropdown
        menu={{ items: historyMenuItems, onClick: handleHistoryMenuClick }}
        overlayClassName='chat-interaction-panel-history-dropdown'
        trigger={['contextMenu']}
      >
        <Tooltip title={backTooltip}>
          <span className={backTriggerClassName}>
            <Button
              type='text'
              aria-label={backLabel}
              className={!canGoBack ? 'is-disabled' : undefined}
              icon={<span className='material-symbols-rounded'>arrow_back</span>}
              onClick={() => canGoBack && onNavigateHistory(-1)}
            />
          </span>
        </Tooltip>
      </Dropdown>
      <Tooltip title={forwardTooltip}>
        <span className={forwardTriggerClassName}>
          <Button
            type='text'
            disabled={!canGoForward}
            aria-label={forwardLabel}
            icon={<span className='material-symbols-rounded'>arrow_forward</span>}
            onClick={() => onNavigateHistory(1)}
          />
        </span>
      </Tooltip>
      <Tooltip title={refreshTooltip}>
        <span className={refreshTriggerClassName}>
          <Button
            type='text'
            disabled={frameUrl === ''}
            aria-label={refreshLabel}
            icon={<span className='material-symbols-rounded'>refresh</span>}
            onClick={onRefresh}
          />
        </span>
      </Tooltip>
    </div>
  )
}
