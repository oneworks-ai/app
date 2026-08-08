import type { ChatMessageContent } from '@oneworks/core'
import type { ChannelBaseConfig, ChannelInboundEvent } from '@oneworks/core/channel'

export const stripSpeakerPrefix = (text: string) => {
  const lines = text.split('\n')
  if (lines.length < 2) return text
  if (/^\[[^\]]+\]\s*:\s*$/.test(lines[0]?.trim() ?? '')) {
    return lines.slice(1).join('\n')
  }
  return text
}

export const stripLeadingAtTags = (text: string) => {
  let result = text
  while (true) {
    const trimmed = result.trimStart()
    if (!trimmed.startsWith('<at ')) return result
    const endIndex = trimmed.indexOf('</at>')
    if (endIndex < 0) return result
    result = trimmed.slice(endIndex + '</at>'.length)
  }
}

export const resolveChannelCommandPrefix = (config: Pick<ChannelBaseConfig, 'commandPrefix'> | undefined) => {
  const prefix = config?.commandPrefix?.trim()
  return prefix == null || prefix === '' ? '/' : prefix
}

export const isChannelCommandText = (
  commandText: string,
  config: Pick<ChannelBaseConfig, 'commandPrefix'> | undefined
) => commandText.trimStart().startsWith(resolveChannelCommandPrefix(config))

export const stripLeadingSpeakerPrefix = (text: string | undefined) => stripSpeakerPrefix(text ?? '').trimStart()

export const hasLeadingAtTagMention = (text: string | undefined) => (
  /^<at\b[^>]*>.*?<\/at>/u.test(stripLeadingSpeakerPrefix(text))
)

export const matchesMentionPattern = (
  text: string | undefined,
  patterns: readonly string[] | undefined
) => {
  if (!Array.isArray(patterns) || patterns.length === 0) return false

  const strippedText = stripLeadingSpeakerPrefix(text)
  return patterns.some((pattern) => {
    const trimmed = pattern.trim()
    return trimmed !== '' && strippedText.includes(trimmed)
  })
}

export const hasExplicitChannelIntent = (input: {
  commandText: string
  config: Pick<ChannelBaseConfig, 'commandPrefix'> | undefined
  createOnCommand?: boolean
  createOnMention?: boolean
  mentionPatterns?: readonly string[]
  text?: string
}) => {
  if (input.createOnCommand !== false && isChannelCommandText(input.commandText, input.config)) {
    return true
  }

  return input.createOnMention !== false &&
    (hasLeadingAtTagMention(input.text) || matchesMentionPattern(input.text, input.mentionPatterns))
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value != null
}

const isChatMessageContent = (value: unknown): value is ChatMessageContent => {
  if (!isRecord(value)) return false
  const type = value.type
  if (type === 'text') {
    return typeof value.text === 'string'
  }
  if (type === 'image') {
    return typeof value.url === 'string' &&
      (value.path == null || typeof value.path === 'string') &&
      (value.name == null || typeof value.name === 'string') &&
      (value.size == null || typeof value.size === 'number') &&
      (value.mimeType == null || typeof value.mimeType === 'string')
  }
  if (type === 'file') {
    return typeof value.path === 'string' &&
      (value.name == null || typeof value.name === 'string') &&
      (value.size == null || typeof value.size === 'number')
  }
  if (type === 'tool_use') {
    return typeof value.id === 'string' && typeof value.name === 'string'
  }
  if (type === 'tool_result') {
    return typeof value.tool_use_id === 'string' &&
      (value.is_error == null || typeof value.is_error === 'boolean')
  }
  return false
}

export const getInboundContentItems = (inbound: ChannelInboundEvent): ChatMessageContent[] | undefined => {
  const raw = inbound.raw
  if (!isRecord(raw)) return undefined
  const maybe = raw.contentItems
  if (!Array.isArray(maybe)) return undefined
  const items: ChatMessageContent[] = []
  for (const item of maybe) {
    if (!isChatMessageContent(item)) return undefined
    items.push(item)
  }
  return items
}
