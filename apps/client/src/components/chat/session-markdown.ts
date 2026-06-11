import type { ChatMessage, ChatMessageContent } from '@oneworks/core'

const stringifyStructuredValue = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatContentPart = (part: ChatMessageContent) => {
  switch (part.type) {
    case 'text':
      return part.text
    case 'image':
      return part.name != null && part.name.trim() !== ''
        ? `![${part.name}](${part.url})`
        : `![](${part.url})`
    case 'file':
      return part.name != null && part.name.trim() !== ''
        ? `[${part.name}](${part.path})`
        : part.path
    case 'tool_use':
      return [
        `**Tool use:** ${part.name}`,
        '',
        '```json',
        stringifyStructuredValue(part.input),
        '```'
      ].join('\n')
    case 'tool_result':
      return [
        `**Tool result:** ${part.tool_use_id}${part.is_error === true ? ' (error)' : ''}`,
        '',
        '```',
        stringifyStructuredValue(part.content),
        '```'
      ].join('\n')
  }
}

const formatMessageContent = (content: ChatMessage['content']) => {
  if (typeof content === 'string') return content
  return content.map(formatContentPart).filter(part => part.trim() !== '').join('\n\n')
}

const formatRoleHeading = (role: ChatMessage['role']) => {
  switch (role) {
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
    case 'system':
      return 'System'
  }
}

export function buildSessionMarkdown({
  messages,
  sessionId,
  title,
  workspacePath
}: {
  messages: ChatMessage[]
  sessionId: string
  title: string
  workspacePath?: string
}) {
  const lines = [`# ${title}`, '', `- Session ID: ${sessionId}`]
  const normalizedWorkspacePath = workspacePath?.trim()
  if (normalizedWorkspacePath != null && normalizedWorkspacePath !== '') {
    lines.push(`- Workspace: ${normalizedWorkspacePath}`)
  }

  if (messages.length === 0) {
    lines.push('', '_No messages._')
    return lines.join('\n')
  }

  for (const message of messages) {
    const content = formatMessageContent(message.content).trim()
    if (content === '') continue
    lines.push('', `## ${formatRoleHeading(message.role)}`, '', content)
  }

  return lines.join('\n')
}
