export type ChatHistoryTimelineNodeKind = 'answer' | 'question'

export type ChatHistoryTimelineNodeStatus =
  | 'ask-user'
  | 'complete'
  | 'error'
  | 'permission'
  | 'running'
  | 'waiting'

export interface ChatHistoryTimelineNodeGraph {
  activeChildId?: string
  branchId: string
  childIds: string[]
  depth: number
  forkCount?: number
  isOnActivePath: boolean
  lane: number
  parentId?: string
  siblingCount: number
  siblingIndex: number
}

export interface ChatHistoryTimelineNodeMarks {
  pinned?: boolean
  starred?: boolean
}

export interface ChatHistoryTimelineNodeRail {
  marker?: boolean
}

export interface ChatHistoryTimelineNodeInfo {
  graph: ChatHistoryTimelineNodeGraph
  kind: ChatHistoryTimelineNodeKind
  marks?: ChatHistoryTimelineNodeMarks
  rail?: ChatHistoryTimelineNodeRail
  status?: {
    label?: string
    state: ChatHistoryTimelineNodeStatus
  }
}

export interface ChatHistoryTimelineNode {
  /**
   * Timeline nodes are curated conversation anchors rather than raw runtime events.
   * For normal AI turns, keep only the final visible assistant message here.
   */
  description?: string
  id: string
  info: ChatHistoryTimelineNodeInfo
  label?: string
  messageId: string
  timestamp?: string
  title?: string
}

export interface ChatHistoryTimelineSelectDetail {
  node: ChatHistoryTimelineNode
  source: 'graph' | 'rail'
}

export type ChatHistoryTimelineSelectHandler = (
  nodeId: string,
  detail: ChatHistoryTimelineSelectDetail
) => void
