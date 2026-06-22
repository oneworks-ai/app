import { App, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { PendingFileComment } from '#~/components/chat/sender/@types/sender-composer'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import {
  buildWorkspacePathCopyOptions,
  getWorkspacePathName
} from '#~/components/workspace/workspace-path-copy-options'
import { copyTextWithFeedback } from '#~/utils/copy'

import { getWorkspaceFileIconMeta } from '../workspace-drawer/workspace-drawer-icons'
import { createPendingWorkspaceFileComment } from './workspace-file-comments'
import { isWorkspaceMarkdownPreviewPath } from './workspace-file-editor-language'

const renderMenuIcon = (icon: string) =>
  <span className='material-symbols-rounded workspace-file-editor__menu-icon'>{icon}</span>

export function WorkspaceFileTabs({
  activePath,
  onCloseAllPaths,
  onCloseOtherPaths,
  onClosePath,
  onClosePathsToRight,
  onReferenceFileComments,
  onReferenceWorkspacePaths,
  onSelectPath,
  paths,
  workspaceRootPath
}: {
  activePath: string
  onCloseAllPaths: () => void
  onCloseOtherPaths: (path: string) => void
  onClosePath: (path: string) => void
  onClosePathsToRight: (path: string) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  onReferenceWorkspacePaths?: (files: ContextPickerFile[]) => void
  onSelectPath: (path: string) => void
  paths: string[]
  workspaceRootPath?: string
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const activeTabRef = useRef<HTMLSpanElement | null>(null)
  const getMenuItems = useMemo(() => (path: string, index: number): MenuProps['items'] => [
    ...buildWorkspacePathCopyOptions({ path, t, workspaceRootPath }).map(option => ({
      key: option.key,
      label: option.label,
      icon: renderMenuIcon('content_copy'),
      disabled: option.disabled,
      onClick: () => {
        if (option.disabled === true) return
        void copyTextWithFeedback({
          failureMessage: t('common.copyFailed'),
          messageApi: message,
          successMessage: option.successMessage,
          text: option.text
        })
      }
    })),
    { type: 'divider' as const },
    {
      key: 'reference-file',
      label: t('chat.workspaceFileReferenceFile'),
      icon: renderMenuIcon('attach_file'),
      disabled: onReferenceWorkspacePaths == null,
      onClick: () => {
        onReferenceWorkspacePaths?.([{ path, name: getWorkspacePathName(path) }])
      }
    },
    {
      key: 'comment-file',
      label: t('chat.workspaceFileCommentFile'),
      icon: renderMenuIcon('edit_note'),
      disabled: onReferenceFileComments == null,
      onClick: () => {
        onReferenceFileComments?.([
          createPendingWorkspaceFileComment({
            comment: '',
            isMarkdown: isWorkspaceMarkdownPreviewPath(path),
            path,
            selectedText: '',
            sourceLabel: t('chat.fileComments.sourceEditor'),
            targetLabel: t('chat.fileComments.wholeFile')
          })
        ])
      }
    },
    { type: 'divider' as const },
    {
      key: 'close',
      label: t('common.close'),
      icon: renderMenuIcon('close'),
      onClick: () => onClosePath(path)
    },
    {
      key: 'close-others',
      label: t('chat.workspaceFileCloseOthers'),
      icon: renderMenuIcon('tab_close_right'),
      disabled: paths.length <= 1,
      onClick: () => onCloseOtherPaths(path)
    },
    {
      key: 'close-right',
      label: t('chat.workspaceFileCloseRight'),
      icon: renderMenuIcon('low_priority'),
      disabled: index >= paths.length - 1,
      onClick: () => onClosePathsToRight(path)
    },
    {
      key: 'close-all',
      label: t('chat.workspaceFileCloseAll'),
      icon: renderMenuIcon('cancel_presentation'),
      onClick: onCloseAllPaths
    }
  ], [
    message,
    onCloseAllPaths,
    onCloseOtherPaths,
    onClosePath,
    onClosePathsToRight,
    onReferenceFileComments,
    onReferenceWorkspacePaths,
    paths.length,
    t,
    workspaceRootPath
  ])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activePath])

  return (
    <div className='workspace-file-editor__tabs' data-dock-panel-no-resize='true'>
      {paths.map((path, index) => {
        const fileName = getWorkspacePathName(path)
        const icon = getWorkspaceFileIconMeta(fileName)
        return (
          <Dropdown
            key={path}
            menu={{ items: getMenuItems(path, index) }}
            overlayClassName='workspace-file-editor-context-dropdown'
            trigger={['contextMenu']}
          >
            <span
              ref={activePath === path ? activeTabRef : undefined}
              className={`workspace-file-editor__tab ${activePath === path ? 'is-active' : ''}`}
              title={path}
            >
              <span className='workspace-file-editor__tab-leading'>
                <span className={`material-symbols-rounded workspace-file-editor__tab-icon is-${icon.tone}`}>
                  {icon.icon}
                </span>
                <button
                  type='button'
                  className='workspace-file-editor__tab-close'
                  aria-label={`${t('common.close')} ${fileName}`}
                  title={`${t('common.close')} ${fileName}`}
                  onClick={() => {
                    onClosePath(path)
                  }}
                >
                  <span className='material-symbols-rounded'>close</span>
                </button>
              </span>
              <button type='button' className='workspace-file-editor__tab-main' onClick={() => onSelectPath(path)}>
                <span className='workspace-file-editor__tab-name'>{fileName}</span>
              </button>
            </span>
          </Dropdown>
        )
      })}
    </div>
  )
}
