import { useTranslation } from 'react-i18next'

import { PinnedPopoverPortal } from '#~/components/chat/PinnedPopoverPortal'
import { usePinnedPopover } from '#~/components/chat/usePinnedPopover'

import type { PendingAnnotation, PendingTextSelection } from '../../@types/sender-composer'

const getSelectionPreview = (text: string) => text.replace(/\s+/g, ' ').trim()

export function PendingTextSelectionGroup({
  pendingTextSelections,
  onRemovePendingTextSelection,
  onClearPendingTextSelections
}: {
  pendingTextSelections: PendingTextSelection[]
  onRemovePendingTextSelection: (id: string) => void
  onClearPendingTextSelections: () => void
}) {
  const { t } = useTranslation()
  const popover = usePinnedPopover<HTMLDivElement>({ matchWidthSelector: '.chat-input-composer' })

  return (
    <div className='pending-attachments__text-selections'>
      <div
        ref={popover.rootRef}
        className={`pending-text-selection-group ${popover.isPinned ? 'is-pinned' : ''}`}
        onPointerEnter={popover.onRootPointerEnter}
        onPointerLeave={popover.onRootPointerLeave}
      >
        <div className='pending-text-selection-group__chip'>
          <button
            type='button'
            className='pending-text-selection-group__chip-main'
            aria-expanded={popover.isPinned}
            onClick={popover.togglePinned}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>comment</span>
            <span>{t('chat.textSelections.count', { count: pendingTextSelections.length })}</span>
          </button>
          <button
            type='button'
            className='pending-text-selection-group__clear'
            aria-label={t('chat.textSelections.clearAll')}
            onClick={onClearPendingTextSelections}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>close</span>
          </button>
        </div>
        <PinnedPopoverPortal
          className='pending-text-selection-group__popover'
          controller={popover}
        >
          {pendingTextSelections.map(selection => (
            <div key={selection.id} className='pending-text-selection-group__row'>
              <div className='pending-text-selection-group__content'>
                <div className='pending-text-selection-group__text'>{getSelectionPreview(selection.text)}</div>
              </div>
              <button
                type='button'
                className='pending-text-selection-group__remove'
                aria-label={t('common.remove')}
                onClick={() => onRemovePendingTextSelection(selection.id)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>close</span>
              </button>
            </div>
          ))}
        </PinnedPopoverPortal>
      </div>
    </div>
  )
}

export function PendingAnnotationGroup({
  pendingAnnotations,
  onRemovePendingAnnotation
}: {
  pendingAnnotations: PendingAnnotation[]
  onRemovePendingAnnotation: (id: string) => void
}) {
  const { t } = useTranslation()
  const popover = usePinnedPopover<HTMLDivElement>({ matchWidthSelector: '.chat-input-composer' })

  return (
    <div className='pending-attachments__annotations'>
      <div
        ref={popover.rootRef}
        className={`pending-annotation-group ${popover.isPinned ? 'is-pinned' : ''}`}
        onPointerEnter={popover.onRootPointerEnter}
        onPointerLeave={popover.onRootPointerLeave}
      >
        <button
          type='button'
          className='pending-annotation-group__chip'
          aria-expanded={popover.isPinned}
          onClick={popover.togglePinned}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>chat_bubble</span>
          <span>{t('chat.browserComments.count', { count: pendingAnnotations.length })}</span>
        </button>
        <PinnedPopoverPortal
          className='pending-annotation-group__popover'
          controller={popover}
        >
          {pendingAnnotations.map(annotation => (
            <div key={annotation.id} className='pending-annotation-group__row'>
              <div className='pending-annotation-group__preview' aria-hidden='true'>
                {annotation.screenshotDataUrl != null
                  ? (
                    <img src={annotation.screenshotDataUrl} alt='' loading='lazy' />
                  )
                  : (
                    <span className='material-symbols-rounded'>web_asset</span>
                  )}
              </div>
              <div className='pending-annotation-group__body'>
                <div className='pending-annotation-group__target'>
                  {annotation.targetLabel || t('chat.browserComments.targetFallback')}
                </div>
                <div className='pending-annotation-group__comment'>{annotation.comment}</div>
              </div>
              <button
                type='button'
                className='pending-annotation-group__remove'
                aria-label={t('common.remove')}
                onClick={() => onRemovePendingAnnotation(annotation.id)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>close</span>
              </button>
            </div>
          ))}
        </PinnedPopoverPortal>
      </div>
    </div>
  )
}
