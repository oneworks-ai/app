import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

const elementListMinWidth = 220
const elementDetailsMinWidth = 276
const elementSplitterWidth = 5

const getClampedElementColumns = (elementListWidth: number, workspaceWidth: number) => {
  const availableWidth = Math.max(0, workspaceWidth - elementSplitterWidth)
  const maxListWidth = Math.max(elementListMinWidth, availableWidth - elementDetailsMinWidth)
  const nextListWidth = Math.min(maxListWidth, Math.max(elementListMinWidth, Math.round(elementListWidth)))
  return {
    details: Math.max(elementDetailsMinWidth, Math.round(availableWidth - nextListWidth)),
    list: nextListWidth
  }
}

export function useMobileDeviceElementSplitter() {
  const inspectWorkspaceRef = useRef<HTMLDivElement>(null)
  const [elementListColumn, setElementListColumn] = useState<string>()
  const [elementDetailsColumn, setElementDetailsColumn] = useState<string>()

  const setElementListWidth = useCallback((width: number, workspaceWidth: number) => {
    const columns = getClampedElementColumns(width, workspaceWidth)
    setElementListColumn(`${columns.list}px`)
    setElementDetailsColumn(`${columns.details}px`)
  }, [])

  const handleSplitterPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const workspace = inspectWorkspaceRef.current
    const splitter = event.currentTarget
    const elementList = splitter.previousElementSibling
    if (workspace == null || elementList == null) return

    const workspaceWidth = workspace.getBoundingClientRect().width
    const startX = event.clientX
    const startWidth = elementList.getBoundingClientRect().width
    splitter.setPointerCapture(event.pointerId)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setElementListWidth(startWidth + moveEvent.clientX - startX, workspaceWidth)
    }
    const cleanup = () => {
      splitter.removeEventListener('pointermove', handlePointerMove)
      splitter.removeEventListener('pointerup', cleanup)
      splitter.removeEventListener('pointercancel', cleanup)
      if (splitter.hasPointerCapture(event.pointerId)) {
        splitter.releasePointerCapture(event.pointerId)
      }
    }

    splitter.addEventListener('pointermove', handlePointerMove)
    splitter.addEventListener('pointerup', cleanup, { once: true })
    splitter.addEventListener('pointercancel', cleanup, { once: true })
  }, [setElementListWidth])

  const handleSplitterKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const workspace = inspectWorkspaceRef.current
    const elementList = workspace?.querySelector('.chat-interaction-panel-mobile-debug__element-list')
    if (workspace == null || elementList == null) return
    event.preventDefault()
    const delta = event.shiftKey ? 40 : 16
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    setElementListWidth(
      elementList.getBoundingClientRect().width + direction * delta,
      workspace.getBoundingClientRect().width
    )
  }, [setElementListWidth])

  return {
    elementDetailsColumn,
    elementListColumn,
    handleSplitterKeyDown,
    handleSplitterPointerDown,
    inspectWorkspaceRef
  }
}
