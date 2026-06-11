import './SessionWorkspaceChangesCard.scss'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import type { SessionWorkspaceChanges } from '@oneworks/core'

import { SessionWorkspaceChangesFileRow } from './SessionWorkspaceChangesFileRow'

const formatSignedCount = (value: number, sign: '+' | '-') => `${sign}${Math.max(0, value)}`

export function SessionWorkspaceChangesCard({
  changes
}: {
  changes: SessionWorkspaceChanges
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [isFileListExpanded, setIsFileListExpanded] = useState(false)
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<Set<string>>(new Set())

  const openChangesReview = () => {
    const params = new URLSearchParams(location.search)
    params.set('layout', 'workspace')
    params.set('workspaceView', 'changes')
    navigate({
      pathname: location.pathname,
      search: params.toString(),
      hash: location.hash
    })
  }

  const toggleFileList = () => {
    setIsFileListExpanded(value => !value)
  }

  const toggleDiff = (path: string) => {
    setExpandedDiffPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <div className='session-workspace-changes-card'>
      <div className='session-workspace-changes-card__header'>
        <div className='session-workspace-changes-card__title'>
          <span>{t('chat.workspaceChanges.summary', { count: changes.summary.changedFiles })}</span>
          <span className='session-workspace-changes-card__additions'>
            {formatSignedCount(changes.summary.additions, '+')}
          </span>
          <span className='session-workspace-changes-card__deletions'>
            {formatSignedCount(changes.summary.deletions, '-')}
          </span>
        </div>
        <div className='session-workspace-changes-card__actions'>
          <button
            type='button'
            className='session-workspace-changes-card__action'
            title={t('chat.workspaceChanges.reviewTitle')}
            aria-label={t('chat.workspaceChanges.reviewTitle')}
            onClick={openChangesReview}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>difference</span>
          </button>
          <button
            type='button'
            className='session-workspace-changes-card__action'
            title={t(
              isFileListExpanded
                ? 'chat.workspaceChanges.collapseFiles'
                : 'chat.workspaceChanges.expandFiles'
            )}
            aria-label={t(
              isFileListExpanded
                ? 'chat.workspaceChanges.collapseFiles'
                : 'chat.workspaceChanges.expandFiles'
            )}
            aria-expanded={isFileListExpanded}
            onClick={toggleFileList}
          >
            <span
              className={`material-symbols-rounded session-workspace-changes-card__chevron ${
                isFileListExpanded ? 'is-expanded' : ''
              }`}
              aria-hidden='true'
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {isFileListExpanded && (
        <div className='session-workspace-changes-card__files'>
          {changes.files.map(file => (
            <SessionWorkspaceChangesFileRow
              key={file.path}
              file={file}
              isDiffExpanded={expandedDiffPaths.has(file.path)}
              onToggleDiff={toggleDiff}
            />
          ))}
        </div>
      )}
    </div>
  )
}
