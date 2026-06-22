/* eslint-disable max-lines -- Markdown preview coordinates split layout, links/images, and preview text comments. */
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionWorkspaceResourceUrl, getWorkspaceResourceUrl } from '#~/api'
import { MarkdownContent } from '#~/components/MarkdownContent'
import type { MarkdownImageRenderProps } from '#~/components/MarkdownContent'
import type { PendingFileComment, PendingFileCommentRange } from '#~/components/chat/sender/@types/sender-composer'

import { WorkspaceFileCommentOverlay } from './WorkspaceFileCommentOverlay'
import {
  createPendingWorkspaceFileComment,
  getRangeVisibleRect,
  isSelectionNodeInside,
  normalizeWorkspaceFileSelectedText,
  resolveFloatingAnchor
} from './workspace-file-comments'
import type { WorkspaceFileCommentSelection } from './workspace-file-comments'
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

const readPositiveIntegerAttribute = (element: Element, name: string) => {
  const value = Number(element.getAttribute(name))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const getSourcePositionElement = (node: Node | null, root: HTMLElement) => {
  let element = node instanceof Element ? node : node?.parentElement ?? null
  while (element != null && root.contains(element)) {
    if (element.hasAttribute('data-source-start-line') || element.hasAttribute('data-source-end-line')) {
      return element
    }
    if (element === root) return null
    element = element.parentElement
  }
  return null
}

const getSourcePointFromNode = (
  node: Node | null,
  root: HTMLElement,
  edge: 'end' | 'start'
) => {
  const element = getSourcePositionElement(node, root)
  if (element == null) return undefined
  const line = readPositiveIntegerAttribute(element, `data-source-${edge}-line`)
  if (line == null) return undefined

  return {
    column: readPositiveIntegerAttribute(element, `data-source-${edge}-column`) ?? 1,
    line
  }
}

const getSelectionSourceRange = (
  selection: Selection,
  root: HTMLElement
): PendingFileCommentRange | undefined => {
  if (selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const start = getSourcePointFromNode(range.startContainer, root, 'start')
  const end = getSourcePointFromNode(range.endContainer, root, 'end')
  if (start == null || end == null) return undefined

  const shouldSwap = start.line > end.line || (start.line === end.line && start.column > end.column)
  const normalizedStart = shouldSwap ? end : start
  const normalizedEnd = shouldSwap ? start : end

  return {
    endColumn: normalizedEnd.column,
    endLineNumber: normalizedEnd.line,
    startColumn: normalizedStart.column,
    startLineNumber: normalizedStart.line
  }
}

export function WorkspaceMarkdownPreview({
  content,
  currentPath,
  editor,
  mode,
  onReferenceFileComments,
  onOpenPath,
  sessionId
}: {
  content: string
  currentPath: string
  editor: ReactNode
  mode: WorkspaceMarkdownPreviewMode
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  onOpenPath: (path: string) => void
  sessionId?: string
}) {
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const selectionRangeRef = useRef<Range | null>(null)
  const [editorSizePercent, setEditorSizePercent] = useState(DEFAULT_SPLIT_PERCENT)
  const [isDragging, setIsDragging] = useState(false)
  const [selectionToolbar, setSelectionToolbar] = useState<WorkspaceFileCommentSelection | null>(null)
  const [activeComment, setActiveComment] = useState<
    {
      comment: string
      selection: WorkspaceFileCommentSelection
    } | null
  >(null)
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
  const inferRangeFromSelectedText = useCallback((selectedText: string): PendingFileCommentRange | undefined => {
    const candidates = [
      selectedText,
      normalizeWorkspaceFileSelectedText(selectedText)
    ].filter((item, index, values) => item !== '' && values.indexOf(item) === index)
    const matchedText = candidates.find(candidate => content.includes(candidate))
    if (matchedText == null) return undefined
    const index = content.indexOf(matchedText)
    if (index < 0) return undefined

    const before = content.slice(0, index)
    const selectedBeforeEnd = content.slice(0, index + matchedText.length)
    const startLineNumber = before.split('\n').length
    const endLineNumber = selectedBeforeEnd.split('\n').length
    const startColumn = before.length - before.lastIndexOf('\n')
    const endColumn = selectedBeforeEnd.length - selectedBeforeEnd.lastIndexOf('\n')

    return {
      endColumn,
      endLineNumber,
      startColumn,
      startLineNumber
    }
  }, [content])
  const hideSelectionToolbar = useCallback(() => {
    selectionRangeRef.current = null
    setSelectionToolbar(null)
  }, [])
  const updateSelectionToolbar = useCallback(() => {
    const previewElement = previewRef.current
    const selection = window.getSelection()
    if (
      previewElement == null ||
      onReferenceFileComments == null ||
      activeComment != null ||
      mode === 'editor' ||
      selection == null ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      hideSelectionToolbar()
      return
    }
    if (
      !isSelectionNodeInside(selection.anchorNode, previewElement) ||
      !isSelectionNodeInside(selection.focusNode, previewElement)
    ) {
      hideSelectionToolbar()
      return
    }

    const rawSelectedText = selection.toString()
    const selectedText = normalizeWorkspaceFileSelectedText(rawSelectedText)
    if (selectedText === '') {
      hideSelectionToolbar()
      return
    }

    const selectedRange = selection.getRangeAt(0)
    const rect = getRangeVisibleRect(selectedRange)
    if (rect == null) {
      hideSelectionToolbar()
      return
    }

    selectionRangeRef.current = selectedRange.cloneRange()
    setSelectionToolbar({
      anchor: resolveFloatingAnchor({
        centerLeft: rect.left + rect.width / 2,
        rectBottom: rect.bottom,
        rectTop: rect.top
      }),
      range: getSelectionSourceRange(selection, previewElement) ?? inferRangeFromSelectedText(rawSelectedText),
      selectedText
    })
  }, [activeComment, hideSelectionToolbar, inferRangeFromSelectedText, mode, onReferenceFileComments])
  const clearCommentState = useCallback(() => {
    setActiveComment(null)
    hideSelectionToolbar()
  }, [hideSelectionToolbar])
  const handleStartComment = useCallback(() => {
    if (selectionToolbar == null) return
    const selectionRange = selectionRangeRef.current?.cloneRange() ?? null
    if (selectionRange != null) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(selectionRange)
    }
    setActiveComment({ comment: '', selection: selectionToolbar })
    hideSelectionToolbar()
  }, [hideSelectionToolbar, selectionToolbar])
  const handleConfirmComment = useCallback(() => {
    if (activeComment == null || activeComment.comment.trim() === '') return
    onReferenceFileComments?.([
      createPendingWorkspaceFileComment({
        comment: activeComment.comment,
        isMarkdown: true,
        path: currentPath,
        range: activeComment.selection.range,
        selectedText: activeComment.selection.selectedText,
        sourceLabel: t('chat.fileComments.sourceMarkdownPreview')
      })
    ])
    window.getSelection()?.removeAllRanges()
    clearCommentState()
  }, [activeComment, clearCommentState, currentPath, onReferenceFileComments, t])

  useLayoutEffect(() => {
    if (selectionToolbar == null || activeComment != null) return
    const previewElement = previewRef.current
    const range = selectionRangeRef.current
    if (
      previewElement == null ||
      range == null ||
      !isSelectionNodeInside(range.startContainer, previewElement) ||
      !isSelectionNodeInside(range.endContainer, previewElement)
    ) {
      return
    }

    const selection = window.getSelection()
    if (selection == null) return

    selection.removeAllRanges()
    selection.addRange(range)
  }, [activeComment, selectionToolbar])

  useEffect(() => {
    if (mode === 'editor') {
      clearCommentState()
      return
    }

    let frameId: number | null = null
    const scheduleUpdate = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateSelectionToolbar()
      })
    }
    const hideToolbar = () => {
      if (activeComment == null) hideSelectionToolbar()
    }
    const previewElement = previewRef.current

    document.addEventListener('mouseup', scheduleUpdate)
    document.addEventListener('keyup', scheduleUpdate)
    window.addEventListener('resize', scheduleUpdate)
    previewElement?.addEventListener('mousedown', hideToolbar)
    previewElement?.addEventListener('scroll', hideToolbar, { passive: true })

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId)
      }
      document.removeEventListener('mouseup', scheduleUpdate)
      document.removeEventListener('keyup', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      previewElement?.removeEventListener('mousedown', hideToolbar)
      previewElement?.removeEventListener('scroll', hideToolbar)
    }
  }, [activeComment, clearCommentState, hideSelectionToolbar, mode, updateSelectionToolbar])

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
        <div ref={previewRef} className='workspace-file-editor__markdown-preview' data-dock-panel-no-resize='true'>
          <MarkdownContent
            content={content}
            openLinksInNewTab
            renderImage={renderMarkdownImage}
            onLinkClick={handleMarkdownLinkClick}
          />
        </div>
      )}
      {selectionToolbar != null && activeComment == null && (
        <WorkspaceFileCommentOverlay
          anchor={selectionToolbar.anchor}
          comment=''
          mode='toolbar'
          onAddComment={handleStartComment}
          onCancel={clearCommentState}
          onCommentChange={() => undefined}
          onConfirm={() => undefined}
        />
      )}
      {activeComment != null && (
        <WorkspaceFileCommentOverlay
          anchor={activeComment.selection.anchor}
          comment={activeComment.comment}
          mode='composer'
          onAddComment={() => undefined}
          onCancel={clearCommentState}
          onCommentChange={value =>
            setActiveComment(current => current == null ? current : { ...current, comment: value })}
          onConfirm={handleConfirmComment}
        />
      )}
    </div>
  )
}
