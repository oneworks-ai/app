/* eslint-disable max-lines */

import { Spin } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { GitBranchSummary, SessionWorkspace } from '@oneworks/types'

import { listWorktreeEnvironments } from '#~/api'
import { toDisplayEnvironmentName, toEnvironmentReference } from '#~/components/config/worktree-environment-panel-model'
import { OverlayAction } from '#~/components/overlay'
import type { OverlayMenuItem } from '#~/components/overlay'

import { BranchSwitcherResults } from '../../../git-controls/BranchSwitcherResults'
import { BranchSwitcherToolbar } from '../../../git-controls/BranchSwitcherToolbar'
import type { GitBranchDisplayMode } from '../../../git-controls/git-branch-tree'
import { formatGitWorktreePathLabel } from '../../../git-controls/git-branch-utils'
import { useChatDraftGitControls } from '../../../git-controls/use-chat-draft-git-controls'
import { useChatGitControls } from '../../../git-controls/use-chat-git-controls'
import type { SenderStatusBarGitControlsInMore } from '../../@types/sender-props'

export interface ReferenceActionsStatusGitItems {
  items: OverlayMenuItem[]
  selectedKeys: string[]
}

const emptyStatusGitItems: ReferenceActionsStatusGitItems = {
  items: [],
  selectedKeys: []
}

const currentValue = (value: string) => (
  <span className='reference-actions-menu-current'>{value}</span>
)

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

const getWorkspaceStateLabel = (state: SessionWorkspace['state'], t: (key: string) => string) => {
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

const joinSummary = (parts: Array<string | null | undefined>) =>
  parts.filter(part => part != null && part.trim() !== '').join(' · ')

const markSelectedBranches = (
  branches: GitBranchSummary[],
  selectedBranch?: { kind: GitBranchSummary['kind']; name: string }
) => {
  if (selectedBranch == null) {
    return branches
  }

  return branches.map(branch => ({
    ...branch,
    isCurrent: selectedBranch.kind === branch.kind && selectedBranch.name === branch.name
  }))
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function ReferenceActionsBranchTree({
  availableLocalBranches,
  branchQuery,
  canCreateBranch,
  disabled,
  hasBranchResults,
  isLoading,
  remoteBranches,
  selectedBranch,
  t,
  onClose,
  onCreateBranch,
  onQueryChange,
  onSwitchBranch
}: {
  availableLocalBranches: GitBranchSummary[]
  branchQuery: string
  canCreateBranch: boolean
  disabled: boolean
  hasBranchResults: boolean
  isLoading: boolean
  remoteBranches: GitBranchSummary[]
  selectedBranch?: { kind: GitBranchSummary['kind']; name: string }
  t: Translate
  onClose?: () => void
  onCreateBranch: (name: string) => void
  onQueryChange: (value: string) => void
  onSwitchBranch: (branch: GitBranchSummary) => void
}) {
  const [displayMode, setDisplayMode] = useState<GitBranchDisplayMode>('tree')
  const localBranches = useMemo(
    () => markSelectedBranches(availableLocalBranches, selectedBranch),
    [availableLocalBranches, selectedBranch]
  )
  const remoteBranchItems = useMemo(
    () => markSelectedBranches(remoteBranches, selectedBranch),
    [remoteBranches, selectedBranch]
  )

  return (
    <>
      <BranchSwitcherToolbar
        branchQuery={branchQuery}
        canCreateBranch={canCreateBranch}
        displayMode={displayMode}
        onCreateBranch={(name) => {
          onCreateBranch(name)
          onClose?.()
        }}
        onDisplayModeChange={setDisplayMode}
        onQueryChange={onQueryChange}
      />

      <div className='chat-header-git__branch-list'>
        {canCreateBranch && (
          <OverlayAction
            className='chat-header-git__create-row'
            disabled={disabled}
            onClick={() => {
              onCreateBranch(branchQuery)
              onClose?.()
            }}
          >
            <div className='chat-header-git__branch-row-main'>
              <span className='chat-header-git__row-icon material-symbols-rounded'>add</span>
              <span className='chat-header-git__row-title'>
                {t('chat.gitCreateBranchWithName', { branch: branchQuery.trim() })}
              </span>
            </div>
          </OverlayAction>
        )}
        {isLoading && localBranches.length === 0 && remoteBranchItems.length === 0
          ? (
            <div className='chat-header-git__loading'>
              <Spin size='small' />
            </div>
          )
          : hasBranchResults
          ? (
            <div className='chat-header-git__sections'>
              <BranchSwitcherResults
                availableLocalBranches={localBranches}
                branchQuery={branchQuery}
                isBusy={disabled}
                mode={displayMode}
                remoteBranches={remoteBranchItems}
                onSwitchBranch={(branch) => {
                  onSwitchBranch(branch)
                  onClose?.()
                }}
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
}

const buildBranchItem = ({
  availableLocalBranches,
  branchQuery,
  canCreateBranch,
  currentBranchLabel,
  disabled,
  hasBranchResults,
  isLoading,
  prefix,
  remoteBranches,
  selectedBranch,
  t,
  onClose,
  onCreateBranch,
  onQueryChange,
  onSwitchBranch
}: {
  availableLocalBranches: GitBranchSummary[]
  branchQuery: string
  canCreateBranch: boolean
  currentBranchLabel: string
  disabled: boolean
  hasBranchResults: boolean
  isLoading: boolean
  prefix: string
  remoteBranches: GitBranchSummary[]
  selectedBranch?: { kind: GitBranchSummary['kind']; name: string }
  t: Translate
  onClose?: () => void
  onCreateBranch: (name: string) => void
  onQueryChange: (value: string) => void
  onSwitchBranch: (branch: GitBranchSummary) => void
}) => ({
  key: `${prefix}:branch`,
  label: t('chat.gitBranchSwitcher'),
  icon: 'call_split',
  disabled,
  trailing: currentValue(currentBranchLabel),
  children: [{
    key: `${prefix}:branch-tree`,
    type: 'custom' as const,
    className: 'reference-actions-menu-branch-tree',
    content: (
      <ReferenceActionsBranchTree
        availableLocalBranches={availableLocalBranches}
        branchQuery={branchQuery}
        canCreateBranch={canCreateBranch}
        disabled={disabled}
        hasBranchResults={hasBranchResults}
        isLoading={isLoading}
        remoteBranches={remoteBranches}
        selectedBranch={selectedBranch}
        t={t}
        onClose={onClose}
        onCreateBranch={onCreateBranch}
        onQueryChange={onQueryChange}
        onSwitchBranch={onSwitchBranch}
      />
    )
  }]
} satisfies OverlayMenuItem)

interface ReferenceActionsStatusGitOptions {
  onClose?: () => void
}

export function useReferenceActionsSessionStatusGitItems({
  sessionId
}: Extract<SenderStatusBarGitControlsInMore, { type: 'session' }>, {
  onClose
}: ReferenceActionsStatusGitOptions = {}): ReferenceActionsStatusGitItems {
  const { t } = useTranslation()
  const git = useChatGitControls(sessionId)

  useEffect(() => {
    if (git.repoState?.available === true) {
      git.setShouldLoadBranches(true)
    }
  }, [git.repoState?.available, git.setShouldLoadBranches])

  if (git.workspace == null && git.repoState?.available !== true) {
    return emptyStatusGitItems
  }

  const items: OverlayMenuItem[] = []
  const selectedKeys: string[] = []
  const currentWorkspaceTitle = git.workspace?.workspaceFolder?.trim()
    ? formatGitWorktreePathLabel(git.workspace.workspaceFolder)
    : git.worktrees.find(item => item.isCurrent)?.path != null
    ? formatGitWorktreePathLabel(git.worktrees.find(item => item.isCurrent)?.path ?? '')
    : t('chat.gitWorktree')
  const workspaceIcon = git.workspace == null ? 'account_tree' : getWorkspaceKindIcon(git.workspace.kind)
  const workspaceDescription = git.workspace == null
    ? git.repoState?.currentBranch?.trim() || t('chat.gitDetachedHead')
    : joinSummary([
      getWorkspaceKindLabel(git.workspace.kind, t),
      git.repoState?.currentBranch?.trim() || t('chat.gitDetachedHead'),
      git.workspace.state !== 'ready' ? getWorkspaceStateLabel(git.workspace.state, t) : null
    ])
  const workspaceChildren: OverlayMenuItem[] = [{
    key: 'status-git-workspace-current',
    label: currentWorkspaceTitle,
    description: workspaceDescription,
    icon: workspaceIcon,
    selected: true
  }]

  if (git.workspace?.kind === 'managed_worktree') {
    workspaceChildren.push({
      key: 'status-git-workspace-transfer',
      label: t('chat.sessionWorkspaceMenuTransferToLocal'),
      icon: 'drive_export',
      disabled: git.isBusy,
      onSelect: git.handleTransferWorkspaceToLocal
    })
  } else if (
    git.repoState?.available === true &&
    git.workspace != null &&
    (git.workspace.worktreePath == null || git.workspace.worktreePath.trim() === '')
  ) {
    workspaceChildren.push({
      key: 'status-git-workspace-create',
      label: t('chat.sessionWorkspaceMenuCreateWorktree'),
      icon: 'add',
      disabled: git.isBusy,
      onSelect: git.handleCreateManagedWorktree
    })
  }

  items.push({
    key: 'status-git-workspace',
    label: t('chat.sessionWorkspace'),
    icon: workspaceIcon,
    trailing: currentValue(currentWorkspaceTitle),
    children: workspaceChildren
  })

  if (git.repoState?.available === true) {
    items.push(buildBranchItem({
      availableLocalBranches: git.availableLocalBranches,
      branchQuery: git.branchQuery,
      canCreateBranch: git.canCreateBranch,
      currentBranchLabel: git.currentBranchLabel,
      disabled: git.isBusy,
      hasBranchResults: git.hasBranchResults,
      isLoading: git.isBranchListLoading,
      prefix: 'status-git-session',
      remoteBranches: git.remoteBranches,
      t,
      onClose,
      onCreateBranch: git.handleCreateBranch,
      onQueryChange: git.setBranchQuery,
      onSwitchBranch: git.handleBranchSwitch
    }))
  }

  return { items, selectedKeys }
}

export function useReferenceActionsDraftStatusGitItems({
  disabled = false,
  draftWorkspace,
  onDraftWorkspaceChange
}: Extract<SenderStatusBarGitControlsInMore, { type: 'draft' }>, {
  onClose
}: ReferenceActionsStatusGitOptions = {}): ReferenceActionsStatusGitItems {
  const { t } = useTranslation()
  const git = useChatDraftGitControls({
    draft: draftWorkspace,
    onChange: onDraftWorkspaceChange
  })
  const { data } = useSWR('worktree-environments', listWorktreeEnvironments, { revalidateOnFocus: false })

  useEffect(() => {
    if (git.repoState.available) {
      git.setShouldLoadBranches(true)
    }
  }, [git.repoState.available, git.setShouldLoadBranches])

  if (!git.repoState.available) {
    return emptyStatusGitItems
  }

  const items: OverlayMenuItem[] = []
  const selectedKeys: string[] = []
  const worktreeModeKey = draftWorkspace.createWorktree
    ? 'status-git-draft-worktree-managed'
    : 'status-git-draft-worktree-local'
  selectedKeys.push(worktreeModeKey)
  items.push({
    key: 'status-git-draft-worktree',
    label: t('chat.sessionWorkspace'),
    icon: draftWorkspace.createWorktree ? 'create_new_folder' : 'folder_open',
    trailing: currentValue(
      draftWorkspace.createWorktree
        ? t('chat.sessionWorkspaceDraftStrategyManaged')
        : t('chat.sessionWorkspaceDraftStrategyLocal')
    ),
    children: [
      {
        key: 'status-git-draft-worktree-local',
        label: t('chat.sessionWorkspaceDraftStrategyLocal'),
        icon: draftWorkspace.createWorktree ? 'folder_open' : 'check',
        selected: !draftWorkspace.createWorktree,
        disabled,
        onSelect: () => git.handleCreateWorktreeChange(false)
      },
      {
        key: 'status-git-draft-worktree-managed',
        label: t('chat.sessionWorkspaceDraftStrategyManaged'),
        icon: draftWorkspace.createWorktree ? 'check' : 'create_new_folder',
        selected: draftWorkspace.createWorktree,
        disabled,
        onSelect: () => git.handleCreateWorktreeChange(true)
      }
    ]
  })

  const environments = data?.environments ?? []
  const selectedEnvironment = environments.find(environment =>
    toEnvironmentReference(environment) === draftWorkspace.worktreeEnvironment ||
    environment.id === draftWorkspace.worktreeEnvironment
  )
  const selectedEnvironmentKey = selectedEnvironment == null
    ? 'status-git-draft-environment-default'
    : `status-git-draft-environment:${selectedEnvironment.source}:${selectedEnvironment.id}`
  selectedKeys.push(selectedEnvironmentKey)
  items.push({
    key: 'status-git-draft-environment',
    label: t('chat.sessionWorkspaceEnvironment'),
    icon: 'deployed_code',
    trailing: currentValue(
      selectedEnvironment == null
        ? t('chat.sessionWorkspaceEnvironmentDefault')
        : toDisplayEnvironmentName(selectedEnvironment.id)
    ),
    children: [
      {
        key: 'status-git-draft-environment-default',
        label: t('chat.sessionWorkspaceEnvironmentDefault'),
        icon: selectedEnvironment == null ? 'check' : 'settings_suggest',
        selected: selectedEnvironment == null,
        disabled,
        onSelect: () => onDraftWorkspaceChange({ ...draftWorkspace, worktreeEnvironment: undefined })
      },
      ...environments.map(environment => {
        const key = `status-git-draft-environment:${environment.source}:${environment.id}`
        const selected = key === selectedEnvironmentKey
        return {
          key,
          label: toDisplayEnvironmentName(environment.id),
          icon: selected ? 'check' : environment.isLocal ? 'person' : 'folder',
          description: environment.isLocal
            ? t('chat.sessionWorkspaceEnvironmentLocal')
            : t('chat.sessionWorkspaceEnvironmentProject'),
          selected,
          disabled,
          onSelect: () =>
            onDraftWorkspaceChange({
              ...draftWorkspace,
              worktreeEnvironment: toEnvironmentReference(environment)
            })
        } satisfies OverlayMenuItem
      })
    ]
  })

  const selectedBranch = draftWorkspace.branch?.mode === 'checkout' && draftWorkspace.branch.kind != null
    ? { kind: draftWorkspace.branch.kind, name: draftWorkspace.branch.name }
    : undefined
  items.push(buildBranchItem({
    availableLocalBranches: git.availableLocalBranches,
    branchQuery: git.branchQuery,
    canCreateBranch: git.canCreateBranch,
    currentBranchLabel: git.currentBranchLabel,
    disabled,
    hasBranchResults: git.hasBranchResults,
    isLoading: git.isBranchListLoading,
    prefix: 'status-git-draft',
    remoteBranches: git.remoteBranches,
    selectedBranch,
    t,
    onClose,
    onCreateBranch: git.handleCreateBranch,
    onQueryChange: git.setBranchQuery,
    onSwitchBranch: git.handleBranchSwitch
  }))

  return { items, selectedKeys }
}
