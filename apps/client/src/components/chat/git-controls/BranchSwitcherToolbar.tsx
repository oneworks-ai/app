import type { KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { OverlaySearchRow, OverlaySegmentedControl } from '#~/components/overlay'

import type { GitBranchDisplayMode } from './git-branch-tree'

export function BranchSwitcherToolbar({
  branchQuery,
  canCreateBranch,
  displayMode,
  onCreateBranch,
  onDisplayModeChange,
  onQueryChange
}: {
  branchQuery: string
  canCreateBranch: boolean
  displayMode: GitBranchDisplayMode
  onCreateBranch: (name: string) => void
  onDisplayModeChange: (mode: GitBranchDisplayMode) => void
  onQueryChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && canCreateBranch) {
      onCreateBranch(branchQuery)
    }
  }

  useEffect(() => {
    searchInputRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <OverlaySearchRow
      autoFocus
      className='chat-header-git__branch-toolbar'
      clearLabel={t('common.clear')}
      inputRef={searchInputRef}
      placeholder={t('chat.gitSearchBranches')}
      value={branchQuery}
      accessory={
        <OverlaySegmentedControl
          ariaLabel={t('chat.gitBranchViewMode')}
          className='chat-header-git__view-switch'
          value={displayMode}
          onChange={onDisplayModeChange}
          options={[
            {
              icon: <span className='material-symbols-rounded'>account_tree</span>,
              label: t('chat.gitBranchViewTree'),
              value: 'tree'
            },
            {
              icon: <span className='material-symbols-rounded'>format_list_bulleted</span>,
              label: t('chat.gitBranchViewFlat'),
              value: 'flat'
            }
          ]}
        />
      }
      onChange={onQueryChange}
      onClear={() => onQueryChange('')}
      onKeyDown={handleSearchKeyDown}
    />
  )
}
