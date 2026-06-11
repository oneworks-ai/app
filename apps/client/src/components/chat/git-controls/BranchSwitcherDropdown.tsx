import { Button, Dropdown, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GitBranchSummary, GitRepositoryState } from '@oneworks/types'

import { OverlayAction, OverlayPanel } from '#~/components/overlay'

import { SenderMobileSelectDrawer } from '../sender/@components/mobile-select-drawer/SenderMobileSelectDrawer'
import { BranchSwitcherResults } from './BranchSwitcherResults'
import { BranchSwitcherToolbar } from './BranchSwitcherToolbar'
import type { GitBranchDisplayMode } from './git-branch-tree'

export function BranchSwitcherDropdown({
  availableLocalBranches,
  currentBranchLabel,
  compact = false,
  isBusy,
  isLoading,
  open,
  repoState,
  branchQuery,
  canCreateBranch,
  hasBranchResults,
  placement = 'bottomLeft',
  remoteBranches,
  onCreateBranch,
  onOpenChange,
  onQueryChange,
  onSwitchBranch
}: {
  availableLocalBranches: GitBranchSummary[]
  compact?: boolean
  currentBranchLabel: string
  isBusy: boolean
  isLoading: boolean
  open: boolean
  repoState: GitRepositoryState
  branchQuery: string
  canCreateBranch: boolean
  hasBranchResults: boolean
  placement?: 'bottomLeft' | 'topLeft'
  remoteBranches: GitBranchSummary[]
  onCreateBranch: (name: string) => void
  onOpenChange: (open: boolean) => void
  onQueryChange: (value: string) => void
  onSwitchBranch: (branch: GitBranchSummary) => void
}) {
  const { t } = useTranslation()
  const [displayMode, setDisplayMode] = useState<GitBranchDisplayMode>('tree')
  const overlayClassName = [
    'chat-header-git__overlay',
    'chat-header-git__overlay--branches',
    compact ? 'chat-header-git__overlay--drawer' : ''
  ].filter(Boolean).join(' ')

  const menuContentBody = (
    <>
      <BranchSwitcherToolbar
        branchQuery={branchQuery}
        canCreateBranch={canCreateBranch}
        displayMode={displayMode}
        onCreateBranch={onCreateBranch}
        onDisplayModeChange={setDisplayMode}
        onQueryChange={onQueryChange}
      />

      <div className='chat-header-git__branch-list'>
        {canCreateBranch && (
          <OverlayAction
            className='chat-header-git__create-row'
            disabled={isBusy}
            onClick={() => onCreateBranch(branchQuery)}
          >
            <div className='chat-header-git__branch-row-main'>
              <span className='chat-header-git__row-icon material-symbols-rounded'>add</span>
              <span className='chat-header-git__row-title'>
                {t('chat.gitCreateBranchWithName', { branch: branchQuery.trim() })}
              </span>
            </div>
          </OverlayAction>
        )}

        {isLoading &&
            availableLocalBranches.length === 0 &&
            remoteBranches.length === 0
          ? (
            <div className='chat-header-git__loading'>
              <Spin size='small' />
            </div>
          )
          : hasBranchResults
          ? (
            <div className='chat-header-git__sections'>
              <BranchSwitcherResults
                availableLocalBranches={availableLocalBranches}
                branchQuery={branchQuery}
                isBusy={isBusy}
                mode={displayMode}
                remoteBranches={remoteBranches}
                onSwitchBranch={onSwitchBranch}
              />
            </div>
          )
          : (
            <div className='chat-header-git__empty chat-header-git__empty--branches'>
              <span className='chat-header-git__empty-icon material-symbols-rounded'>search_off</span>
              <span>{t('chat.gitNoBranches')}</span>
            </div>
          )}
      </div>
    </>
  )
  const menuContent = compact
    ? <div className={overlayClassName}>{menuContentBody}</div>
    : <OverlayPanel className={overlayClassName}>{menuContentBody}</OverlayPanel>

  const triggerButton = (
    <Button
      type='text'
      className={`chat-header-git__trigger chat-header-git__trigger--branch ${open ? 'is-open' : ''} ${
        isBusy ? 'is-disabled' : ''
      }`.trim()}
      title={t('chat.gitBranchSwitcher')}
      aria-label={t('chat.gitBranchSwitcher')}
      onClick={compact ? () => onOpenChange(true) : undefined}
    >
      <span className='chat-header-git__trigger-main'>
        <span className='material-symbols-rounded'>call_split</span>
        <span className='chat-header-git__trigger-label'>{currentBranchLabel}</span>
        {repoState.hasChanges && <span className='chat-header-git__dirty-dot' />}
      </span>
      <span className='chat-header-git__trigger-chevron material-symbols-rounded'>expand_more</span>
    </Button>
  )

  if (compact) {
    return (
      <>
        {triggerButton}
        <SenderMobileSelectDrawer
          open={open}
          title={t('chat.gitBranchSwitcher')}
          className='chat-git-mobile-drawer'
          onClose={() => onOpenChange(false)}
        >
          {menuContent}
        </SenderMobileSelectDrawer>
      </>
    )
  }

  return (
    <Dropdown
      destroyOnHidden
      open={open}
      placement={placement}
      overlayClassName='chat-header-git-dropdown'
      trigger={['click']}
      transitionName=''
      menu={{ items: [] }}
      onOpenChange={onOpenChange}
      popupRender={() => menuContent}
    >
      {triggerButton}
    </Dropdown>
  )
}
