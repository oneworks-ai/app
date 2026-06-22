/* eslint-disable max-lines -- pending reference groups share chip, popover, and preview coordination. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedPopoverPortal } from '#~/components/chat/PinnedPopoverPortal'
import { usePinnedPopover } from '#~/components/chat/usePinnedPopover'

import type {
  PendingAnnotation,
  PendingAnnotationPreviewState,
  PendingTextSelection
} from '../../@types/sender-composer'

const getSelectionPreview = (text: string) => text.replace(/\s+/g, ' ').trim()

const extractEvidenceLineValue = (evidence: string, label: string) => {
  const line = evidence.split('\n').find(item => item.startsWith(label))
  return line?.slice(label.length).trim()
}

const getClassLabelFromSelector = (value?: string) => {
  if (value == null || value === '' || value === 'unavailable') return null
  const classNames = Array.from(value.matchAll(/\.([_a-z][\w-]*)/gi))
    .map(match => match[1])
    .filter((className): className is string => className != null && className !== '')
    .slice(0, 3)
  return classNames.length > 0 ? `.${classNames.join('.')}` : null
}

const getAnnotationTargetPreview = (annotation: PendingAnnotation, fallback: string) => {
  const selectorLabel = getClassLabelFromSelector(extractEvidenceLineValue(annotation.evidence, 'Target selector:'))
  if (selectorLabel != null) return selectorLabel

  const pathLabel = getClassLabelFromSelector(extractEvidenceLineValue(annotation.evidence, 'Target path:'))
  if (pathLabel != null) return pathLabel

  const targetLabel = annotation.targetLabel.trim()
  if (/^[.#]?[-_a-z][\w.-]*$/i.test(targetLabel) && targetLabel.length <= 80) return targetLabel
  return fallback
}

function PendingReferenceGroup({
  children,
  className,
  clearLabel,
  icon,
  label,
  onClear,
  onOpenChange
}: {
  children: ReactNode
  className: string
  clearLabel: string
  icon: string
  label: string
  onClear: () => void
  onOpenChange?: (isOpen: boolean) => void
}) {
  const popover = usePinnedPopover<HTMLDivElement>({ align: 'center' })

  useEffect(() => {
    onOpenChange?.(popover.isOpen)
  }, [onOpenChange, popover.isOpen])

  useEffect(() => () => {
    onOpenChange?.(false)
  }, [onOpenChange])

  return (
    <div
      ref={popover.rootRef}
      className={`pending-reference-group ${className} ${popover.isPinned ? 'is-pinned' : ''}`}
      onPointerEnter={popover.onRootPointerEnter}
      onPointerLeave={popover.onRootPointerLeave}
    >
      <div className='pending-reference-group__chip'>
        <button
          type='button'
          className='pending-reference-group__chip-main'
          aria-expanded={popover.isPinned}
          onClick={popover.togglePinned}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
          <span>{label}</span>
        </button>
        <button
          type='button'
          className='pending-reference-group__clear'
          aria-label={clearLabel}
          onClick={onClear}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>close</span>
        </button>
      </div>
      <PinnedPopoverPortal
        className={`pending-reference-group__popover ${className}__popover`}
        controller={popover}
      >
        {children}
      </PinnedPopoverPortal>
    </div>
  )
}

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

  return (
    <div className='pending-attachments__text-selections'>
      <PendingReferenceGroup
        className='pending-text-selection-group'
        clearLabel={t('chat.textSelections.clearAll')}
        icon='comment'
        label={t('chat.textSelections.count', { count: pendingTextSelections.length })}
        onClear={onClearPendingTextSelections}
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
      </PendingReferenceGroup>
    </div>
  )
}

export function PendingAnnotationGroup({
  pendingAnnotations,
  onRemovePendingAnnotation,
  onClearPendingAnnotations,
  onPreviewStateChange
}: {
  pendingAnnotations: PendingAnnotation[]
  onRemovePendingAnnotation: (id: string) => void
  onClearPendingAnnotations: () => void
  onPreviewStateChange?: (state: PendingAnnotationPreviewState) => void
}) {
  const { t } = useTranslation()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [activePreviewAnnotationId, setActivePreviewAnnotationId] = useState<string | null>(null)

  useEffect(() => {
    if (
      activePreviewAnnotationId != null &&
      !pendingAnnotations.some(annotation => annotation.id === activePreviewAnnotationId)
    ) {
      setActivePreviewAnnotationId(null)
    }
  }, [activePreviewAnnotationId, pendingAnnotations])

  useEffect(() => {
    onPreviewStateChange?.({
      activeAnnotationId: isPreviewOpen ? activePreviewAnnotationId : null,
      isActive: isPreviewOpen
    })
  }, [activePreviewAnnotationId, isPreviewOpen, onPreviewStateChange])

  useEffect(() => () => {
    onPreviewStateChange?.({
      activeAnnotationId: null,
      isActive: false
    })
  }, [onPreviewStateChange])

  return (
    <div className='pending-attachments__annotations'>
      <PendingReferenceGroup
        className='pending-annotation-group'
        clearLabel={t('chat.browserComments.clearAll')}
        icon='chat_bubble'
        label={t('chat.browserComments.count', { count: pendingAnnotations.length })}
        onClear={onClearPendingAnnotations}
        onOpenChange={setIsPreviewOpen}
      >
        {pendingAnnotations.map(annotation => (
          <div
            key={annotation.id}
            className={[
              'pending-annotation-group__row',
              activePreviewAnnotationId === annotation.id ? 'is-active' : ''
            ].filter(Boolean).join(' ')}
            onPointerEnter={() => setActivePreviewAnnotationId(annotation.id)}
            onPointerLeave={() => setActivePreviewAnnotationId(null)}
          >
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
                {getAnnotationTargetPreview(annotation, t('chat.browserComments.targetFallback'))}
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
      </PendingReferenceGroup>
    </div>
  )
}
