/* eslint-disable max-lines -- workspace file editor view coordinates loading states, tabs, preview modes, and comments. */
import './WorkspaceFileEditorView.scss'

import { App, Empty, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage, getSessionWorkspaceResourceUrl, getWorkspaceResourceUrl } from '#~/api'
import {
  CHAT_BOTTOM_DOCK_DEFAULT_HEIGHT,
  CHAT_BOTTOM_DOCK_HEIGHT_STORAGE_KEY,
  CHAT_BOTTOM_DOCK_MAX_HEIGHT,
  CHAT_BOTTOM_DOCK_MIN_HEIGHT
} from '#~/components/chat/bottom-dock-constants'
import type { PendingFileComment } from '#~/components/chat/sender/@types/sender-composer'
import { DockPanel } from '#~/components/dock-panel/DockPanel'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'

import { WorkspaceFileBreadcrumb } from './WorkspaceFileBreadcrumb'
import { WorkspaceFileCodeEditor } from './WorkspaceFileCodeEditor'
import { WorkspaceFileTabs } from './WorkspaceFileTabs'
import { WorkspaceMarkdownPreview } from './WorkspaceMarkdownPreview'
import { useWorkspaceFileEditorState } from './use-workspace-file-editor-state'
import type { WorkspaceFileCodeCommentDraftState } from './workspace-file-code-comment-controller'
import {
  getWorkspaceFileEditorLanguage,
  isWorkspaceImagePreviewPath,
  isWorkspaceMarkdownPreviewPath
} from './workspace-file-editor-language'
import type { WorkspaceMarkdownPreviewMode } from './workspace-file-editor-language'
import type { WorkspaceFileFocusRequest } from './workspace-file-focus-request'

export function WorkspaceFileEditorView({
  isOpen,
  markdownPreviewMode = 'preview',
  focusRequest,
  onClose,
  onCloseAllPaths,
  onCloseOtherPaths,
  onClosePath,
  onClosePathsToRight,
  onLocatePath,
  onCommentDraftStateChange,
  onReferenceFileComments,
  onReferenceWorkspacePaths,
  onSelectPath,
  openPaths,
  path,
  pendingFileComments,
  sessionId,
  showTabs = true,
  variant = 'dock',
  workspaceRootPath
}: {
  isOpen: boolean
  markdownPreviewMode?: WorkspaceMarkdownPreviewMode
  focusRequest?: WorkspaceFileFocusRequest | null
  onClose: () => void
  onCloseAllPaths: () => void
  onCloseOtherPaths: (path: string) => void
  onClosePath: (path: string) => void
  onClosePathsToRight: (path: string) => void
  onLocatePath?: (path: string) => void
  onCommentDraftStateChange?: (path: string, state: WorkspaceFileCodeCommentDraftState) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  onReferenceWorkspacePaths?: (files: ContextPickerFile[]) => void
  onSelectPath: (path: string) => void
  openPaths: string[]
  path: string
  pendingFileComments?: PendingFileComment[]
  sessionId?: string
  showTabs?: boolean
  variant?: 'content' | 'dock'
  workspaceRootPath?: string
}) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const [commentDraftState, setCommentDraftState] = useState<WorkspaceFileCodeCommentDraftState>({
    hasContent: false,
    hasDraft: false
  })
  const language = useMemo(() => getWorkspaceFileEditorLanguage(path), [path])
  const isImagePreview = useMemo(() => isWorkspaceImagePreviewPath(path), [path])
  const isMarkdownPreview = useMemo(() => isWorkspaceMarkdownPreviewPath(path), [path])
  const activeMarkdownPreviewMode = isMarkdownPreview ? markdownPreviewMode : 'editor'
  const tabPaths = useMemo(() => openPaths.length > 0 ? openPaths : [path], [openPaths, path])
  const imageUrl = useMemo(() => (
    sessionId != null && sessionId !== ''
      ? getSessionWorkspaceResourceUrl(sessionId, path)
      : getWorkspaceResourceUrl(path)
  ), [path, sessionId])
  const handleSaveError = useCallback((err: unknown) => {
    void message.error(getApiErrorMessage(err, t('common.operationFailed')))
  }, [message, t])
  const { data, draft, error, isLoading, saveNow, setDraft } = useWorkspaceFileEditorState({
    enabled: !isImagePreview,
    path,
    sessionId,
    onSaveError: handleSaveError
  })

  useEffect(() => setImageLoadFailed(false), [imageUrl])
  useEffect(() => {
    setCommentDraftState({ hasContent: false, hasDraft: false })
  }, [path])
  useEffect(() => () => {
    onCommentDraftStateChange?.(path, { hasContent: false, hasDraft: false })
  }, [onCommentDraftStateChange, path])

  const handleCommentDraftStateChange = useCallback((state: WorkspaceFileCodeCommentDraftState) => {
    setCommentDraftState(state)
    onCommentDraftStateChange?.(path, state)
  }, [onCommentDraftStateChange, path])

  const runWithCommentDraftGuard = useCallback((action: () => void) => {
    if (!commentDraftState.hasDraft) {
      action()
      return
    }

    modal.confirm({
      title: t('chat.fileComments.discardDraftTitle'),
      content: commentDraftState.hasContent
        ? t('chat.fileComments.discardDraftContent')
        : t('chat.fileComments.discardDraftEmptyContent'),
      okText: t('chat.fileComments.discardDraftOk'),
      cancelText: t('common.cancel'),
      onOk: () => {
        setCommentDraftState({ hasContent: false, hasDraft: false })
        action()
      }
    })
  }, [commentDraftState.hasContent, commentDraftState.hasDraft, modal, t])

  const handleSelectPath = useCallback((nextPath: string) => {
    if (nextPath === path) return
    onSelectPath(nextPath)
  }, [onSelectPath, path])

  const handleCloseAllPaths = useCallback(() => {
    if (tabPaths.includes(path)) {
      runWithCommentDraftGuard(onCloseAllPaths)
      return
    }
    onCloseAllPaths()
  }, [onCloseAllPaths, path, runWithCommentDraftGuard, tabPaths])

  const handleCloseOtherPaths = useCallback((targetPath: string) => {
    if (targetPath !== path) {
      runWithCommentDraftGuard(() => onCloseOtherPaths(targetPath))
      return
    }
    onCloseOtherPaths(targetPath)
  }, [onCloseOtherPaths, path, runWithCommentDraftGuard])

  const handleClosePath = useCallback((targetPath: string) => {
    if (targetPath === path) {
      runWithCommentDraftGuard(() => onClosePath(targetPath))
      return
    }
    onClosePath(targetPath)
  }, [onClosePath, path, runWithCommentDraftGuard])

  const handleClosePathsToRight = useCallback((targetPath: string) => {
    const targetIndex = tabPaths.indexOf(targetPath)
    const activeIndex = tabPaths.indexOf(path)
    if (targetIndex >= 0 && activeIndex > targetIndex) {
      runWithCommentDraftGuard(() => onClosePathsToRight(targetPath))
      return
    }
    onClosePathsToRight(targetPath)
  }, [onClosePathsToRight, path, runWithCommentDraftGuard, tabPaths])

  const editor = data == null
    ? null
    : (
      <WorkspaceFileCodeEditor
        content={draft}
        isMarkdown={isMarkdownPreview}
        language={language}
        focusRequest={focusRequest}
        onCommentDraftStateChange={handleCommentDraftStateChange}
        onReferenceFileComments={onReferenceFileComments}
        pendingFileComments={pendingFileComments}
        path={data.path}
        onChange={setDraft}
        onSave={saveNow}
      />
    )
  const tabs = (
    <WorkspaceFileTabs
      activePath={path}
      paths={tabPaths}
      onCloseAllPaths={handleCloseAllPaths}
      onCloseOtherPaths={handleCloseOtherPaths}
      onClosePath={handleClosePath}
      onClosePathsToRight={handleClosePathsToRight}
      onReferenceFileComments={onReferenceFileComments}
      onReferenceWorkspacePaths={onReferenceWorkspacePaths}
      onSelectPath={handleSelectPath}
      workspaceRootPath={workspaceRootPath}
    />
  )
  const content = (
    <>
      {isImagePreview && (
        <>
          <WorkspaceFileBreadcrumb
            canOpenInEditor={false}
            path={path}
            sessionId={sessionId}
            workspaceRootPath={workspaceRootPath}
            onLocatePath={onLocatePath}
          />
          {imageLoadFailed
            ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.workspaceImagePreviewLoadFailed')} />
            )
            : (
              <div className='workspace-file-editor__image-preview' data-dock-panel-no-resize='true'>
                <img src={imageUrl} alt={path} onError={() => setImageLoadFailed(true)} />
              </div>
            )}
        </>
      )}
      {!isImagePreview && isLoading && (
        <div className='workspace-file-editor__state'>
          <Spin size='small' />
          <span>{t('chat.workspaceFileEditorLoading')}</span>
        </div>
      )}
      {!isImagePreview && !isLoading && error != null && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.workspaceFileEditorLoadFailed')} />
      )}
      {!isImagePreview && !isLoading && error == null && data != null && (
        <>
          <WorkspaceFileBreadcrumb
            canOpenInEditor={!isImagePreview}
            path={data.path}
            sessionId={sessionId}
            workspaceRootPath={workspaceRootPath}
            onLocatePath={onLocatePath}
          />
          {isMarkdownPreview
            ? (
              <WorkspaceMarkdownPreview
                content={draft}
                currentPath={data.path}
                editor={editor}
                mode={activeMarkdownPreviewMode}
                sessionId={sessionId}
                onReferenceFileComments={onReferenceFileComments}
                onOpenPath={handleSelectPath}
              />
            )
            : editor}
        </>
      )}
    </>
  )

  if (variant === 'content') {
    return (
      <div className='workspace-file-editor workspace-file-editor--embedded'>
        {showTabs && (
          <div className='workspace-file-editor__embedded-tabs'>
            {tabs}
          </div>
        )}
        <div className='workspace-file-editor__embedded-body'>
          {content}
        </div>
      </div>
    )
  }

  return (
    <DockPanel
      className='workspace-file-editor'
      allowFullscreen
      defaultHeight={CHAT_BOTTOM_DOCK_DEFAULT_HEIGHT}
      fullscreenEnterLabel={t('common.enterFullscreen')}
      fullscreenExitLabel={t('common.exitFullscreen')}
      isOpen={isOpen}
      maxHeight={CHAT_BOTTOM_DOCK_MAX_HEIGHT}
      minHeight={CHAT_BOTTOM_DOCK_MIN_HEIGHT}
      title={tabs}
      closeLabel={t('common.close')}
      resizeLabel={t('chat.workspaceFileEditorResizePanel')}
      storageKey={CHAT_BOTTOM_DOCK_HEIGHT_STORAGE_KEY}
      onClose={onClose}
    >
      {content}
    </DockPanel>
  )
}
