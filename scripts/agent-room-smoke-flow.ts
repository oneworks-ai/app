import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { api, parseToolJson, projectHome, waitFor } from './agent-room-smoke-runtime'
import type {
  AgentRoomDetailResponse,
  AgentRoomListResponse,
  McpClient,
  RoomRunResult,
  SerializedTaskInfo,
  SessionDetailResponse,
  SessionMessagesResponse
} from './agent-room-smoke-types'

export const SMOKE_ENTITY_NAME = 'room-smoke-dev'
export const SMOKE_INITIAL_PROMPT = 'Do not use any tool. Reply with exactly ROOM_STARTED_ACK and nothing else.'
export const SMOKE_ROOM_TITLE = 'Agent room title smoke'
export const SMOKE_TASK_TITLE = 'Room smoke dev'

export const assertSmokeResult = (input: {
  childSessionTitle?: string
  hasInitialUserMessage: boolean
  hasResumeAssistantMessage: boolean
  hasRoomUserMessage: boolean
  newThreadCount: number
  resumeThreadCount: number
  roomTitle?: string
  traceAfterResume: number
  traceBeforeResume: number
  runTitle?: string
}) => {
  if (input.roomTitle !== SMOKE_ROOM_TITLE) {
    throw new Error(`Unexpected room title: ${input.roomTitle ?? '<missing>'}`)
  }
  if (input.childSessionTitle !== SMOKE_TASK_TITLE) {
    throw new Error(`Unexpected child session title: ${input.childSessionTitle ?? '<missing>'}`)
  }
  if (input.runTitle !== SMOKE_TASK_TITLE) {
    throw new Error(`Unexpected room run title: ${input.runTitle ?? '<missing>'}`)
  }
  if (!input.hasInitialUserMessage) {
    throw new Error('Child session did not persist the StartTasks initial user message')
  }
  if (!input.hasRoomUserMessage) {
    throw new Error('Child session did not receive room user message')
  }
  if (!input.hasResumeAssistantMessage) {
    throw new Error('Child session did not receive resumed assistant message')
  }
  if (input.traceAfterResume <= input.traceBeforeResume) {
    throw new Error('Mock LLM did not receive a resume request after room message')
  }
  if (input.newThreadCount !== 1 || input.resumeThreadCount < 1) {
    throw new Error(`Unexpected thread log counts: new=${input.newThreadCount}, resume=${input.resumeThreadCount}`)
  }
}

export const createParentSession = async (baseUrl: string) => {
  const parentSessionId = `real-parent-${Date.now()}`
  await api(baseUrl, '/api/sessions', {
    body: JSON.stringify({
      id: parentSessionId,
      start: false,
      title: 'Agent room resume smoke parent',
      workspace: { createWorktree: false }
    }),
    method: 'POST'
  })
  return parentSessionId
}

export const startSmokeTask = async (client: McpClient) => {
  const startResult = await client.callTool({
    name: 'StartTasks',
    arguments: {
      roomTitle: SMOKE_ROOM_TITLE,
      tasks: [{
        adapter: 'codex',
        background: true,
        description: SMOKE_INITIAL_PROMPT,
        model: 'hook-smoke-mock,codex-hooks',
        name: SMOKE_ENTITY_NAME,
        permissionMode: 'bypassPermissions',
        title: SMOKE_TASK_TITLE,
        type: 'entity'
      }]
    }
  })
  const startedTasks = parseToolJson<SerializedTaskInfo[]>(startResult)
  const taskId = startedTasks[0]?.taskId
  if (taskId == null || taskId.trim() === '') {
    throw new Error(`StartTasks did not return a taskId: ${JSON.stringify(startedTasks)}`)
  }
  return taskId
}

export const waitTaskLog = async (client: McpClient, taskId: string, input: {
  label: string
  logLimit: number
  requiredLogs: string[]
}) =>
  await waitFor(
    input.label,
    async () => {
      const infoResult = await client.callTool({
        name: 'GetTaskInfo',
        arguments: { logLimit: input.logLimit, logOrder: 'asc', taskId }
      })
      const info = parseToolJson<SerializedTaskInfo[]>(infoResult)[0]
      const logs = (info?.logs ?? []).join('\n')
      return info?.status === 'completed' && input.requiredLogs.every(log => logs.includes(log))
        ? info
        : undefined
    },
    180_000,
    1000
  )

export const findRoomForParent = async (baseUrl: string, parentSessionId: string) => {
  const roomList = await api<AgentRoomListResponse>(baseUrl, '/api/agent-rooms')
  const room = roomList.rooms.find(item => item.hostSessionId === parentSessionId)
  if (room == null) {
    throw new Error(`No room created for ${parentSessionId}: ${JSON.stringify(roomList)}`)
  }
  return room
}

export const waitRoomRunCompleted = async (baseUrl: string, roomId: string, taskId: string): Promise<RoomRunResult> =>
  await waitFor(
    'room run completed',
    async () => {
      const detail = await api<AgentRoomDetailResponse>(baseUrl, `/api/agent-rooms/${roomId}`)
      const run = detail.runs.find(item => item.sessionId === taskId)
      return run?.status === 'completed' ? { detail, run } : undefined
    },
    60_000,
    500
  )

export const sendRoomResumeMessage = async (baseUrl: string, roomId: string, runKey: string) => {
  await api(baseUrl, `/api/agent-rooms/${roomId}/messages`, {
    body: JSON.stringify({
      content: 'ROOM_RESUME_TRIGGER',
      target: { runKey }
    }),
    method: 'POST'
  })
}

export const waitRoomResumed = async (baseUrl: string, roomId: string, taskId: string) =>
  await waitFor(
    'room resumed completion event',
    async () => {
      const detail = await api<AgentRoomDetailResponse>(baseUrl, `/api/agent-rooms/${roomId}`)
      const run = detail.runs.find(item => item.sessionId === taskId)
      const hasResumed = detail.messages.some(message =>
        message.type === 'run_resumed' ||
        message.eventType === 'run_resumed' ||
        message.content?.includes('ROOM_RESUME_TRIGGER')
      )
      return run?.status === 'completed' && hasResumed && run.latestSummary === 'ROOM_RESUMED_ACK'
        ? detail
        : undefined
    },
    60_000,
    500
  )

export const inspectChildMessages = async (baseUrl: string, taskId: string) => {
  const childMessages = await api<SessionMessagesResponse>(baseUrl, `/api/sessions/${taskId}/messages`)
  const hasMessage = (role: 'assistant' | 'user', content: string) =>
    childMessages.messages.some(event =>
      event.type === 'message' && event.message?.role === role && event.message.content === content
    )
  return {
    childMessageTypes: childMessages.messages.map(event => event.type),
    hasInitialUserMessage: hasMessage('user', SMOKE_INITIAL_PROMPT),
    hasResumeAssistantMessage: hasMessage('assistant', 'ROOM_RESUMED_ACK'),
    hasRoomUserMessage: hasMessage('user', 'ROOM_RESUME_TRIGGER')
  }
}

export const inspectChildSession = async (baseUrl: string, taskId: string) =>
  await api<SessionDetailResponse>(baseUrl, `/api/sessions/${taskId}`)

export const waitCodexResumeLog = async (parentSessionId: string, taskId: string) => {
  const logPath = join(projectHome, 'logs', parentSessionId, `${taskId}.log.md`)
  const logContent = await waitFor(
    'codex resume log',
    async () => {
      const content = await readFile(logPath, 'utf8').catch(() => '')
      return content.includes('[codex session] resuming thread') ? content : undefined
    },
    30_000,
    500
  )
  return { logContent, logPath }
}
