import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ChatHistoryTimelineRailEntry } from '#~/components/chat/history-timeline/ChatHistoryTimelineRailEntry'
import type { TimelineRailMarkerEntry } from '#~/components/chat/history-timeline/rail-collapse'
import { shouldShowChatHistoryTimeline } from '#~/components/chat/history-timeline/timeline-visibility'
import type { ChatHistoryTimelineNode } from '#~/components/chat/history-timeline/types'

const forkNode: ChatHistoryTimelineNode = {
  id: 'fork-node',
  info: {
    graph: {
      branchId: 'main',
      childIds: ['child-a', 'child-b'],
      depth: 0,
      forkCount: 2,
      isOnActivePath: true,
      lane: 0,
      siblingCount: 1,
      siblingIndex: 0
    },
    kind: 'question'
  },
  messageId: 'message-fork',
  timestamp: '10:00',
  title: 'Fork event'
}

const forkEntry: TimelineRailMarkerEntry = {
  index: 0,
  kind: 'marker',
  label: 'Q1',
  node: forkNode
}

const renderEntry = (
  renderMode: 'event-line' | 'node',
  forkDisclosure?: { controlsId: string; expanded: boolean }
) =>
  renderToStaticMarkup(
    <ChatHistoryTimelineRailEntry
      entry={forkEntry}
      forkDisclosure={forkDisclosure}
      onExpandFork={() => {}}
      onSelectNode={() => {}}
      registerMarkerElement={() => () => {}}
      renderMode={renderMode}
      selectedNodeId={forkNode.id}
    />
  )

describe('chat history timeline rail render modes', () => {
  it('renders the dense event line and fork marker in event-line mode', () => {
    const html = renderEntry('event-line', { controlsId: 'branch-graph', expanded: false })

    expect(html).toContain('chat-history-timeline-rail__event-line')
    expect(html).toContain('has-fork')
    expect(html).toContain('aria-controls="branch-graph"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-keyshortcuts="Shift+Enter"')
    expect(html).not.toContain('chat-history-timeline-rail__marker-dot')
  })

  it('preserves the original dot and fork count in node mode', () => {
    const html = renderEntry('node')

    expect(html).toContain('chat-history-timeline-rail__marker-dot')
    expect(html).toContain('chat-history-timeline-rail__fork-count')
    expect(html).not.toContain('chat-history-timeline-rail__event-line')
  })
})

describe('chat history event-line visibility', () => {
  const visibleOptions = {
    containerWidth: 821,
    embeddedSessionChrome: false,
    hideHistoryTimeline: false,
    isAgentRoomMode: false,
    isCompactLayout: false,
    nodeCount: 1,
    shouldShowMessages: true
  }

  it('keeps the rail visible for short desktop conversations', () => {
    expect(shouldShowChatHistoryTimeline(visibleOptions)).toBe(true)
  })

  it.each([
    ['embedded session', { embeddedSessionChrome: true }],
    ['agent room', { isAgentRoomMode: true }],
    ['compact layout', { isCompactLayout: true }],
    ['explicitly hidden rail', { hideHistoryTimeline: true }],
    ['820px container', { containerWidth: 820 }],
    ['empty history', { nodeCount: 0 }],
    ['hidden messages', { shouldShowMessages: false }]
  ])('keeps the existing %s exception', (_label, override) => {
    expect(shouldShowChatHistoryTimeline({ ...visibleOptions, ...override })).toBe(false)
  })
})
