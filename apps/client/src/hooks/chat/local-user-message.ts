import type { ChatMessage, ChatMessageContent } from '@oneworks/core'

import { OPTIMISTIC_USER_MESSAGE_ID_SUFFIX } from './optimistic-session-creation'

export const LOCAL_USER_MESSAGE_ID_PREFIX = 'local-user-message:'
const LOCAL_USER_MESSAGE_MATCH_LOOKBACK_MS = 60_000
type StagedLocalUserMessageListener = (message: ChatMessage) => void
const stagedLocalUserMessages = new Map<string, ChatMessage[]>()
const stagedLocalUserMessageListeners = new Map<string, Set<StagedLocalUserMessageListener>>()

export const createLocalUserMessageId = () => {
  const id = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${LOCAL_USER_MESSAGE_ID_PREFIX}${id}`
}

export const stageLocalUserMessage = (sessionId: string, message: ChatMessage) => {
  const stagedMessages = stagedLocalUserMessages.get(sessionId) ?? []
  stagedLocalUserMessages.set(sessionId, [...stagedMessages, message])

  const listeners = stagedLocalUserMessageListeners.get(sessionId)
  if (listeners == null) return

  for (const listener of listeners) {
    listener(message)
  }
}

export const consumeStagedLocalUserMessages = (sessionId: string) => {
  const messages = stagedLocalUserMessages.get(sessionId) ?? []
  stagedLocalUserMessages.delete(sessionId)
  return messages
}

export const subscribeStagedLocalUserMessages = (
  sessionId: string,
  listener: StagedLocalUserMessageListener
) => {
  const listeners = stagedLocalUserMessageListeners.get(sessionId) ?? new Set<StagedLocalUserMessageListener>()
  listeners.add(listener)
  stagedLocalUserMessageListeners.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stagedLocalUserMessageListeners.delete(sessionId)
    }
  }
}

const isLocalUserMessage = (message: ChatMessage) => (
  message.role === 'user' &&
  (message.id.startsWith(LOCAL_USER_MESSAGE_ID_PREFIX) || message.id.endsWith(OPTIMISTIC_USER_MESSAGE_ID_SUFFIX))
)

const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ')

const getComparableContent = (content: ChatMessage['content']) => {
  if (typeof content === 'string') {
    return normalizeComparableText(content)
  }

  return normalizeComparableText(
    content
      .filter((item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text')
      .map(item => item.text)
      .join('\n')
  )
}

const isSameUserMessageContent = (left: ChatMessage, right: ChatMessage) => (
  left.role === 'user' &&
  right.role === 'user' &&
  getComparableContent(left.content) !== '' &&
  getComparableContent(left.content) === getComparableContent(right.content)
)

const isProjectedLocalUserMessage = (localMessage: ChatMessage, realMessage: ChatMessage) => (
  isSameUserMessageContent(localMessage, realMessage) &&
  realMessage.createdAt >= localMessage.createdAt - LOCAL_USER_MESSAGE_MATCH_LOOKBACK_MS
)

export const reconcileLocalUserMessages = (
  nextMessages: ChatMessage[],
  previousMessages: ChatMessage[]
) => {
  const nextRealMessages = nextMessages.filter(message => !isLocalUserMessage(message))
  const hasMatchingRealMessage = (message: ChatMessage) =>
    nextRealMessages.some(candidate => isProjectedLocalUserMessage(message, candidate))
  const cleanedNextMessages = nextMessages.filter(message =>
    !isLocalUserMessage(message) || !hasMatchingRealMessage(message)
  )
  const knownIds = new Set(cleanedNextMessages.map(message => message.id))
  const preservedLocalMessages = previousMessages.filter(message =>
    isLocalUserMessage(message) &&
    !knownIds.has(message.id) &&
    !hasMatchingRealMessage(message)
  )

  if (preservedLocalMessages.length === 0) {
    return cleanedNextMessages
  }

  return [...cleanedNextMessages, ...preservedLocalMessages]
    .sort((left, right) => left.createdAt - right.createdAt)
}
