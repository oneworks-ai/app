/* eslint-disable max-lines */

import { Button, Dropdown, Switch } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GitWorktreeSummary, SessionWorkspace } from '@oneworks/types'

import { OverlayAction, OverlayActionRow, OverlayPanel, OverlaySearchRow } from '#~/components/overlay'

import {
  SenderMobileSelectBreadcrumbs,
  SenderMobileSelectDrawer
} from '../sender/@components/mobile-select-drawer/SenderMobileSelectDrawer'
import { formatGitWorktreePathLabel } from './git-branch-utils'

interface DraftWorktreeMenuMode {
  type: 'draft'
  createWorktree: boolean
  disabled?: boolean
  onCreateWorktreeChange: (checked: boolean) => void
}

interface SessionWorktreeMenuMode {
  type: 'session'
  isBusy: boolean
  canCreateManagedWorktree: boolean
  canTransferToLocal: boolean
  onCreateManagedWorktree: () => void
  onTransferToLocal: () => void
}

const getWorkspaceKindIcon = (kind: SessionWorkspace['kind']) => {
  switch (kind) {
    case 'managed_worktree':
      return 'account_tree'
    case 'external_workspace':
      return 'folder_open'
    default:
      return 'folder'
  }
}

const getWorkspaceKindLabel = (kind: SessionWorkspace['kind'], t: (key: string) => string) => {
  switch (kind) {
    case 'managed_worktree':
      return t('chat.sessionWorkspaceManaged')
    case 'external_workspace':
      return t('chat.sessionWorkspaceExternal')
    default:
      return t('chat.sessionWorkspaceShared')
  }
}

const getDraftStrategyIcon = (createWorktree: boolean) => (
  createWorktree ? 'create_new_folder' : 'folder_open'
)

const getDraftStrategyLabel = (createWorktree: boolean, t: (key: string) => string) => (
  createWorktree
    ? t('chat.sessionWorkspaceDraftStrategyManaged')
    : t('chat.sessionWorkspaceDraftStrategyLocal')
)

const getWorktreeMenuTitle = (
  mode: DraftWorktreeMenuMode | SessionWorktreeMenuMode,
  t: (key: string) => string
) => (
  mode.type === 'draft'
    ? t('chat.sessionWorkspaceMenuWorktreeList')
    : t('chat.sessionWorkspaceMenuCurrentWorktree')
)

const getWorkspaceStateLabel = (
  state: SessionWorkspace['state'],
  t: (key: string) => string
) => {
  switch (state) {
    case 'provisioning':
      return t('chat.sessionWorkspaceStateProvisioning')
    case 'deleting':
      return t('chat.sessionWorkspaceStateDeleting')
    case 'deleted':
      return t('chat.sessionWorkspaceStateDeleted')
    case 'broken':
      return t('chat.sessionWorkspaceStateBroken')
    default:
      return t('chat.sessionWorkspaceStateReady')
  }
}

const joinWorkspaceSummary = (parts: Array<string | null | undefined>) =>
  parts.filter(part => part != null && part.trim() !== '').join(' · ')

const filterGitWorktrees = (worktrees: GitWorktreeSummary[], query: string) => {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') {
    return worktrees
  }

  return worktrees.filter(worktree => {
    const pathLabel = formatGitWorktreePathLabel(worktree.path).toLowerCase()
    const branchLabel = worktree.branchName?.toLowerCase() ?? ''
    const fullPath = worktree.path.toLowerCase()
    return pathLabel.includes(keyword) || branchLabel.includes(keyword) || fullPath.includes(keyword)
  })
}

export function GitWorktreeDropdown({
  compact = false,
  open,
  workspace,
  worktrees,
  currentBranch,
  mode,
  placement = 'bottomLeft',
  onOpenChange
}: {
  compact?: boolean
  open: boolean
  workspace?: SessionWorkspace
  worktrees: GitWorktreeSummary[]
  currentBranch?: string | null
  mode: DraftWorktreeMenuMode | SessionWorktreeMenuMode
  placement?: 'bottomLeft' | 'topLeft'
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [isWorktreeSubmenuOpen, setIsWorktreeSubmenuOpen] = useState(false)
  const [worktreeQuery, setWorktreeQuery] = useState('')
  const worktreeSearchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setIsWorktreeSubmenuOpen(false)
      setWorktreeQuery('')
    }
  }, [open])

  useEffect(() => {
    if (!open || !isWorktreeSubmenuOpen) return

    const frameId = window.requestAnimationFrame(() => {
      worktreeSearchInputRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isWorktreeSubmenuOpen, open])

  const currentWorkspaceTitle = useMemo(() => {
    if (workspace?.workspaceFolder?.trim()) {
      return formatGitWorktreePathLabel(workspace.workspaceFolder)
    }
    const currentWorktree = worktrees.find(item => item.isCurrent)
    return currentWorktree != null
      ? formatGitWorktreePathLabel(currentWorktree.path)
      : t('chat.gitWorktree')
  }, [t, workspace?.workspaceFolder, worktrees])

  const currentWorkspaceSubtitle = useMemo(() => {
    if (workspace == null) {
      return currentBranch?.trim() || t('chat.gitDetachedHead')
    }

    return joinWorkspaceSummary([
      getWorkspaceKindLabel(workspace.kind, t),
      currentBranch?.trim() || t('chat.gitDetachedHead'),
      workspace.state !== 'ready' ? getWorkspaceStateLabel(workspace.state, t) : null
    ])
  }, [currentBranch, t, workspace])

  const filteredWorktrees = useMemo(
    () => filterGitWorktrees(worktrees, worktreeQuery),
    [worktreeQuery, worktrees]
  )
  const worktreeMenuTitle = getWorktreeMenuTitle(mode, t)
  const rootOverlayClassName = 'chat-header-git__overlay chat-header-git__overlay--worktree-root'
  const submenuOverlayClassName = 'chat-header-git__overlay chat-header-git__overlay--worktree-submenu'

  const triggerLabel = mode.type === 'draft'
    ? getDraftStrategyLabel(mode.createWorktree, t)
    : currentWorkspaceTitle
  const triggerIcon = mode.type === 'draft'
    ? getDraftStrategyIcon(mode.createWorktree)
    : workspace != null
    ? getWorkspaceKindIcon(workspace.kind)
    : 'account_tree'
  const triggerTitle = mode.type === 'draft'
    ? triggerLabel
    : workspace != null
    ? workspace.workspaceFolder
    : currentWorkspaceSubtitle

  const renderWorktreeRootRows = () => (
    <>
      <OverlayAction
        className={`chat-header-git__menu-row ${isWorktreeSubmenuOpen ? 'is-selected' : ''}`}
        onClick={() => setIsWorktreeSubmenuOpen(value => !value)}
      >
        <span className='chat-header-git__menu-row-main'>
          <span className='chat-header-git__row-icon material-symbols-rounded'>
            {workspace != null ? getWorkspaceKindIcon(workspace.kind) : 'account_tree'}
          </span>
          <span className='chat-header-git__menu-row-title'>
            {worktreeMenuTitle}
          </span>
        </span>
        <span className='chat-header-git__menu-row-trailing'>
          {mode.type === 'session' && (
            <span className='chat-header-git__menu-row-value' title={workspace?.workspaceFolder}>
              {currentWorkspaceTitle}
            </span>
          )}
          <span className='material-symbols-rounded'>chevron_right</span>
        </span>
      </OverlayAction>

      {mode.type === 'draft' && (
        <OverlayActionRow
          className='chat-header-git__menu-row chat-header-git__menu-row--toggle'
          disabled={mode.disabled}
        >
          <span className='chat-header-git__menu-row-main'>
            <span className='chat-header-git__row-icon material-symbols-rounded'>
              {getDraftStrategyIcon(true)}
            </span>
            <span className='chat-header-git__menu-row-title'>
              {t('chat.sessionWorkspaceMenuLaunchInWorktree')}
            </span>
          </span>
          <Switch
            className='chat-header-git__worktree-switch'
            checked={mode.createWorktree}
            disabled={mode.disabled}
            size='small'
            onChange={mode.onCreateWorktreeChange}
            onClick={(checked, event) => {
              event?.stopPropagation()
            }}
          />
        </OverlayActionRow>
      )}

      {mode.type === 'session' && mode.canTransferToLocal && (
        <OverlayAction
          className='chat-header-git__menu-row'
          disabled={mode.isBusy}
          onClick={mode.onTransferToLocal}
        >
          <span className='chat-header-git__menu-row-main'>
            <span className='chat-header-git__row-icon material-symbols-rounded'>drive_export</span>
            <span className='chat-header-git__menu-row-title'>
              {t('chat.sessionWorkspaceMenuTransferToLocal')}
            </span>
          </span>
        </OverlayAction>
      )}

      {mode.type === 'session' && mode.canCreateManagedWorktree && (
        <OverlayAction
          className='chat-header-git__menu-row'
          disabled={mode.isBusy}
          onClick={mode.onCreateManagedWorktree}
        >
          <span className='chat-header-git__menu-row-main'>
            <span className='chat-header-git__row-icon material-symbols-rounded'>add</span>
            <span className='chat-header-git__menu-row-title'>
              {t('chat.sessionWorkspaceMenuCreateWorktree')}
            </span>
          </span>
        </OverlayAction>
      )}
    </>
  )

  const renderWorktreeList = () => (
    <>
      <div className='chat-header-git__worktree-submenu-body'>
        {filteredWorktrees.length > 0
          ? (
            <div className='chat-header-git__worktree-list'>
              {filteredWorktrees.map(worktree => (
                <OverlayActionRow
                  key={worktree.path}
                  className={[
                    'chat-header-git__worktree-row',
                    mode.type === 'session' && worktree.isCurrent ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                  title={worktree.path}
                >
                  <div className='chat-header-git__worktree-row-main'>
                    <span className='chat-header-git__row-icon material-symbols-rounded'>folder_open</span>
                    <span className='chat-header-git__row-copy'>
                      <span className='chat-header-git__row-title'>
                        {formatGitWorktreePathLabel(worktree.path)}
                      </span>
                      <span className='chat-header-git__row-subtitle'>
                        {worktree.branchName?.trim() || t('chat.gitDetachedHead')}
                      </span>
                    </span>
                  </div>
                  {mode.type === 'session' && worktree.isCurrent && (
                    <span className='chat-header-git__worktree-chip'>
                      {t('chat.sessionWorkspaceCurrentSession')}
                    </span>
                  )}
                </OverlayActionRow>
              ))}
            </div>
          )
          : (
            <div className='chat-header-git__empty--worktrees'>
              <span className='chat-header-git__empty-icon material-symbols-rounded'>search_off</span>
              <span>{t('chat.sessionWorkspaceNoWorktrees')}</span>
            </div>
          )}
      </div>

      <OverlaySearchRow
        className='chat-header-git__worktree-search-row'
        autoFocus
        clearLabel={t('common.clear')}
        inputRef={worktreeSearchInputRef}
        placeholder={t('chat.sessionWorkspaceSearchWorktrees')}
        value={worktreeQuery}
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onChange={setWorktreeQuery}
        onClear={() => setWorktreeQuery('')}
      />
    </>
  )

  const triggerButton = (
    <Button
      type='text'
      className={`chat-header-git__trigger chat-header-git__trigger--worktree ${open ? 'is-open' : ''} ${
        mode.type === 'session' && mode.isBusy ? 'is-disabled' : ''
      }`.trim()}
      title={triggerTitle}
      aria-label={t('chat.sessionWorkspace')}
      onClick={compact ? () => onOpenChange(true) : undefined}
    >
      <span className='chat-header-git__trigger-main'>
        <span className='material-symbols-rounded'>{triggerIcon}</span>
        <span className='chat-header-git__trigger-label'>{triggerLabel}</span>
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
          title={t('chat.sessionWorkspace')}
          className='chat-git-mobile-drawer'
          onClose={() => onOpenChange(false)}
        >
          <SenderMobileSelectBreadcrumbs
            items={[
              {
                key: 'root',
                label: t('chat.sessionWorkspace'),
                onClick: isWorktreeSubmenuOpen ? () => setIsWorktreeSubmenuOpen(false) : undefined
              },
              ...(isWorktreeSubmenuOpen
                ? [{
                  key: 'worktrees',
                  label: worktreeMenuTitle
                }]
                : [])
            ]}
          />
          <div className={isWorktreeSubmenuOpen ? submenuOverlayClassName : rootOverlayClassName}>
            {isWorktreeSubmenuOpen ? renderWorktreeList() : renderWorktreeRootRows()}
          </div>
        </SenderMobileSelectDrawer>
      </>
    )
  }

  return (
    <Dropdown
      open={open}
      placement={placement}
      overlayClassName='chat-header-git-dropdown'
      trigger={['click']}
      onOpenChange={onOpenChange}
      popupRender={() => (
        <div className='chat-header-git__menu-shell'>
          <OverlayPanel className={rootOverlayClassName}>
            {renderWorktreeRootRows()}
          </OverlayPanel>

          {isWorktreeSubmenuOpen && (
            <OverlayPanel className={submenuOverlayClassName}>
              {renderWorktreeList()}
            </OverlayPanel>
          )}
        </div>
      )}
    >
      {triggerButton}
    </Dropdown>
  )
}
