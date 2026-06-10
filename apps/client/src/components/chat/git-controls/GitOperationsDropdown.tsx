import { Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'

import type { GitRepositoryState } from '@oneworks/types'
import type { GitOperationAction, GitOperationKind } from './git-operation-utils'

import { OverlayAction, OverlayPanel } from '#~/components/overlay'
import { SenderMobileSelectDrawer } from '../sender/@components/mobile-select-drawer/SenderMobileSelectDrawer'
import { getPrimaryGitOperationKind, isGitOperationDisabled } from './git-operation-utils'

export function GitOperationsDropdown({
  compact = false,
  isBusy,
  open,
  placement = 'bottomLeft',
  repoState,
  surface = false,
  onOpenChange,
  onOpenCommit,
  onPush,
  onSync
}: {
  compact?: boolean
  isBusy: boolean
  open: boolean
  placement?: 'bottomLeft' | 'topLeft'
  repoState: GitRepositoryState
  surface?: boolean
  onOpenChange: (open: boolean) => void
  onOpenCommit: () => void
  onPush: () => void
  onSync: () => void
}) {
  const { t } = useTranslation()
  const primaryActionKind = getPrimaryGitOperationKind(repoState)
  const operationKinds: GitOperationKind[] = primaryActionKind == null
    ? ['commit', 'push', 'sync']
    : [
      primaryActionKind,
      ...(['commit', 'push', 'sync'] as GitOperationKind[]).filter(kind => kind !== primaryActionKind)
    ]
  const actionMap = {
    commit: {
      disabled: isBusy || isGitOperationDisabled(repoState, 'commit'),
      icon: 'commit',
      label: t('chat.gitCommitShort'),
      onClick: onOpenCommit
    },
    push: {
      disabled: isBusy || isGitOperationDisabled(repoState, 'push'),
      icon: 'upload',
      label: t('chat.gitPushShort'),
      onClick: onPush
    },
    sync: {
      disabled: isBusy || isGitOperationDisabled(repoState, 'sync'),
      icon: 'sync',
      label: t('chat.gitSyncShort'),
      onClick: onSync
    }
  } satisfies Record<GitOperationKind, GitOperationAction>
  const primaryAction = primaryActionKind != null ? actionMap[primaryActionKind] : null
  const operationTitle = t('chat.gitOperations')
  const triggerIcon = primaryAction?.icon ?? 'deployed_code'
  const triggerLabel = primaryAction?.label ?? operationTitle
  const menuItems = (
    <>
      {operationKinds.map(kind => {
        const action = actionMap[kind]
        return (
          <OverlayAction
            key={kind}
            className='chat-header-git__operation-row'
            disabled={action.disabled}
            onClick={action.onClick}
          >
            <div className='chat-header-git__operation-row-main'>
              <span className='chat-header-git__row-icon material-symbols-rounded'>{action.icon}</span>
              <span className='chat-header-git__row-title'>{action.label}</span>
            </div>
          </OverlayAction>
        )
      })}
    </>
  )
  const menuContent = compact
    ? (
      <div className='chat-header-git__overlay chat-header-git__overlay--operations'>
        {menuItems}
      </div>
    )
    : (
      <OverlayPanel className='chat-header-git__overlay chat-header-git__overlay--operations'>
        {menuItems}
      </OverlayPanel>
    )
  const mobileDrawer = compact
    ? (
      <SenderMobileSelectDrawer
        open={open}
        title={operationTitle}
        className='chat-git-mobile-drawer'
        onClose={() => onOpenChange(false)}
      >
        {menuContent}
      </SenderMobileSelectDrawer>
    )
    : null

  const surfaceTrigger = (
    <Button
      type='text'
      className={`chat-header-git__trigger chat-header-git__trigger--operations ${open ? 'is-open' : ''}`.trim()}
      disabled={isBusy}
      title={triggerLabel}
      aria-label={operationTitle}
      onClick={compact ? () => onOpenChange(true) : undefined}
    >
      <span className='chat-header-git__trigger-main'>
        <span className='material-symbols-rounded'>{triggerIcon}</span>
        <span className='chat-header-git__trigger-label'>{triggerLabel}</span>
      </span>
    </Button>
  )

  if (surface && compact) {
    return (
      <>
        {surfaceTrigger}
        {mobileDrawer}
      </>
    )
  }

  if (surface) {
    return (
      <Dropdown
        open={open}
        placement={placement}
        overlayClassName='chat-header-git-dropdown'
        trigger={['click']}
        onOpenChange={onOpenChange}
        popupRender={() => menuContent}
      >
        {surfaceTrigger}
      </Dropdown>
    )
  }

  return (
    <div
      className={`chat-header-git__split chat-header-git__split--operations ${open ? 'is-open' : ''}`.trim()}
    >
      <Button
        type='text'
        className='chat-header-git__split-main'
        disabled={primaryAction?.disabled ?? true}
        title={triggerLabel}
        aria-label={triggerLabel}
        onClick={() => {
          primaryAction?.onClick()
        }}
      >
        <span className='material-symbols-rounded'>{triggerIcon}</span>
        <span className='chat-header-git__trigger-label'>{triggerLabel}</span>
      </Button>

      {primaryActionKind !== 'commit' && (
        <div className='chat-header-git__split-divider' />
      )}

      <Dropdown
        open={compact ? false : open}
        placement={placement}
        overlayClassName='chat-header-git-dropdown'
        trigger={['click']}
        onOpenChange={onOpenChange}
        popupRender={() => menuContent}
      >
        <Button
          type='text'
          className='chat-header-git__split-toggle'
          title={operationTitle}
          aria-label={operationTitle}
          onClick={compact
            ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpenChange(true)
            }
            : undefined}
        >
          <span className='material-symbols-rounded'>expand_more</span>
        </Button>
      </Dropdown>
      {mobileDrawer}
    </div>
  )
}
