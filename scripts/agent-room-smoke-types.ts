export interface AgentRoomResumeSmokeOptions {
  json?: boolean
}

export interface AgentRoomResumeSmokeResult {
  ok: true
  tmp: string
  serverPort: number
  mockServerPort: number
  parentSessionId: string
  roomTitle: string
  roomId: string
  taskId: string
  taskTitle: string
  childSessionTitle?: string
  runKey: string
  runTitle?: string
  initialStatus: string
  resumedStatus: string
  roomMessagesBefore: number
  roomMessagesAfter: number
  childMessageTypes: string[]
  hasInitialUserMessage: boolean
  hasRoomUserMessage: boolean
  hasResumeAssistantMessage: boolean
  traceBeforeResume: number
  traceAfterResume: number
  traceDelta: number
  newThreadCount: number
  resumeThreadCount: number
  logPath: string
  logsTail: string[]
}

export interface ApiEnvelope<T> {
  success?: boolean
  data?: T
  error?: {
    message?: string
  }
}

export interface AgentRoomListResponse {
  rooms: Array<{
    id: string
    hostSessionId?: string
    title?: string
  }>
}

export interface AgentRoomRun {
  key: string
  latestSummary?: string
  sessionId: string
  status: string
  title?: string
}

export interface AgentRoomDetailResponse {
  messages: Array<{
    content?: string
    eventType?: string
    type?: string
  }>
  runs: AgentRoomRun[]
}

export interface RoomRunResult {
  detail: AgentRoomDetailResponse
  run: AgentRoomRun
}

export interface SessionMessagesResponse {
  messages: Array<{
    message?: {
      content?: string
      role?: string
    }
    type: string
  }>
}

export interface SessionDetailResponse {
  session?: {
    title?: string
  }
}

export interface SerializedTaskInfo {
  logs?: string[]
  status?: string
  taskId?: string
}

export interface McpClient {
  callTool: (params: { arguments?: Record<string, unknown>; name: string }) => Promise<unknown>
  close: () => Promise<void>
  connect: (transport: unknown) => Promise<void>
}
