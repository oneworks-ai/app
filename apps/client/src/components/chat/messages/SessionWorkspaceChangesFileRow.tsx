import { useTranslation } from 'react-i18next'

import type { SessionWorkspaceChangedFile } from '@oneworks/core'

import { getWorkspaceFileIconMeta } from '../workspace-drawer/workspace-drawer-icons'
import { SessionWorkspaceChangesDiffViewer } from './SessionWorkspaceChangesDiffViewer'

const formatSignedCount = (value: number, sign: '+' | '-') => `${sign}${Math.max(0, value)}`

type WorkspaceChangeFileScope = 'mixed' | 'staged' | 'tracked' | 'untracked'

const getFileName = (path: string) => path.split('/').pop() ?? path

const getFileDirectory = (path: string) => {
  const fileName = getFileName(path)
  return path === fileName ? '' : path.slice(0, Math.max(0, path.length - fileName.length - 1))
}

const getFileScope = (file: SessionWorkspaceChangedFile): WorkspaceChangeFileScope => {
  if (file.staged && file.unstaged) return 'mixed'
  if (file.untracked) return 'untracked'
  if (file.staged) return 'staged'
  return 'tracked'
}

const getFileStateLabel = (
  file: SessionWorkspaceChangedFile,
  t: ReturnType<typeof useTranslation>['t']
) => {
  const scope = getFileScope(file)
  const labels = [t(`chat.workspaceDrawerFileStatus.${scope}`)]

  if (file.submodule == null) {
    return labels.join(' · ')
  }

  const submoduleLabels = [
    file.submodule.commitChanged ? t('chat.workspaceDrawerSubmoduleCommit') : null,
    file.submodule.trackedChanges ? t('chat.workspaceDrawerSubmoduleTracked') : null,
    file.submodule.untrackedChanges ? t('chat.workspaceDrawerSubmoduleUntracked') : null
  ].filter((item): item is string => item != null)

  return [
    ...labels,
    ...submoduleLabels.map(label => `${t('chat.workspaceDrawerSubmodule')}: ${label}`)
  ].join(' · ')
}

export function SessionWorkspaceChangesFileRow({
  file,
  isDiffExpanded,
  onToggleDiff
}: {
  file: SessionWorkspaceChangedFile
  isDiffExpanded: boolean
  onToggleDiff: (path: string) => void
}) {
  const { t } = useTranslation()
  const fileName = getFileName(file.path)
  const directory = getFileDirectory(file.path)
  const scope = getFileScope(file)
  const stateLabel = getFileStateLabel(file, t)
  const diffPatch = file.diff?.patch ?? ''
  const icon = file.submodule != null
    ? { icon: 'folder_special', tone: 'submodule' }
    : getWorkspaceFileIconMeta(fileName)

  return (
    <div className='session-workspace-changes-card__file'>
      <button
        type='button'
        className='session-workspace-changes-card__file-row'
        title={file.path}
        aria-expanded={isDiffExpanded}
        aria-label={t(isDiffExpanded ? 'chat.workspaceChanges.hideDiff' : 'chat.workspaceChanges.showDiff', {
          path: file.path
        })}
        onClick={() => onToggleDiff(file.path)}
      >
        <span className={`material-symbols-rounded session-workspace-changes-card__file-icon is-${icon.tone}`}>
          {icon.icon}
        </span>
        <span className='session-workspace-changes-card__path'>
          <span className='session-workspace-changes-card__filename'>{fileName}</span>
          {directory !== '' && (
            <span className='session-workspace-changes-card__directory'>{directory}</span>
          )}
        </span>
        <span
          className={`session-workspace-changes-card__state is-${scope}`}
          title={stateLabel}
          aria-label={stateLabel}
        />
        <span className='session-workspace-changes-card__stats'>
          <span className='session-workspace-changes-card__additions'>
            {formatSignedCount(file.additions, '+')}
          </span>
          <span className='session-workspace-changes-card__deletions'>
            {formatSignedCount(file.deletions, '-')}
          </span>
        </span>
        <span
          className={`material-symbols-rounded session-workspace-changes-card__chevron ${
            isDiffExpanded ? 'is-expanded' : ''
          }`}
          aria-hidden='true'
        >
          expand_more
        </span>
      </button>
      {isDiffExpanded && (
        <div className='session-workspace-changes-card__diff'>
          {diffPatch.trim() === ''
            ? (
              <div className='session-workspace-changes-card__diff-empty'>
                {t('chat.workspaceChanges.diffUnavailable')}
              </div>
            )
            : (
              <SessionWorkspaceChangesDiffViewer path={file.path} patch={diffPatch} />
            )}
          {file.diff?.truncated === true && (
            <div className='session-workspace-changes-card__diff-note'>
              {t('chat.workspaceChanges.diffTruncated')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
