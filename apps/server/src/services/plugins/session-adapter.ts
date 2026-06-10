import { getDb } from '#~/db/index.js'
import { processUserMessage } from '#~/services/session/index.js'

import type { PluginSessionAdapter } from './types.js'

const readTextField = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const createPluginSessionAdapter = (): PluginSessionAdapter => ({
  listSessions: () => getDb().getSessions('active'),
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
