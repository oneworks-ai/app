import type { ChatHistoryTimelineNode } from '#~/components/chat/history-timeline'

export function TimelineRailNodePreview({
  label,
  node
}: {
  label: string
  node: ChatHistoryTimelineNode
}) {
  const forkCount = node.info.graph.forkCount ?? 0
  const kindLabel = node.info.kind === 'question' ? 'Q' : 'A'
  const statusLabel = node.info.status?.state === 'complete'
    ? undefined
    : node.info.status?.label

  return (
    <div className='component-lab-timeline-rail-preview'>
      <div className='component-lab-timeline-rail-preview__meta'>
        <span>{label}</span>
        <span>{kindLabel}</span>
        <span>{node.timestamp}</span>
        <span>{node.info.graph.branchId}</span>
        {forkCount > 0 && <span>{forkCount} forks</span>}
        {statusLabel != null && <span>{statusLabel}</span>}
      </div>
      <strong>{node.title}</strong>
      <p>{node.description}</p>
    </div>
  )
}
