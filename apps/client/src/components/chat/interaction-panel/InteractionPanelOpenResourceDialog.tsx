import { Modal } from 'antd'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getWorkspaceFileIconMeta } from '#~/components/chat/workspace-drawer/workspace-drawer-icons'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { InteractionPanelResourceSearchResult } from './interaction-panel-resource-search'
import { useInteractionPanelResourceSearch } from './use-interaction-panel-resource-search'

const getResourceTitle = (resource: InteractionPanelResourceSearchResult) =>
  resource.kind === 'file' ? resource.name : resource.title

const getResourceSubtitle = (resource: InteractionPanelResourceSearchResult) =>
  resource.kind === 'file'
    ? resource.directory || resource.path
    : resource.kind === 'session'
    ? resource.sessionId
    : resource.url

const getResourceKindLabelKey = (resource: InteractionPanelResourceSearchResult) =>
  resource.kind === 'file'
    ? 'chat.interactionPanel.resourceFile'
    : resource.kind === 'session'
    ? 'chat.interactionPanel.resourceChildSession'
    : 'chat.interactionPanel.resourceWebsite'

const getResourceEmptyState = ({
  hasError,
  isLoading,
  query
}: {
  hasError: boolean
  isLoading: boolean
  query: string
}) => {
  if (isLoading) return { icon: 'progress_activity', messageKey: 'chat.interactionPanel.openResourceLoading' }
  if (hasError) return { icon: 'error', messageKey: 'chat.interactionPanel.openResourceLoadFailed' }
  if (query.trim() === '') return { icon: 'search', messageKey: 'chat.interactionPanel.openResourceInputHint' }
  return { icon: 'travel_explore', messageKey: 'chat.interactionPanel.openResourceEmpty' }
}

const renderResourceIcon = (resource: InteractionPanelResourceSearchResult) => {
  if (resource.kind === 'file') {
    const icon = getWorkspaceFileIconMeta(resource.name)
    return (
      <span className={`material-symbols-rounded chat-interaction-panel-open-resource__item-icon is-${icon.tone}`}>
        {icon.icon}
      </span>
    )
  }

  if (resource.kind === 'website' && resource.faviconUrl != null) {
    return (
      <img
        alt=''
        className='chat-interaction-panel-open-resource__item-favicon'
        src={resource.faviconUrl}
      />
    )
  }

  return (
    <span
      className={`material-symbols-rounded chat-interaction-panel-open-resource__item-icon is-${resource.kind}`}
    >
      {resource.kind === 'session' ? 'forum' : 'language'}
    </span>
  )
}

export function InteractionPanelOpenResourceDialog({
  iframePages,
  open,
  projectUrlHistoryKey,
  recentFilePaths,
  sessionId,
  sessionUrlHistoryKey,
  onClose,
  onOpenFile,
  onOpenSession,
  onOpenWebsite
}: {
  iframePages: InteractionPanelIframePage[]
  open: boolean
  projectUrlHistoryKey: string
  recentFilePaths: string[]
  sessionId?: string
  sessionUrlHistoryKey: string
  onClose: () => void
  onOpenFile: (path: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenWebsite: (url: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const { hasError, isLoading, results } = useInteractionPanelResourceSearch({
    iframePages,
    open,
    projectUrlHistoryKey,
    query,
    recentFilePaths,
    sessionId,
    sessionUrlHistoryKey
  })

  useEffect(() => {
    if (!open) return
    setQuery('')
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [open, onClose])

  const openResource = (resource: InteractionPanelResourceSearchResult) => {
    if (resource.kind === 'file') onOpenFile(resource.path)
    else if (resource.kind === 'session') onOpenSession(resource.sessionId)
    else onOpenWebsite(resource.url)
    onClose()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || results[0] == null) return
    event.preventDefault()
    openResource(results[0])
  }
  const sectionLabelKey = query.trim() === ''
    ? 'chat.interactionPanel.openResourceRecentSection'
    : 'chat.interactionPanel.openResourceResultsSection'
  const emptyState = getResourceEmptyState({ hasError, isLoading, query })

  return (
    <Modal
      centered
      className='chat-interaction-panel-open-resource-modal'
      closable={false}
      destroyOnHidden
      footer={null}
      open={open}
      width={540}
      onCancel={onClose}
    >
      <div className='chat-interaction-panel-open-resource'>
        <div className='chat-interaction-panel-open-resource__search'>
          <span className='material-symbols-rounded chat-interaction-panel-open-resource__search-icon'>search</span>
          <input
            autoFocus
            className='chat-interaction-panel-open-resource__search-input'
            placeholder={t('chat.interactionPanel.openResourceSearchPlaceholder')}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className='chat-interaction-panel-open-resource__section-label'>{t(sectionLabelKey)}</div>
        {results.length === 0
          ? (
            <div className='chat-interaction-panel-open-resource__hint'>
              <span className='material-symbols-rounded chat-interaction-panel-open-resource__hint-icon'>
                {emptyState.icon}
              </span>
              {t(emptyState.messageKey)}
            </div>
          )
          : (
            <div className='chat-interaction-panel-open-resource__list'>
              {results.map((resource) => {
                const subtitle = getResourceSubtitle(resource)
                return (
                  <button
                    key={resource.id}
                    type='button'
                    className='chat-interaction-panel-open-resource__item'
                    onClick={() => openResource(resource)}
                  >
                    {renderResourceIcon(resource)}
                    <span className='chat-interaction-panel-open-resource__item-text'>
                      <span className='chat-interaction-panel-open-resource__item-name'>
                        {getResourceTitle(resource)}
                      </span>
                      <span className='chat-interaction-panel-open-resource__item-meta'>
                        <span className='chat-interaction-panel-open-resource__item-kind'>
                          {t(getResourceKindLabelKey(resource))}
                        </span>
                        <span className='chat-interaction-panel-open-resource__item-path'>{subtitle}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
      </div>
    </Modal>
  )
}
