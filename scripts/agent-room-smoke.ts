import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startMockLlmServer } from './adapter-e2e/mock-llm/server'
import type { MockLlmServerHandle } from './adapter-e2e/types'
import {
  SMOKE_TASK_TITLE,
  assertSmokeResult,
  createParentSession,
  findRoomForParent,
  inspectChildMessages,
  inspectChildSession,
  sendRoomResumeMessage,
  startSmokeTask,
  waitCodexResumeLog,
  waitRoomResumed,
  waitRoomRunCompleted,
  waitTaskLog
} from './agent-room-smoke-flow'
import {
  connectMcpClient,
  countIncludes,
  getFreePort,
  startServerProcess,
  terminateProcess,
  waitFor
} from './agent-room-smoke-runtime'
import type { AgentRoomResumeSmokeOptions, AgentRoomResumeSmokeResult, McpClient } from './agent-room-smoke-types'

const startRoomSmokeMock = async () =>
  await startMockLlmServer({
    scenarios: [{
      id: 'codex-hooks',
      title: 'Agent room resume smoke',
      finalOutput: 'ROOM_STARTED_ACK',
      resolveTurn: (context, helpers) => {
        const requestText = helpers.getRequestText(context.body)
        if (helpers.isTitleGenerationRequest(context.body)) {
          return { kind: 'message', text: 'Agent room resume smoke' }
        }
        if (requestText.includes('ROOM_RESUME_TRIGGER')) {
          return { kind: 'message', text: 'ROOM_RESUMED_ACK' }
        }
        return { kind: 'message', text: 'ROOM_STARTED_ACK' }
      }
    }]
  })

const printResult = (result: AgentRoomResumeSmokeResult, options: AgentRoomResumeSmokeOptions) => {
  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log('[agent-room-smoke] resume ok')
  console.log(`roomId=${result.roomId}`)
  console.log(`roomTitle=${result.roomTitle}`)
  console.log(`taskId=${result.taskId}`)
  console.log(`taskTitle=${result.taskTitle}`)
  console.log(`traceDelta=${result.traceDelta}`)
  console.log(`newThreadCount=${result.newThreadCount}`)
  console.log(`resumeThreadCount=${result.resumeThreadCount}`)
  console.log(`log=${result.logPath}`)
}

export async function runAgentRoomResumeSmoke(
  options: AgentRoomResumeSmokeOptions = {}
): Promise<AgentRoomResumeSmokeResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'oneworks-agent-room-resume-smoke-'))
  const serverPort = await getFreePort()
  let client: McpClient | undefined
  let getMcpStderr = () => ''
  let mockServer: MockLlmServerHandle | undefined
  const server = startServerProcess(tmp, serverPort)

  try {
    mockServer = await startRoomSmokeMock()
    const baseUrl = `http://127.0.0.1:${serverPort}`
    await waitFor(
      'server ready',
      async () => (await fetch(`${baseUrl}/api/auth/status`).catch(() => undefined))?.ok,
      30_000,
      250
    )

    const parentSessionId = await createParentSession(baseUrl)
    const mcp = await connectMcpClient({
      mockPort: mockServer.port,
      parentSessionId,
      serverPort
    })
    client = mcp.client
    getMcpStderr = mcp.getStderr

    const taskId = await startSmokeTask(client)
    const taskCompleted = await waitTaskLog(client, taskId, {
      label: 'task completed',
      logLimit: 30,
      requiredLogs: ['ROOM_STARTED_ACK']
    })
    const room = await findRoomForParent(baseUrl, parentSessionId)
    const detailBefore = await waitRoomRunCompleted(baseUrl, room.id, taskId)

    const traceBeforeResume = mockServer.getTrace().length
    await sendRoomResumeMessage(baseUrl, room.id, detailBefore.run.key)
    const resumedTask = await waitTaskLog(client, taskId, {
      label: 'resumed task completed from room message',
      logLimit: 50,
      requiredLogs: ['Resuming inactive task (server sync): ROOM_RESUME_TRIGGER', 'ROOM_RESUMED_ACK']
    })
    const detailAfter = await waitRoomResumed(baseUrl, room.id, taskId)

    const child = await inspectChildMessages(baseUrl, taskId)
    const childSession = await inspectChildSession(baseUrl, taskId)
    const traceAfterResume = mockServer.getTrace().length
    const { logContent, logPath } = await waitCodexResumeLog(parentSessionId, taskId)
    const newThreadCount = countIncludes(logContent, '[codex session] starting new thread')
    const resumeThreadCount = countIncludes(logContent, '[codex session] resuming thread')
    assertSmokeResult({
      ...child,
      childSessionTitle: childSession.session?.title,
      roomTitle: room.title,
      runTitle: detailBefore.run.title,
      traceBeforeResume,
      traceAfterResume,
      newThreadCount,
      resumeThreadCount
    })

    const result: AgentRoomResumeSmokeResult = {
      ok: true,
      tmp,
      serverPort,
      mockServerPort: mockServer.port,
      parentSessionId,
      roomTitle: room.title ?? '',
      roomId: room.id,
      taskId,
      taskTitle: SMOKE_TASK_TITLE,
      childSessionTitle: childSession.session?.title,
      runKey: detailBefore.run.key,
      runTitle: detailBefore.run.title,
      initialStatus: taskCompleted.status ?? 'unknown',
      resumedStatus: resumedTask.status ?? 'unknown',
      roomMessagesBefore: detailBefore.detail.messages.length,
      roomMessagesAfter: detailAfter.messages.length,
      ...child,
      traceBeforeResume,
      traceAfterResume,
      traceDelta: traceAfterResume - traceBeforeResume,
      newThreadCount,
      resumeThreadCount,
      logPath,
      logsTail: resumedTask.logs?.slice(-10) ?? []
    }
    printResult(result, options)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      [
        `Agent room resume smoke failed: ${message}`,
        `tmp=${tmp}`,
        `serverOutput=${server.getOutput().slice(-6000)}`,
        `mcpStderr=${getMcpStderr().slice(-6000)}`
      ].join('\n')
    )
  } finally {
    await client?.close().catch(() => undefined)
    await terminateProcess(server.child).catch(() => undefined)
    await mockServer?.close().catch(() => undefined)
  }
}
