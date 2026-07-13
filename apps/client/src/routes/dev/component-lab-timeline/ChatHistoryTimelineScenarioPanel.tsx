import { useMemo } from 'react'

import { ChatHistoryTimelineView, useChatHistoryTimelineController } from '#~/components/chat/history-timeline'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineRailRenderMode } from '#~/components/chat/history-timeline'

import { HostChatPreview } from './HostChatPreview'
import type { HostChatPreviewMessage } from './HostChatPreview'
import { TimelineRailNodePreview } from './TimelineRailNodePreview'

export interface ChatHistoryTimelineHostMessageInsert {
  beforeNodeId: string
  messages: HostChatPreviewMessage[]
}

const createHostMessageFromTimelineNode = (
  node: ChatHistoryTimelineNode
): HostChatPreviewMessage => ({
  description: node.description,
  id: node.id,
  isTimelineAnchor: true,
  kind: node.info.kind,
  timelineNodeId: node.id,
  timestamp: node.timestamp ?? '',
  title: node.title ?? 'Timeline node'
})

export function ChatHistoryTimelineScenarioPanel({
  hostMessageInserts = [],
  initialNodeId,
  nodes,
  railRenderMode,
  shellClassName,
  title
}: {
  hostMessageInserts?: ChatHistoryTimelineHostMessageInsert[]
  initialNodeId: string
  nodes: ChatHistoryTimelineNode[]
  railRenderMode: ChatHistoryTimelineRailRenderMode
  shellClassName?: string
  title: string
}) {
  const timeline = useChatHistoryTimelineController({ initialNodeId, nodes })
  const hostMessages = useMemo(() => {
    const insertsByNodeId = new Map(
      hostMessageInserts.map(insert => [insert.beforeNodeId, insert.messages])
    )

    return timeline.activePathNodes.flatMap(node => [
      ...(insertsByNodeId.get(node.id) ?? []),
      createHostMessageFromTimelineNode(node)
    ])
  }, [hostMessageInserts, timeline.activePathNodes])

  return (
    <section className='component-lab-timeline__scenario' aria-label={title}>
      <h3 className='component-lab-timeline__scenario-title'>{title}</h3>
      <section className={['component-lab-timeline-shell', shellClassName].filter(Boolean).join(' ')}>
        <HostChatPreview
          messages={hostMessages}
          onActiveNodeChange={timeline.setActiveNodeFromScroll}
          onSelectNode={timeline.selectNode}
          scrollSpyNodeIds={timeline.scrollSpyNodeIds}
          scrollTargetNodeId={timeline.scrollTargetNodeId}
          selectedNodeId={timeline.selectedNodeId}
        >
          <ChatHistoryTimelineView
            graphExpanded={timeline.graphExpanded}
            onGraphExpandedChange={timeline.setGraphExpanded}
            nodes={nodes}
            railRenderMode={railRenderMode}
            activeNodeIds={timeline.activeNodeIds}
            pathNodes={timeline.activePathNodes}
            selectedNodeId={timeline.selectedNodeId}
            getNodePreview={railRenderMode === 'node'
              ? ({ label, node }) => (
                <TimelineRailNodePreview label={label} node={node} />
              )
              : undefined}
            onSelectNode={timeline.selectTimelineNode}
          />
        </HostChatPreview>
      </section>
    </section>
  )
}
