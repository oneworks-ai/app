export interface ChatHistoryTimelineVisibilityOptions {
  containerWidth?: number
  embeddedSessionChrome: boolean
  hideHistoryTimeline: boolean
  isAgentRoomMode: boolean
  isCompactLayout: boolean
  nodeCount: number
  shouldShowMessages: boolean
}

export const CHAT_HISTORY_TIMELINE_MIN_CONTAINER_WIDTH = 820

export const shouldShowChatHistoryTimeline = ({
  containerWidth,
  embeddedSessionChrome,
  hideHistoryTimeline,
  isAgentRoomMode,
  isCompactLayout,
  nodeCount,
  shouldShowMessages
}: ChatHistoryTimelineVisibilityOptions) =>
  containerWidth != null &&
  containerWidth > CHAT_HISTORY_TIMELINE_MIN_CONTAINER_WIDTH &&
  !embeddedSessionChrome &&
  !isAgentRoomMode &&
  !isCompactLayout &&
  !hideHistoryTimeline &&
  shouldShowMessages &&
  nodeCount > 0
