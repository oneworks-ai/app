import './ChatStatusBar.scss'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { AccountQuotaIndicators } from '#~/components/chat/sender/@components/account-select/AccountQuotaIndicators'
import { AccountSelectControl } from '#~/components/chat/sender/@components/account-select/AccountSelectControl'
import { AdapterSelectControl } from '#~/components/chat/sender/@components/adapter-select/AdapterSelectControl'
import type { ChatSessionWorkspaceDraft } from '#~/hooks/chat/chat-session-workspace-draft'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'
import type {
  ChatAdapterSelectOption,
  HiddenBuiltinAdapterOption
} from '#~/hooks/chat/use-chat-model-adapter-selection'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import { ChatGitControls } from '../git-controls/ChatGitControls'
import { DraftGitControls } from '../git-controls/DraftGitControls'

export function ChatStatusBar({
  draftWorkspace,
  isCreating,
  sessionId,
  adapterLocked = false,
  isThinking = false,
  modelUnavailable = false,
  selectedAdapter,
  adapterOptions,
  hiddenBuiltinAdapterOptions,
  onAdapterChange,
  selectedAccount,
  accountOptions,
  showAccountSelector = false,
  collapsible = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onAccountChange,
  onDraftWorkspaceChange
}: {
  draftWorkspace: ChatSessionWorkspaceDraft
  isCreating: boolean
  sessionId?: string
  adapterLocked?: boolean
  isThinking?: boolean
  modelUnavailable?: boolean
  selectedAdapter?: string
  adapterOptions?: ChatAdapterSelectOption[]
  hiddenBuiltinAdapterOptions?: HiddenBuiltinAdapterOption[]
  onAdapterChange?: (adapter: string) => void
  selectedAccount?: string
  accountOptions?: ChatAdapterAccountOption[]
  showAccountSelector?: boolean
  collapsible?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onAccountChange?: (account: string) => void
  onDraftWorkspaceChange: (nextDraft: ChatSessionWorkspaceDraft) => void
}) {
  const { t } = useTranslation()
  const { isCompactLayout } = useResponsiveLayout()
  const [searchParams] = useSearchParams()
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false)
  const selectedAccountQuotaWindows = accountOptions
    ?.find(option => option.value === selectedAccount)
    ?.quotaWindows
  const collapsed = collapsible && (controlledCollapsed ?? uncontrolledCollapsed)
  const setCollapsed = (nextCollapsed: boolean) => {
    if (controlledCollapsed == null) {
      setUncontrolledCollapsed(nextCollapsed)
    }
    onCollapsedChange?.(nextCollapsed)
  }
  const defaultAdapterSelectOpen = sessionId == null &&
    searchParams.get('owPreview') === 'homepage' &&
    searchParams.get('adapterSelect') === 'open'
  const statusBarFrameClassName = [
    'chat-status-bar-frame',
    isCompactLayout ? 'chat-status-bar--compact' : '',
    collapsible ? 'chat-status-bar--collapsible' : '',
    collapsible && collapsed ? 'is-collapsed' : ''
  ].filter(Boolean).join(' ')
  const statusBarClassName = [
    'chat-status-bar',
    isCompactLayout ? 'chat-status-bar--compact' : '',
    collapsible ? 'chat-status-bar--collapsible' : '',
    collapsible && collapsed ? 'is-collapsed' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={statusBarFrameClassName}>
      <div className={statusBarClassName}>
        <div className='chat-status-bar__content' aria-hidden={collapsible && collapsed}>
          {sessionId != null && sessionId !== ''
            ? (
              <ChatGitControls
                compact={isCompactLayout}
                placement='topLeft'
                sessionId={sessionId}
                surface={collapsible}
              />
            )
            : (
              <DraftGitControls
                compact={isCompactLayout}
                disabled={isCreating}
                draft={draftWorkspace}
                placement='topLeft'
                onChange={onDraftWorkspaceChange}
              />
            )}
        </div>
        {collapsible && (
          <button
            type='button'
            className='chat-status-bar__collapse-toggle'
            aria-label={t('chat.collapseStatusBar')}
            onClick={() => setCollapsed(true)}
          >
            <span className='material-symbols-rounded'>keyboard_arrow_up</span>
          </button>
        )}
        <div className='chat-status-bar__actions' aria-hidden={collapsible && collapsed}>
          {showAccountSelector && accountOptions != null && accountOptions.length > 0 && (
            <div className='chat-status-bar__account-group'>
              <AccountSelectControl
                state={{
                  isThinking,
                  modelUnavailable,
                  selectedAccount,
                  selectedAdapter,
                  showAccountSelector
                }}
                data={{ accountOptions }}
                handlers={{ onAccountChange }}
              />
              {!isCompactLayout && <AccountQuotaIndicators windows={selectedAccountQuotaWindows} />}
            </div>
          )}
          <AdapterSelectControl
            state={{
              adapterLocked,
              modelUnavailable,
              isThinking,
              selectedAdapter
            }}
            data={{ adapterOptions, defaultOpen: defaultAdapterSelectOpen, hiddenBuiltinAdapterOptions }}
            handlers={{ onAdapterChange }}
          />
        </div>
      </div>
      {collapsible && (
        <button
          type='button'
          className='chat-status-bar__collapsed-line'
          aria-label={t('chat.expandStatusBar')}
          onClick={() => setCollapsed(false)}
        />
      )}
    </div>
  )
}
