import { useCallback, useEffect, useRef } from 'react'

const syncElementRef = (
  elementsById: Map<string, HTMLButtonElement>,
  nodeId: string,
  element: HTMLButtonElement | null
) => {
  if (element == null) {
    elementsById.delete(nodeId)
    return
  }

  elementsById.set(nodeId, element)
}

export function useSelectedTimelineGraphScroll(selectedNodeId?: string) {
  const bodyElementRef = useRef<HTMLDivElement | null>(null)
  const itemElementById = useRef(new Map<string, HTMLButtonElement>())
  const nodeElementById = useRef(new Map<string, HTMLButtonElement>())

  const registerItemElement = useCallback(
    (nodeId: string, element: HTMLButtonElement | null) => {
      syncElementRef(itemElementById.current, nodeId, element)
    },
    []
  )
  const registerNodeElement = useCallback(
    (nodeId: string, element: HTMLButtonElement | null) => {
      syncElementRef(nodeElementById.current, nodeId, element)
    },
    []
  )

  useEffect(() => {
    if (selectedNodeId == null) return

    const bodyElement = bodyElementRef.current
    const selectedElement = itemElementById.current.get(selectedNodeId) ??
      nodeElementById.current.get(selectedNodeId)

    if (bodyElement == null || selectedElement == null) return

    const bodyRect = bodyElement.getBoundingClientRect()
    const selectedRect = selectedElement.getBoundingClientRect()
    const nextScrollTop = bodyElement.scrollTop +
      selectedRect.top +
      selectedRect.height / 2 -
      (bodyRect.top + bodyRect.height / 2)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    bodyElement.scrollTo({
      top: Math.max(0, nextScrollTop),
      behavior: reduceMotion ? 'auto' : 'smooth'
    })
  }, [selectedNodeId])

  return {
    bodyElementRef,
    registerItemElement,
    registerNodeElement
  }
}
