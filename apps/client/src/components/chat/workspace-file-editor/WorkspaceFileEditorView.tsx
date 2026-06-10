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
import { DockPanel } from '#~/components/dock-panel/DockPanel'

import { WorkspaceFileBreadcrumb } from './WorkspaceFileBreadcrumb'
import { WorkspaceFileCodeEditor } from './WorkspaceFileCodeEditor'
import { WorkspaceFileTabs } from './WorkspaceFileTabs'
import { WorkspaceMarkdownPreview } from './WorkspaceMarkdownPreview'
import { useWorkspaceFileEditorState } from './use-workspace-file-editor-state'
import {
  getWorkspaceFileEditorLanguage,
  isWorkspaceImagePreviewPath,
  isWorkspaceMarkdownPreviewPath
} from './workspace-file-editor-language'
import type { WorkspaceMarkdownPreviewMode } from './workspace-file-editor-language'

export function WorkspaceFileEditorView({
  isOpen,
  markdownPreviewMode = 'preview',
  onClose,
  onCloseAllPaths,
  onCloseOtherPaths,
  onClosePath,
  onClosePathsToRight,
  onLocatePath,
  onSelectPath,
  openPaths,
  path,
  sessionId,
  showTabs = true,
  variant = 'dock',
  workspaceRootPath
}: {
  isOpen: boolean
  markdownPreviewMode?: WorkspaceMarkdownPreviewMode
  onClose: () => void
  onCloseAllPaths: () => void
  onCloseOtherPaths: (path: string) => void
  onClosePath: (path: string) => void
  onClosePathsToRight: (path: string) => void
  onLocatePath?: (path: string) => void
  onSelectPath: (path: string) => void
  openPaths: string[]
  path: string
  sessionId?: string
  showTabs?: boolean
  variant?: 'content' | 'dock'
  workspaceRootPath?: string
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const language = useMemo(() => getWorkspaceFileEditorLanguage(path), [path])
  const isImagePreview = useMemo(() => isWorkspaceImagePreviewPath(path), [path])
  const isMarkdownPreview = useMemo(() => isWorkspaceMarkdownPreviewPath(path), [path])
  const activeMarkdownPreviewMode = isMarkdownPreview ? markdownPreviewMode : 'editor'
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

  const editor = data == null
    ? null
    : (
      <WorkspaceFileCodeEditor
        content={draft}
        language={language}
        path={data.path}
        onChange={setDraft}
        onSave={saveNow}
      />
    )
  const tabs = (
    <WorkspaceFileTabs
      activePath={path}
      paths={openPaths.length > 0 ? openPaths : [path]}
      onCloseAllPaths={onCloseAllPaths}
      onCloseOtherPaths={onCloseOtherPaths}
      onClosePath={onClosePath}
      onClosePathsToRight={onClosePathsToRight}
      onSelectPath={onSelectPath}
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
                onOpenPath={onSelectPath}
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
