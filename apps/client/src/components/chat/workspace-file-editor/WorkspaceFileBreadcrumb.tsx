/* eslint-disable max-lines -- breadcrumb context menu coordinates service-backed path actions. */
import { App, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { MouseEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import {
  getApiErrorMessage,
  getWorkspacePathActionCapabilities,
  listWorkspaceFileOpeners,
  openSessionWorkspaceFileInExternalOpener,
  openWorkspaceFileInExternalOpener,
  revealSessionWorkspacePathInFileManager,
  revealWorkspacePathInFileManager
} from '#~/api'
import { buildWorkspacePathCopyOptions } from '#~/components/workspace/workspace-path-copy-options'
import { copyTextWithFeedback } from '#~/utils/copy'

interface WorkspaceFileBreadcrumbPart {
  isCurrent: boolean
  name: string
  path: string
}

const renderMenuIcon = (icon: string) => (
  <span className='material-symbols-rounded workspace-file-editor__breadcrumb-menu-icon'>
    {icon}
  </span>
)

const buildBreadcrumbParts = (path: string): WorkspaceFileBreadcrumbPart[] => {
  const names = path.split('/').filter(Boolean)
  return names.map((name, index) => ({
    isCurrent: index === names.length - 1,
    name,
    path: names.slice(0, index + 1).join('/')
  }))
}

export function WorkspaceFileBreadcrumb({
  canOpenInEditor = true,
  onLocatePath,
  path,
  sessionId,
  workspaceRootPath
}: {
  canOpenInEditor?: boolean
  onLocatePath?: (path: string) => void
  path: string
  sessionId?: string
  workspaceRootPath?: string
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [menuTarget, setMenuTarget] = useState<WorkspaceFileBreadcrumbPart | null>(null)
  const { data: pathActionCapabilities } = useSWR(
    'workspace-path-action-capabilities',
    getWorkspacePathActionCapabilities
  )
  const { data: fileOpeners } = useSWR('workspace-file-openers', listWorkspaceFileOpeners)
  const parts = useMemo(() => buildBreadcrumbParts(path), [path])
  const currentPart = parts.at(-1) ?? null
  const activeMenuTarget = menuTarget ?? currentPart
  const defaultFileOpener = useMemo(() => {
    const openers = fileOpeners?.openers ?? []
    return openers.find(opener => opener.available && opener.id === fileOpeners?.defaultOpener) ??
      openers.find(opener => opener.available)
  }, [fileOpeners])
  const fileManager = pathActionCapabilities?.fileManager
  const fileManagerTitle = fileManager == null
    ? t('chat.workspacePathFileManagerFallback')
    : t(`chat.workspacePathFileManager.${fileManager.kind}`, {
      defaultValue: fileManager.title
    })
  const shouldOpenContainingFolder = fileManager?.canRevealFile === false && activeMenuTarget?.isCurrent === true
  const handleRevealInFileManager = useCallback(async (targetPath: string) => {
    if (fileManager?.available !== true) {
      return
    }
    try {
      if (sessionId != null && sessionId !== '') {
        await revealSessionWorkspacePathInFileManager(sessionId, targetPath)
      } else {
        await revealWorkspacePathInFileManager(targetPath)
      }
    } catch (error) {
      void message.error(getApiErrorMessage(
        error,
        t('chat.workspacePathRevealInFileManagerFailed', {
          manager: fileManagerTitle
        })
      ))
    }
  }, [fileManager?.available, fileManagerTitle, message, sessionId, t])
  const handleOpenInExternalEditor = useCallback(async (targetPath: string) => {
    if (defaultFileOpener == null) {
      return
    }
    try {
      if (sessionId != null && sessionId !== '') {
        await openSessionWorkspaceFileInExternalOpener(sessionId, targetPath, { opener: defaultFileOpener.id })
      } else {
        await openWorkspaceFileInExternalOpener(targetPath, { opener: defaultFileOpener.id })
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('chat.workspaceFileExternalOpenFailed')))
    }
  }, [defaultFileOpener, message, sessionId, t])
  const handleContextMenuCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-workspace-breadcrumb-path]')
    const targetPath = node?.dataset.workspaceBreadcrumbPath
    const targetPart = parts.find(part => part.path === targetPath) ?? currentPart
    setMenuTarget(targetPart)
  }, [currentPart, parts])
  const menuItems = useMemo<MenuProps['items']>(() => {
    if (activeMenuTarget == null) {
      return []
    }

    const serviceActionItems: MenuProps['items'] = [
      ...(defaultFileOpener == null ? [] : [{
        key: 'open-editor',
        label: t('chat.workspaceFileOpenInExternalEditor', { opener: defaultFileOpener.title }),
        icon: renderMenuIcon('edit_square'),
        disabled: !activeMenuTarget.isCurrent || !canOpenInEditor,
        onClick: () => {
          void handleOpenInExternalEditor(activeMenuTarget.path)
        }
      }] satisfies MenuProps['items']),
      ...(fileManager?.available === true
        ? [{
          key: 'reveal-finder',
          label: t(
            shouldOpenContainingFolder
              ? 'chat.workspacePathOpenContainingFolderInFileManager'
              : 'chat.workspacePathRevealInFileManager',
            { manager: fileManagerTitle }
          ),
          icon: renderMenuIcon('folder_open'),
          onClick: () => {
            void handleRevealInFileManager(activeMenuTarget.path)
          }
        }] satisfies MenuProps['items']
        : [])
    ]

    return [
      ...buildWorkspacePathCopyOptions({
        name: activeMenuTarget.name,
        path: activeMenuTarget.path,
        t,
        workspaceRootPath
      }).map(option => ({
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
      {
        key: 'locate',
        label: t('chat.workspacePathRevealInTree'),
        icon: renderMenuIcon('account_tree'),
        disabled: onLocatePath == null,
        onClick: () => onLocatePath?.(activeMenuTarget.path)
      },
      ...(serviceActionItems.length > 0 ? [{ type: 'divider' as const }, ...serviceActionItems] : [])
    ]
  }, [
    activeMenuTarget,
    canOpenInEditor,
    defaultFileOpener,
    fileManager?.available,
    fileManagerTitle,
    handleOpenInExternalEditor,
    handleRevealInFileManager,
    message,
    onLocatePath,
    shouldOpenContainingFolder,
    t,
    workspaceRootPath
  ])

  return (
    <Dropdown
      menu={{ items: menuItems }}
      overlayClassName='workspace-file-editor-breadcrumb-dropdown'
      trigger={['contextMenu']}
    >
      <div
        className='workspace-file-editor__breadcrumb'
        title={path}
        data-dock-panel-no-resize='true'
        onContextMenuCapture={handleContextMenuCapture}
      >
        {parts.map((part) => (
          <span key={part.path} className='workspace-file-editor__breadcrumb-part'>
            <button
              type='button'
              className={`workspace-file-editor__breadcrumb-node ${part.isCurrent ? 'is-current' : ''}`}
              aria-label={part.path}
              data-workspace-breadcrumb-path={part.path}
              title={part.path}
            >
              {part.name}
            </button>
            {!part.isCurrent && <span className='workspace-file-editor__breadcrumb-separator'>/</span>}
          </span>
        ))}
      </div>
    </Dropdown>
  )
}
