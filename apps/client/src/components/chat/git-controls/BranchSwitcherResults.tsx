import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GitBranchSummary } from '@oneworks/types'

import { OverlayDivider, OverlayTree } from '#~/components/overlay'

import { BranchSwitcherBranchRow, buildBranchSwitcherTreeNodes } from './BranchSwitcherOverlayRows'
import type { GitBranchDisplayMode } from './git-branch-tree'
import {
  buildGitBranchTree,
  collectGitBranchTreeFolderKeys,
  getGitBranchTreeFolderKeysForBranch
} from './git-branch-tree'

export function BranchSwitcherResults({
  availableLocalBranches,
  branchQuery,
  isBusy,
  mode,
  remoteBranches,
  onSwitchBranch
}: {
  availableLocalBranches: GitBranchSummary[]
  branchQuery: string
  isBusy: boolean
  mode: GitBranchDisplayMode
  remoteBranches: GitBranchSummary[]
  onSwitchBranch: (branch: GitBranchSummary) => void
}) {
  const { t } = useTranslation()
  const localBranchTree = useMemo(
    () => buildGitBranchTree(availableLocalBranches, 'local'),
    [availableLocalBranches]
  )
  const remoteBranchTree = useMemo(
    () => buildGitBranchTree(remoteBranches, 'remote'),
    [remoteBranches]
  )
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<string[]>([])
  const hasSearchQuery = branchQuery.trim() !== ''
  const currentLocalBranch = useMemo(
    () => availableLocalBranches.find(branch => branch.isCurrent),
    [availableLocalBranches]
  )
  const currentRemoteBranch = useMemo(
    () => remoteBranches.find(branch => branch.isCurrent),
    [remoteBranches]
  )

  const unifiedTreeEntries = useMemo(() => {
    const entries = []
    if (localBranchTree.length > 0) {
      entries.push({
        type: 'folder' as const,
        folder: {
          entries: localBranchTree,
          hasCurrentBranch: currentLocalBranch != null,
          key: 'local',
          label: t('chat.gitBranchesLocal')
        }
      })
    }
    if (remoteBranchTree.length > 0) {
      entries.push({
        type: 'folder' as const,
        folder: {
          entries: remoteBranchTree,
          hasCurrentBranch: currentRemoteBranch != null,
          key: 'remote',
          label: t('chat.gitBranchesRemote')
        }
      })
    }

    return entries.sort((left, right) => {
      if (left.folder.hasCurrentBranch !== right.folder.hasCurrentBranch) {
        return left.folder.hasCurrentBranch ? -1 : 1
      }

      return left.folder.label.localeCompare(right.folder.label)
    })
  }, [currentLocalBranch, currentRemoteBranch, localBranchTree, remoteBranchTree, t])

  const allFolderKeys = useMemo(
    () => new Set(collectGitBranchTreeFolderKeys(unifiedTreeEntries)),
    [unifiedTreeEntries]
  )
  const defaultExpandedFolderKeys = useMemo(
    () =>
      new Set([
        ...(currentLocalBranch != null ? getGitBranchTreeFolderKeysForBranch(currentLocalBranch, 'local') : []),
        ...(currentRemoteBranch != null ? getGitBranchTreeFolderKeysForBranch(currentRemoteBranch, 'remote') : [])
      ]),
    [currentLocalBranch, currentRemoteBranch]
  )

  useEffect(() => {
    setCollapsedFolderKeys(
      Array.from(allFolderKeys).filter(key => !defaultExpandedFolderKeys.has(key))
    )
  }, [allFolderKeys, defaultExpandedFolderKeys])

  const toggleFolder = (folderKey: string) => {
    setCollapsedFolderKeys(currentKeys => (
      currentKeys.includes(folderKey)
        ? currentKeys.filter(key => key !== folderKey)
        : [...currentKeys, folderKey]
    ))
  }
  const branchTreeNodes = useMemo(() => {
    return buildBranchSwitcherTreeNodes(unifiedTreeEntries, isBusy)
  }, [isBusy, unifiedTreeEntries])

  const renderBranchSection = (title: string, branches: GitBranchSummary[]) => {
    if (branches.length === 0) {
      return null
    }

    return (
      <div className='chat-header-git__section'>
        <span className='chat-header-git__section-label'>{title}</span>
        {branches.map(branch => {
          return (
            <BranchSwitcherBranchRow
              key={`${branch.kind}:${branch.name}`}
              branch={branch}
              disabled={isBusy}
              label={branch.name}
              onSwitchBranch={onSwitchBranch}
            />
          )
        })}
      </div>
    )
  }

  return mode === 'tree'
    ? (
      <OverlayTree
        className='chat-header-git__branch-tree'
        collapsedKeys={collapsedFolderKeys}
        expandAll={hasSearchQuery}
        nodes={branchTreeNodes}
        onNodeActivate={(node) => {
          if (node.data != null) {
            onSwitchBranch(node.data)
          }
        }}
        onNodeToggle={toggleFolder}
      />
    )
    : [
      { key: 'local', section: renderBranchSection(t('chat.gitBranchesLocal'), availableLocalBranches) },
      { key: 'remote', section: renderBranchSection(t('chat.gitBranchesRemote'), remoteBranches) }
    ]
      .filter(({ section }) => section != null)
      .map(({ key, section }, index) => (
        <Fragment key={key}>
          {index > 0 && (
            <OverlayDivider className='chat-header-git__section-divider' />
          )}
          {section}
        </Fragment>
      ))
}
