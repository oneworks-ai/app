import type { ChatMessage, ChatMessageContent, Session } from '@oneworks/core'
import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import type { SqliteDb } from '#~/db/index.js'
import { broadcastSessionEvent, notifySessionUpdated } from '#~/services/session/runtime.js'

import { extractTextFromContent, normalizeMessageContent } from './content.js'

const getNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isChatMessageContentArray = (value: unknown): value is ChatMessageContent[] => (
  Array.isArray(value) && value.length > 0
)

const normalizeCommandSource = (source: string) => {
  const normalized = source.trim()
  if (normalized === 'ui' || normalized === 'web' || normalized === 'cli') {
    return 'user'
  }
  return normalized === '' ? 'user' : normalized
}

const getCommandContent = (command: RuntimeCommand) => {
  if (isChatMessageContentArray(command.contentItems)) {
    return structuredClone(command.contentItems)
  }

  return getNonEmptyString(command.content) ?? getNonEmptyString(command.message)
}

const isUserMessageCommand = (command: RuntimeCommand) => (
  command.type === 'start' || command.type === 'send_message'
)

export function projectRuntimeCommand(
  db: SqliteDb,
  command: RuntimeCommand,
  broadcast: boolean
) {
  if (!isUserMessageCommand(command)) {
    return
  }

  const content = getCommandContent(command)
  if (content == null || (typeof content === 'string' && content.trim() === '')) {
    return
  }

  const commandId = command.commandId ?? command.id
  const message: ChatMessage = {
    id: commandId,
    role: 'user',
    content: normalizeMessageContent(content),
    agentRoom: {
      source: normalizeCommandSource(command.source),
      commandId,
      causedByCommandId: command.id
    },
    createdAt: command.ts
  }
  const didSave = db.saveMessage(command.sessionId, { type: 'message', message })
  if (!didSave) {
    return
  }

  const text = extractTextFromContent(content) ?? (typeof content === 'string' ? content : undefined)
  const updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>> = {
    ...(text != null && text.trim() !== ''
      ? {
        lastMessage: text,
        lastUserMessage: text
      }
      : {}),
    status: 'running'
  }
  db.updateSession(command.sessionId, updates)
  if (broadcast) {
    broadcastSessionEvent(command.sessionId, { type: 'message', message })
    const session = db.getSession(command.sessionId)
    if (session != null) {
      notifySessionUpdated(command.sessionId, session)
    }
  }
}
