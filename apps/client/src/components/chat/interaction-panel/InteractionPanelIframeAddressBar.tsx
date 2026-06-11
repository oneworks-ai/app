import { Button, Input, Tooltip } from 'antd'
import type { KeyboardEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deferImeCompositionEnd, isImeCompositionKeyEvent } from '#~/utils/keyboard-events'

import { openInteractionPanelExternalUrl } from './interaction-panel-external-url'
import type { InteractionPanelUrlHistoryEntry } from './interaction-panel-url-history'

export function InteractionPanelIframeAddressBar({
  draftUrl,
  externalUrl,
  isEditingUrl,
  onChangeDraftUrl,
  onOpen,
  urlHistory
}: {
  draftUrl: string
  externalUrl: string
  isEditingUrl: boolean
  onChangeDraftUrl: (value: string) => void
  onOpen: (event?: KeyboardEvent<HTMLInputElement>) => void
  urlHistory: InteractionPanelUrlHistoryEntry[]
}) {
  const { t } = useTranslation()
  const isComposingRef = useRef(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const openExternalLabel = t('chat.interactionPanel.iframeOpenExternalBrowser')
  const visibleUrlHistory = useMemo(() => {
    const query = draftUrl.trim().toLowerCase()
    const filteredHistory = query === '' || !isEditingUrl
      ? urlHistory
      : urlHistory.filter(entry =>
        entry.url.toLowerCase().includes(query) || entry.title?.toLowerCase().includes(query) === true
      )
    return filteredHistory.slice(0, 8)
  }, [draftUrl, isEditingUrl, urlHistory])
  const shouldShowHistory = isHistoryOpen && visibleUrlHistory.length > 0
  const handleCompositionEnd = () => {
    deferImeCompositionEnd((active) => {
      isComposingRef.current = active
    })
  }
  const handlePressEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeCompositionKeyEvent(event, isComposingRef.current)) {
      return
    }

    onOpen(event)
  }

  return (
    <div
      className={`chat-interaction-panel__iframe-address ${externalUrl === '' ? '' : 'has-external-url'} ${
        shouldShowHistory ? 'is-history-open' : ''
      }`}
    >
      <Input
        value={draftUrl}
        className={`chat-interaction-panel__iframe-input ${isEditingUrl ? 'is-editing' : ''}`}
        placeholder={t('chat.interactionPanel.iframeUrlPlaceholder')}
        prefix={<span className='material-symbols-rounded' aria-hidden='true'>language</span>}
        onBlur={() => {
          window.setTimeout(() => setIsHistoryOpen(false), 120)
        }}
        onChange={event => {
          onChangeDraftUrl(event.target.value)
          setIsHistoryOpen(true)
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => setIsHistoryOpen(true)}
        onPressEnter={handlePressEnter}
      />
      <Tooltip title={openExternalLabel}>
        <Button
          type='text'
          className='chat-interaction-panel__iframe-external-btn'
          disabled={externalUrl === ''}
          aria-label={openExternalLabel}
          icon={<span className='material-symbols-rounded'>open_in_new</span>}
          onClick={() => {
            openInteractionPanelExternalUrl(externalUrl)
          }}
        />
      </Tooltip>
      {shouldShowHistory && (
        <div className='chat-interaction-panel__iframe-url-history' role='listbox'>
          {visibleUrlHistory.map(entry => (
            <button
              key={entry.url}
              type='button'
              className='chat-interaction-panel__iframe-url-history-item'
              role='option'
              onMouseDown={event => {
                event.preventDefault()
                onChangeDraftUrl(entry.url)
                setIsHistoryOpen(false)
              }}
            >
              {entry.faviconUrl != null && entry.faviconUrl !== ''
                ? <img className='chat-interaction-panel__iframe-url-history-favicon' src={entry.faviconUrl} alt='' />
                : (
                  <span className='material-symbols-rounded chat-interaction-panel__iframe-url-history-icon'>
                    language
                  </span>
                )}
              <span className='chat-interaction-panel__iframe-url-history-text'>
                <span className='chat-interaction-panel__iframe-url-history-title'>
                  {entry.title ?? entry.url}
                </span>
                <span className='chat-interaction-panel__iframe-url-history-url'>{entry.url}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
