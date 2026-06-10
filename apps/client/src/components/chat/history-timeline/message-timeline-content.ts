import type { ChatMessageContent } from '@oneworks/core'

import type { MessageRenderItem } from '../messages/message-render-types'

const maxTitleLength = 88
const maxDescriptionLength = 220

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

const normalizeInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const normalizeDescriptionText = (value: string) =>
  value
    .split(/\r?\n/)
    .map(line => normalizeInlineText(line))
    .filter(Boolean)
    .slice(0, 3)
    .join('\n')

const contentPartToText = (part: ChatMessageContent) => {
  if (part.type === 'text') return part.text
  if (part.type === 'image') return part.name ?? 'Image'
  if (part.type === 'file') return part.name ?? part.path
  return ''
}

const messageContentToText = (content: string | ChatMessageContent[]) => {
  if (typeof content === 'string') return content

  return content
    .map(contentPartToText)
    .filter(Boolean)
    .join('\n')
}

export const createTimelineTitle = (item: MessageRenderItem) => {
  const normalizedText = normalizeDescriptionText(messageContentToText(item.message.content))
  const firstLine = normalizedText.split('\n').find(Boolean)
  const fallback = item.originalMessage.role === 'assistant' ? 'Assistant reply' : 'User message'

  return truncateText(firstLine ?? fallback, maxTitleLength)
}

export const createTimelineDescription = (item: MessageRenderItem, title: string) => {
  const description = normalizeDescriptionText(messageContentToText(item.message.content))

  if (description === '' || description === title) {
    return undefined
  }

  return truncateText(description, maxDescriptionLength)
}

export const formatTimelineTimestamp = (createdAt: number) => {
  if (!Number.isFinite(createdAt)) return undefined

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return undefined

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit'
  }).format(date)
}
