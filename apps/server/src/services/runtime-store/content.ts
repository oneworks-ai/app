import type { ChatMessageContent } from '@oneworks/core'

import type { RuntimeEvent } from './types.js'

const isTextContentItem = (item: unknown): item is { text: string; type: 'text' } => {
  if (item == null || typeof item !== 'object') {
    return false
  }
  const record = item as Record<string, unknown>
  return record.type === 'text' && typeof record.text === 'string'
}

export const extractTextFromContent = (content: RuntimeEvent['content']) => {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isTextContentItem(item)) {
        return item.text
      }
    }
  }
  return undefined
}

const isChatMessageContent = (item: unknown): item is ChatMessageContent => {
  if (item == null || typeof item !== 'object') {
    return false
  }
  const record = item as Record<string, unknown>
  switch (record.type) {
    case 'text':
      return typeof record.text === 'string'
    case 'image':
      return typeof record.url === 'string'
    case 'file':
      return typeof record.path === 'string'
    case 'tool_use':
      return typeof record.id === 'string' && typeof record.name === 'string'
    case 'tool_result':
      return typeof record.tool_use_id === 'string'
    default:
      return false
  }
}

export const normalizeMessageContent = (
  content: RuntimeEvent['content'] | undefined
): string | ChatMessageContent[] => {
  if (Array.isArray(content)) {
    const items: unknown[] = content
    if (items.every(isChatMessageContent)) {
      return items
    }
    return extractTextFromContent(content) ?? JSON.stringify(content)
  }
  return String(content ?? '')
}
