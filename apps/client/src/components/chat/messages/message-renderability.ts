import type { ChatMessage, ChatMessageContent } from '@oneworks/core'

import { isBrowserCommentScreenshotName, parseBrowserCommentMessage } from './browser-comment-message'

const isDisplayableText = (text: string) => {
  const parsed = parseBrowserCommentMessage(text)
  return parsed == null
    ? text.trim() !== ''
    : parsed.remainingText !== '' || parsed.comments.length > 0
}

const hasDisplayableArrayBody = (message: ChatMessage) => {
  if (!Array.isArray(message.content)) return false
  if (message.toolCall != null) return true

  return message.content.some(item => {
    if (item.type === 'text') {
      const parsed = parseBrowserCommentMessage(item.text)
      return (parsed == null ? item.text.trim() : parsed.remainingText) !== ''
    }
    if (item.type === 'image') return !isBrowserCommentScreenshotName(item.name)
    return item.type === 'file'
  })
}

export const hasDisplayableMessageItemContent = (message: ChatMessage) => {
  if (typeof message.content === 'string') return isDisplayableText(message.content)
  return hasDisplayableArrayBody(message)
}

export const isChatMessageDisplayable = (message: ChatMessage) => {
  if (typeof message.content === 'string') return isDisplayableText(message.content)
  if (hasDisplayableArrayBody(message)) return true
  if (message.content.some(item => item.type === 'tool_use')) return true

  const browserCommentSource = message.content
    .filter((item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text')
    .map(item => item.text)
    .join('\n\n')
  return (parseBrowserCommentMessage(browserCommentSource)?.comments.length ?? 0) > 0
}
