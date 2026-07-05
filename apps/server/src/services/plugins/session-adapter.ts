import { getDb } from '#~/db/index.js'
import { processUserMessage } from '#~/services/session/index.js'
import { resolveSessionWorkspace } from '#~/services/session/workspace.js'

import type { PluginSessionAdapter } from './types.js'

const readTextField = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const listSessionsWithWorkspace = async () => {
  const sessions = getDb().getSessions('active')
  return await Promise.all(sessions.map(async session => {
    if (!isRecord(session)) {
      return session
    }

    const sessionId = readTextField(session.id)
    if (sessionId === '') {
      return session
    }

    const workspace = await resolveSessionWorkspace(sessionId).catch(() => undefined)
    const workspaceFolder = readTextField(workspace?.workspaceFolder)
    if (workspaceFolder === '') {
      return session
    }

    return {
      ...session,
      workspaceFolder
    }
  }))
}

export const createPluginSessionAdapter = (): PluginSessionAdapter => ({
  listSessions: listSessionsWithWorkspace,
  submitMessage: async input => {
    const sessionId = readTextField(input.sessionId)
    const message = readTextField(input.message)
    if (sessionId === '') {
      throw new Error('session_id_required')
    }
    if (message === '') {
      throw new Error('message_required')
    }
    if (getDb().getSession(sessionId) == null) {
      throw new Error('session_not_found')
    }

    await processUserMessage(sessionId, message)
    return {
      accepted: true,
      sessionId
    }
  }
})
