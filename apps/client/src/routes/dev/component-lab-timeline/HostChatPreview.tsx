import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import type { ChatHistoryTimelineNode } from '#~/components/chat/history-timeline'

export interface HostChatPreviewMessage {
  description?: string
  id: string
  isTimelineAnchor?: boolean
  kind: ChatHistoryTimelineNode['info']['kind']
  timelineNodeId?: string
  timestamp: string
  title: string
}

const roleLabelByKind = {
  answer: 'OneWorks',
  question: 'You'
} as const

const avatarLabelByKind = {
  answer: 'OW',
  question: 'Y'
} as const

const programmaticScrollSpySuppressionMs = 2000

export function HostChatPreview({
  children,
  messages,
  onActiveNodeChange,
  onSelectNode,
  scrollSpyNodeIds,
  scrollTargetNodeId,
  selectedNodeId
}: {
  children: ReactNode
  messages: HostChatPreviewMessage[]
  onActiveNodeChange: (nodeId: string) => void
  onSelectNode: (nodeId: string) => void
  scrollSpyNodeIds: Set<string>
  scrollTargetNodeId: string | null
  selectedNodeId: string
}) {
  const rowElementById = useRef(new Map<string, HTMLButtonElement>())
  const rowsElementRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const suppressScrollSpyUntilRef = useRef(0)

  useEffect(() => {
    if (scrollTargetNodeId == null) return

    suppressScrollSpyUntilRef.current = window.performance.now() +
      programmaticScrollSpySuppressionMs

    const rowElement = rowElementById.current.get(scrollTargetNodeId)

    rowElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [scrollTargetNodeId])

  const syncActiveNodeFromScroll = useCallback(() => {
    const rowsElement = rowsElementRef.current

    if (rowsElement == null) return
    if (window.performance.now() < suppressScrollSpyUntilRef.current) return

    const rowsRect = rowsElement.getBoundingClientRect()
    const viewportCenter = rowsRect.top + rowsRect.height / 2
    let closestNodeId: string | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    for (const message of messages) {
      if (message.isTimelineAnchor === false || message.timelineNodeId == null) continue
      if (!scrollSpyNodeIds.has(message.timelineNodeId)) continue

      const rowElement = rowElementById.current.get(message.timelineNodeId)

      if (rowElement == null) continue

      const rowRect = rowElement.getBoundingClientRect()
      const rowCenter = rowRect.top + rowRect.height / 2
      const distance = Math.abs(rowCenter - viewportCenter)

      if (distance < closestDistance) {
        closestDistance = distance
        closestNodeId = message.timelineNodeId
      }
    }

    if (closestNodeId != null && closestNodeId !== selectedNodeId) {
      onActiveNodeChange(closestNodeId)
    }
  }, [messages, onActiveNodeChange, scrollSpyNodeIds, selectedNodeId])

  const handleRowsScroll = useCallback(() => {
    if (scrollFrameRef.current != null) return

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      syncActiveNodeFromScroll()
    })
  }, [syncActiveNodeFromScroll])

  const releaseScrollSpySuppression = useCallback(() => {
    suppressScrollSpyUntilRef.current = 0
  }, [])

  useEffect(() => () => {
    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  return (
    <div className='component-lab-timeline-host' aria-label='Chat history host preview'>
      <header className='component-lab-timeline-host__header'>
        <span>ChatHistoryView host</span>
      </header>
      <div className='component-lab-timeline-host__scroll-area'>
        <div
          ref={rowsElementRef}
          className='component-lab-timeline-host__rows'
          onPointerDown={releaseScrollSpySuppression}
          onScroll={handleRowsScroll}
          onWheel={releaseScrollSpySuppression}
        >
          {messages.map((message, index) => {
            const previousMessage = messages[index - 1]
            const consecutive = previousMessage?.kind === message.kind
            const isTimelineAnchor = message.isTimelineAnchor ?? message.timelineNodeId === message.id
            const selectableNodeId = message.timelineNodeId

            return (
              <button
                key={message.id}
                ref={element => {
                  if (!isTimelineAnchor || selectableNodeId == null) return

                  if (element == null) {
                    rowElementById.current.delete(selectableNodeId)
                    return
                  }

                  rowElementById.current.set(selectableNodeId, element)
                }}
                type='button'
                className={[
                  'component-lab-timeline-host__row',
                  message.kind === 'answer' ? 'is-answer' : 'is-question',
                  consecutive ? 'is-consecutive' : '',
                  isTimelineAnchor && selectedNodeId === selectableNodeId ? 'is-selected' : ''
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  if (selectableNodeId != null) {
                    onSelectNode(selectableNodeId)
                  }
                }}
              >
                <span className='component-lab-timeline-host__avatar' aria-hidden='true'>
                  {avatarLabelByKind[message.kind]}
                </span>
                <span className='component-lab-timeline-host__message-card'>
                  <span className='component-lab-timeline-host__message-meta'>
                    <span>{roleLabelByKind[message.kind]}</span>
                    <span>{message.timestamp}</span>
                  </span>
                  <strong>{message.title}</strong>
                  {message.description != null && (
                    <span className='component-lab-timeline-host__message-preview'>
                      {message.description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        {children}
      </div>
    </div>
  )
}
