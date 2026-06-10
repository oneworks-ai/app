export interface AgentRoomEnvelopeSession {
  current: boolean
  memberKey?: string
  runKey?: string
  sessionId?: string
  status?: string
  title?: string
}

export interface AgentRoomEnvelope {
  currentMemberKey?: string
  roomId?: string
  roomTitle?: string
  routingRules: string[]
  sessions: AgentRoomEnvelopeSession[]
  userMessage: string
}

const openTag = '<agent-room-message>'
const closeTag = '</agent-room-message>'
const roomContextMarker = 'Current Agent Room context:'
const existingSessionsMarker = '- existing member sessions:'
const routingRulesMarker = 'Routing rules:'
const userMessageMarker = 'User message:'

const stripListPrefix = (line: string) => line.trim().replace(/^-\s*/, '').trim()

const splitKeyValue = (value: string) => {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex < 0) {
    return undefined
  }

  const key = value.slice(0, separatorIndex).trim()
  const entryValue = value.slice(separatorIndex + 1).trim()
  return key === '' || entryValue === '' ? undefined : { key, value: entryValue }
}

const parseSessionLine = (line: string): AgentRoomEnvelopeSession | undefined => {
  const fields = stripListPrefix(line)
    .split('|')
    .map(field => field.trim())
    .filter(Boolean)
  if (fields.length === 0) {
    return undefined
  }

  const session: AgentRoomEnvelopeSession = { current: false }
  for (const field of fields) {
    const separatorIndex = field.indexOf('=')
    if (separatorIndex < 0) {
      continue
    }

    const key = field.slice(0, separatorIndex).trim()
    const value = field.slice(separatorIndex + 1).trim()
    if (key === 'current') {
      session.current = value === 'true'
    } else if (key === 'memberKey') {
      session.memberKey = value
    } else if (key === 'runKey') {
      session.runKey = value
    } else if (key === 'sessionId') {
      session.sessionId = value
    } else if (key === 'status') {
      session.status = value
    } else if (key === 'title') {
      session.title = value
    }
  }

  return session.memberKey == null && session.sessionId == null ? undefined : session
}

export const parseAgentRoomEnvelope = (content: string): AgentRoomEnvelope | undefined => {
  const trimmed = content.trim()
  if (!trimmed.startsWith(openTag) || !trimmed.endsWith(closeTag)) {
    return undefined
  }

  const body = trimmed.slice(openTag.length, trimmed.length - closeTag.length).trim()
  const lines = body.split(/\r?\n/)
  const userMessageIndex = lines.findIndex(line => line.trim() === userMessageMarker)
  if (userMessageIndex < 0) {
    return undefined
  }

  const userMessage = lines.slice(userMessageIndex + 1).join('\n').trim()
  if (userMessage === '') {
    return undefined
  }

  const envelope: AgentRoomEnvelope = {
    routingRules: [],
    sessions: [],
    userMessage
  }
  let section: 'context' | 'sessions' | 'routing' | undefined

  for (const rawLine of lines.slice(0, userMessageIndex)) {
    const line = rawLine.trim()
    if (line === '' || line === roomContextMarker) {
      section = section ?? 'context'
      continue
    }
    if (line === existingSessionsMarker) {
      section = 'sessions'
      continue
    }
    if (line === routingRulesMarker) {
      section = 'routing'
      continue
    }

    if (section === 'sessions') {
      const session = parseSessionLine(line)
      if (session != null) {
        envelope.sessions.push(session)
      }
      continue
    }

    if (section === 'routing') {
      envelope.routingRules.push(stripListPrefix(line))
      continue
    }

    const metadata = splitKeyValue(stripListPrefix(line))
    if (metadata?.key === 'roomId') {
      envelope.roomId = metadata.value
    } else if (metadata?.key === 'roomTitle') {
      envelope.roomTitle = metadata.value
    } else if (metadata?.key === 'currentMemberKey') {
      envelope.currentMemberKey = metadata.value
    }
  }

  return envelope
}
