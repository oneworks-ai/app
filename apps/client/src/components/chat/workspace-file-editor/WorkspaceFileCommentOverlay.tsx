import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { isImeComposingKeyboardEvent } from '#~/utils/shortcutUtils'

import type { WorkspaceFileCommentOverlayAnchor } from './workspace-file-comments'

export function WorkspaceFileCommentOverlay({
  anchor,
  comment,
  mode,
  onAddComment,
  onCancel,
  onCommentChange,
  onConfirm
}: {
  anchor: WorkspaceFileCommentOverlayAnchor
  comment: string
  mode: 'composer' | 'toolbar'
  onAddComment: () => void
  onCancel: () => void
  onCommentChange: (value: string) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<number | null>(null)
  const canConfirm = comment.trim() !== ''

  const markCompositionStart = () => {
    if (compositionEndTimerRef.current != null) {
      window.clearTimeout(compositionEndTimerRef.current)
      compositionEndTimerRef.current = null
    }
    isComposingRef.current = true
  }

  const markCompositionEnd = () => {
    if (compositionEndTimerRef.current != null) {
      window.clearTimeout(compositionEndTimerRef.current)
    }
    compositionEndTimerRef.current = window.setTimeout(() => {
      isComposingRef.current = false
      compositionEndTimerRef.current = null
    }, 0)
  }

  useEffect(() => {
    if (mode === 'composer') {
      textareaRef.current?.focus()
    }
  }, [mode])

  useEffect(() => () => {
    if (compositionEndTimerRef.current != null) {
      window.clearTimeout(compositionEndTimerRef.current)
    }
  }, [])

  return createPortal(
    <div
      className={[
        'workspace-file-comment-overlay',
        `workspace-file-comment-overlay--${mode}`,
        `is-${anchor.placement}`
      ].join(' ')}
      role={mode === 'toolbar' ? 'toolbar' : 'dialog'}
      aria-label={mode === 'toolbar'
        ? t('chat.fileComments.toolbarAriaLabel')
        : t('chat.fileComments.editorAriaLabel')}
      style={{
        left: anchor.left,
        top: anchor.top
      }}
      onMouseDown={(event) => {
        if (mode === 'toolbar') {
          event.preventDefault()
        }
      }}
    >
      {mode === 'toolbar'
        ? (
          <button
            type='button'
            className='workspace-file-comment-overlay__button'
            onClick={onAddComment}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>add_comment</span>
            <span>{t('chat.fileComments.addComment')}</span>
          </button>
        )
        : (
          <div className='workspace-file-comment-overlay__composer'>
            <textarea
              ref={textareaRef}
              className='workspace-file-comment-overlay__textarea'
              value={comment}
              rows={1}
              placeholder={t('chat.fileComments.placeholder')}
              onChange={event => onCommentChange(event.currentTarget.value)}
              onCompositionEnd={markCompositionEnd}
              onCompositionStart={markCompositionStart}
              onKeyDown={(event) => {
                if (isImeComposingKeyboardEvent(event, isComposingRef.current)) return

                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancel()
                  return
                }

                if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
                  event.preventDefault()
                  if (canConfirm) {
                    onConfirm()
                  }
                }
              }}
            />
            <button
              type='button'
              className='workspace-file-comment-overlay__icon-button'
              aria-label={t('common.cancel')}
              onClick={onCancel}
            >
              <span className='material-symbols-rounded' aria-hidden='true'>close</span>
            </button>
            <button
              type='button'
              className='workspace-file-comment-overlay__submit'
              aria-label={t('chat.fileComments.confirm')}
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              <span className='material-symbols-rounded' aria-hidden='true'>check</span>
            </button>
          </div>
        )}
    </div>,
    document.body
  )
}
