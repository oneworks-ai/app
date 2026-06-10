import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionWorkspaceResourceUrl, getWorkspaceResourceUrl } from '#~/api'
import { MarkdownContent } from '#~/components/MarkdownContent'
import type { MarkdownImageRenderProps } from '#~/components/MarkdownContent'

import type { WorkspaceMarkdownPreviewMode } from './workspace-file-editor-language'
import { resolveWorkspaceMarkdownLinkedPath } from './workspace-markdown-links'

const DEFAULT_SPLIT_PERCENT = 50
const MIN_SPLIT_PERCENT = 24
const MAX_SPLIT_PERCENT = 76
const KEYBOARD_SPLIT_STEP = 5

type WorkspaceMarkdownSplitStyle = CSSProperties & {
  '--workspace-file-editor-markdown-editor-size'?: string
}

const clampSplitPercent = (value: number) => Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value))

export function WorkspaceMarkdownPreview({
  content,
  currentPath,
  editor,
  mode,
  onOpenPath,
  sessionId
}: {
  content: string
  currentPath: string
  editor: ReactNode
  mode: WorkspaceMarkdownPreviewMode
  onOpenPath: (path: string) => void
  sessionId?: string
}) {
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [editorSizePercent, setEditorSizePercent] = useState(DEFAULT_SPLIT_PERCENT)
  const [isDragging, setIsDragging] = useState(false)
  const splitStyle = useMemo<WorkspaceMarkdownSplitStyle>(() => ({
    '--workspace-file-editor-markdown-editor-size': `${editorSizePercent}%`
  }), [editorSizePercent])
  const buildWorkspaceResourceUrl = useCallback((resourcePath: string) => {
    return sessionId != null && sessionId !== ''
      ? getSessionWorkspaceResourceUrl(sessionId, resourcePath)
      : getWorkspaceResourceUrl(resourcePath)
  }, [sessionId])
  const handleMarkdownLinkClick = useCallback((href: string, event: MouseEvent<HTMLAnchorElement>) => {
    const linkedPath = resolveWorkspaceMarkdownLinkedPath(currentPath, href)
    if (linkedPath == null) return

    event.preventDefault()
    onOpenPath(linkedPath)
  }, [currentPath, onOpenPath])
  const renderMarkdownImage = useCallback(({ alt, src, title }: MarkdownImageRenderProps) => {
    const linkedPath = resolveWorkspaceMarkdownLinkedPath(currentPath, src)
    const imageSrc = linkedPath == null ? src : buildWorkspaceResourceUrl(linkedPath)
    return (
      <img
        src={imageSrc}
        alt={alt ?? ''}
        title={title}
        loading='lazy'
        decoding='async'
        referrerPolicy='no-referrer'
      />
    )
  }, [buildWorkspaceResourceUrl, currentPath])
  const updateSplitFromPointer = useCallback((clientX: number) => {
    const rect = layoutRef.current?.getBoundingClientRect()
    if (rect == null || rect.width <= 0) return

    setEditorSizePercent(clampSplitPercent(((clientX - rect.left) / rect.width) * 100))
  }, [])
  const handleSplitterPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (mode !== 'split') return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    updateSplitFromPointer(event.clientX)
  }, [mode, updateSplitFromPointer])
  const handleSplitterPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return

    updateSplitFromPointer(event.clientX)
  }, [isDragging, updateSplitFromPointer])
  const handleSplitterPointerRelease = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }, [])
  const handleSplitterKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft'
      ? -KEYBOARD_SPLIT_STEP
      : event.key === 'ArrowRight'
      ? KEYBOARD_SPLIT_STEP
      : 0

    if (delta !== 0) {
      event.preventDefault()
      setEditorSizePercent(value => clampSplitPercent(value + delta))
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setEditorSizePercent(event.key === 'Home' ? MIN_SPLIT_PERCENT : MAX_SPLIT_PERCENT)
    }
  }, [])

  return (
    <div
      ref={layoutRef}
      className={[
        'workspace-file-editor__markdown-layout',
        `workspace-file-editor__markdown-layout--${mode}`,
        isDragging ? 'is-dragging' : ''
      ].join(' ')}
      style={mode === 'split' ? splitStyle : undefined}
    >
      {mode !== 'preview' && (
        <div className='workspace-file-editor__markdown-editor-pane'>
          {editor}
        </div>
      )}
      {mode === 'split' && (
        <div
          className='workspace-file-editor__markdown-splitter'
          data-dock-panel-no-resize='true'
          role='separator'
          aria-label={t('chat.interactionPanel.markdownResizeSplit')}
          aria-orientation='vertical'
          aria-valuemax={MAX_SPLIT_PERCENT}
          aria-valuemin={MIN_SPLIT_PERCENT}
          aria-valuenow={Math.round(editorSizePercent)}
          tabIndex={0}
          onDoubleClick={() => setEditorSizePercent(DEFAULT_SPLIT_PERCENT)}
          onKeyDown={handleSplitterKeyDown}
          onPointerCancel={handleSplitterPointerRelease}
          onPointerDown={handleSplitterPointerDown}
          onPointerMove={handleSplitterPointerMove}
          onPointerUp={handleSplitterPointerRelease}
        >
          <span className='workspace-file-editor__markdown-splitter-line' />
        </div>
      )}
      {mode !== 'editor' && (
        <div className='workspace-file-editor__markdown-preview' data-dock-panel-no-resize='true'>
          <MarkdownContent
            content={content}
            openLinksInNewTab
            renderImage={renderMarkdownImage}
            onLinkClick={handleMarkdownLinkClick}
          />
        </div>
      )}
    </div>
  )
}
