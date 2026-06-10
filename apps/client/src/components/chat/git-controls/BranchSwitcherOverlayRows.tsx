import type { GitBranchSummary } from '@oneworks/types'

import { OverlayAction } from '#~/components/overlay'
import type { OverlayTreeNode } from '#~/components/overlay'

import type { GitBranchTreeEntry } from './git-branch-tree'

export const buildBranchSwitcherTreeNodes = (
  entries: GitBranchTreeEntry[],
  isBusy: boolean
): Array<OverlayTreeNode<GitBranchSummary>> =>
  entries.map((entry) => {
    if (entry.type === 'folder') {
      return {
        children: buildBranchSwitcherTreeNodes(entry.folder.entries, isBusy),
        className: 'chat-header-git__branch-tree-folder',
        collapsedIcon: 'folder',
        expandedIcon: 'folder_open',
        key: entry.folder.key,
        label: entry.folder.label,
        rowClassName: 'chat-header-git__branch-folder-row'
      }
    }

    return {
      data: entry.branch,
      disabled: isBusy,
      icon: entry.branch.kind === 'local' ? 'call_split' : 'cloud_sync',
      key: `${entry.branch.kind}:${entry.branch.name}`,
      label: entry.label,
      rowClassName: 'chat-header-git__branch-row chat-header-git__branch-row--tree',
      selected: entry.branch.isCurrent,
      title: entry.branch.name,
      trailing: entry.branch.isCurrent
        ? <span className='chat-header-git__row-state material-symbols-rounded'>check</span>
        : null
    }
  })

export function BranchSwitcherBranchRow({
  branch,
  disabled,
  label,
  onSwitchBranch
}: {
  branch: GitBranchSummary
  disabled: boolean
  label: string
  onSwitchBranch: (branch: GitBranchSummary) => void
}) {
  return (
    <OverlayAction
      className={[
        'chat-header-git__branch-row',
        branch.isCurrent ? 'is-active' : ''
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      title={branch.name}
      aria-current={branch.isCurrent ? 'true' : undefined}
      aria-selected={branch.isCurrent}
      onClick={() => onSwitchBranch(branch)}
    >
      <div className='chat-header-git__branch-row-main'>
        <span className='chat-header-git__row-icon material-symbols-rounded'>
          {branch.kind === 'local' ? 'call_split' : 'cloud_sync'}
        </span>
        <span className='chat-header-git__row-copy'>
          <span className='chat-header-git__row-title'>{label}</span>
        </span>
      </div>
      {branch.isCurrent
        ? <span className='chat-header-git__row-state material-symbols-rounded'>check</span>
        : null}
    </OverlayAction>
  )
}
