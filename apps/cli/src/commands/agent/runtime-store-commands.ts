import { existsSync } from 'node:fs'
import process from 'node:process'

import { buildCommand, getStore, trimRequired } from './runtime-store-shared'
import type { AppendRuntimeCommandParams } from './runtime-store-shared'

export const appendRuntimeCommand = async (params: AppendRuntimeCommandParams) => {
  const sessionId = trimRequired(params.sessionId, 'session')
  const store = await getStore(params.cwd, params.env)
  const session = store.session(sessionId)
  if (!existsSync(session.sessionPath)) throw new Error(`Runtime session "${sessionId}" not found.`)

  const content = params.type === 'send_message' || params.type === 'resume'
    ? trimRequired(params.message, 'message')
    : params.message?.trim()
  const requestId = params.type === 'submit_input'
    ? trimRequired(params.requestId, 'request')
    : params.requestId?.trim()
  const submitValue = params.value ?? params.data
  if (params.type === 'submit_input' && submitValue == null) {
    throw new Error('value is required.')
  }
  const value = typeof params.value === 'string' ? params.value.trim() : params.value
  const data = params.data
  const command = await session.appendCommand(buildCommand({
    sessionId,
    type: params.type,
    ts: (params.now ?? Date.now)(),
    content,
    commandId: params.commandId,
    memberKey: params.memberKey,
    priority: params.priority,
    requestId,
    roomId: params.roomId,
    runId: params.runId,
    source: params.source,
    value,
    data
  }))

  return {
    ok: true,
    commandId: command.commandId ?? command.id,
    runtimeCommandId: command.id,
    sessionId,
    storePath: session.sessionPath,
    type: command.type,
    status: 'queued' as const
  }
}

export const readRuntimeCommands = async (
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
) => (await getStore(cwd, env)).session(sessionId).readCommands()
