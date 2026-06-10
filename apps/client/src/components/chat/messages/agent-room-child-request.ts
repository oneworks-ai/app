export interface AgentRoomChildRequestContextItem {
  key: string
  value: string
}

export interface AgentRoomChildRequestOption {
  description?: string
  label: string
  value?: string
}

export interface AgentRoomChildRequest {
  context: AgentRoomChildRequestContextItem[]
  memberLabel?: string
  options: AgentRoomChildRequestOption[]
  request: string
  runTitle?: string
}

const CHILD_REQUEST_PREFIX = '[Agent room child request] '
const CHILD_REQUEST_SUFFIX = ' is waiting for your handling.'

const normalizeLines = (content: string) => content.replace(/\r\n/g, '\n').split('\n')

const parseHeader = (line: string) => {
  if (!line.startsWith(CHILD_REQUEST_PREFIX)) {
    return undefined
  }

  const target = line
    .slice(CHILD_REQUEST_PREFIX.length)
    .replace(new RegExp(`${CHILD_REQUEST_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '')
    .trim()
  if (target === '') {
    return {}
  }

  const separatorIndex = target.indexOf(' / ')
  if (separatorIndex < 0) {
    return { memberLabel: target }
  }

  return {
    memberLabel: target.slice(0, separatorIndex).trim() || undefined,
    runTitle: target.slice(separatorIndex + 3).trim() || undefined
  }
}

const readInlineValue = (lines: string[], label: string) => {
  const prefix = `${label}:`
  const line = lines.find(item => item.startsWith(prefix))
  const value = line == null ? undefined : line.slice(prefix.length).trim()
  return value == null || value === '' ? undefined : value
}

const readBulletSection = (lines: string[], label: string) => {
  const startIndex = lines.findIndex(line => line.trim() === `${label}:`)
  if (startIndex < 0) {
    return []
  }

  const result: string[] = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (line === '') {
      break
    }
    if (!line.startsWith('- ')) {
      break
    }
    result.push(line.slice(2).trim())
  }
  return result
}

const parseContextItem = (line: string): AgentRoomChildRequestContextItem | undefined => {
  const separatorIndex = line.indexOf(':')
  if (separatorIndex < 0) {
    return undefined
  }

  const key = line.slice(0, separatorIndex).trim()
  const value = line.slice(separatorIndex + 1).trim()
  if (key === '' || value === '') {
    return undefined
  }
  return { key, value }
}

const parseOption = (line: string): AgentRoomChildRequestOption => {
  const descriptionSeparator = ' - '
  const descriptionIndex = line.indexOf(descriptionSeparator)
  const optionHead = descriptionIndex < 0 ? line : line.slice(0, descriptionIndex)
  const description = descriptionIndex < 0
    ? undefined
    : line.slice(descriptionIndex + descriptionSeparator.length).trim()
  let label = optionHead.trim()
  let value: string | undefined

  if (label.endsWith(')')) {
    const valueStart = label.lastIndexOf(' (')
    if (valueStart >= 0) {
      value = label.slice(valueStart + 2, -1).trim()
      label = label.slice(0, valueStart).trim()
    }
  }

  return {
    label: label === '' ? line : label,
    ...(value != null && value !== '' ? { value } : {}),
    ...(description != null && description !== '' ? { description } : {})
  }
}

export const parseAgentRoomChildRequest = (content: string): AgentRoomChildRequest | undefined => {
  const lines = normalizeLines(content)
  const header = parseHeader(lines[0] ?? '')
  if (header == null) {
    return undefined
  }

  const request = readInlineValue(lines, 'Request')
  if (request == null) {
    return undefined
  }

  return {
    ...header,
    request,
    context: readBulletSection(lines, 'Context')
      .map(parseContextItem)
      .filter((item): item is AgentRoomChildRequestContextItem => item != null),
    options: readBulletSection(lines, 'Child runtime options').map(parseOption)
  }
}
