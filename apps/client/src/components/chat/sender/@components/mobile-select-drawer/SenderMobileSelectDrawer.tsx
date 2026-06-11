/* eslint-disable max-lines -- shared mobile drawer owns breadcrumbs plus drag-to-close gesture handling. */
import './SenderMobileSelectDrawer.scss'

import { Drawer } from 'antd'
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DRAG_CLOSE_THRESHOLD = 72

interface DrawerDragState {
  pointerId: number
  startY: number
}

export const handleSenderMobileSelectOptionKeyDown = (
  event: KeyboardEvent<HTMLElement>,
  onActivate: () => void
) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  onActivate()
}

export function SenderMobileSelectBreadcrumbs({
  items
}: {
  items: Array<{
    key: string
    label: ReactNode
    onClick?: () => void
  }>
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <nav className='sender-mobile-select-breadcrumbs' aria-label='breadcrumb'>
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        return (
          <span className='sender-mobile-select-breadcrumbs__segment' key={item.key}>
            <button
              type='button'
              className='sender-mobile-select-breadcrumbs__item'
              disabled={isLast || item.onClick == null}
              onClick={item.onClick}
            >
              {item.label}
            </button>
            {!isLast && (
              <span
                className='material-symbols-rounded sender-mobile-select-breadcrumbs__separator'
                aria-hidden='true'
              >
                chevron_right
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function SenderMobileSelectDrawer({
  open,
  title,
  children,
  className,
  onClose
}: {
  open: boolean
  title: ReactNode
  children: ReactNode
  className?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const dragStateRef = useRef<DrawerDragState | null>(null)
  const dragOffsetRef = useRef(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!open) {
      dragStateRef.current = null
      dragOffsetRef.current = 0
      setDragOffset(0)
      setIsDragging(false)
    }
  }, [open])

  const drawerStyle = {
    '--sender-mobile-select-drawer-drag-y': `${dragOffset}px`
  } as CSSProperties

  const updateDragOffset = useCallback((clientY: number) => {
    const dragState = dragStateRef.current
    if (dragState == null) {
      return
    }

    const nextOffset = Math.max(0, clientY - dragState.startY)
    dragOffsetRef.current = nextOffset
    setDragOffset(nextOffset)
  }, [])

  const finishDragAt = useCallback((clientY: number) => {
    const dragState = dragStateRef.current
    if (dragState == null) {
      return
    }

    const finalOffset = Math.max(dragOffsetRef.current, Math.max(0, clientY - dragState.startY))
    dragStateRef.current = null
    setIsDragging(false)

    if (finalOffset >= DRAG_CLOSE_THRESHOLD) {
      setDragOffset(finalOffset)
      onClose()
      return
    }

    dragOffsetRef.current = 0
    setDragOffset(0)
  }, [onClose])

  useEffect(() => {
    if (!isDragging) {
      return undefined
    }

    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState == null || dragState.pointerId !== event.pointerId) {
        return
      }

      updateDragOffset(event.clientY)
    }

    const handleWindowPointerUp = (event: globalThis.PointerEvent) => {
      const dragState = dragStateRef.current
      if (dragState == null || dragState.pointerId !== event.pointerId) {
        return
      }

      finishDragAt(event.clientY)
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      updateDragOffset(event.clientY)
    }

    const handleWindowMouseUp = (event: MouseEvent) => {
      finishDragAt(event.clientY)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [finishDragAt, isDragging, updateDragOffset])

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || event.button !== 0) {
      return
    }

    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea, select, [role="button"]') != null
    ) {
      return
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY
    }
    dragOffsetRef.current = 0
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragOffset(0)
    setIsDragging(true)
  }

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return
    }

    updateDragOffset(event.clientY)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDragAt(event.clientY)
  }

  return (
    <Drawer
      open={open}
      placement='bottom'
      height='auto'
      closable={false}
      rootClassName='sender-mobile-select-drawer-root'
      className={['sender-mobile-select-drawer', className ?? '', isDragging ? 'is-dragging' : ''].filter(Boolean)
        .join(' ')}
      style={drawerStyle}
      onClose={onClose}
    >
      <div className='sender-mobile-select-drawer__sheet'>
        <div
          className='sender-mobile-select-drawer__drag-region'
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <div className='sender-mobile-select-drawer__handle' aria-hidden='true' />
          <div className='sender-mobile-select-drawer__header'>
            <div className='sender-mobile-select-drawer__title'>{title}</div>
            <button
              type='button'
              className='sender-mobile-select-drawer__close'
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <span className='material-symbols-rounded'>close</span>
            </button>
          </div>
        </div>
        <div className='sender-mobile-select-drawer__body'>{children}</div>
      </div>
    </Drawer>
  )
}
