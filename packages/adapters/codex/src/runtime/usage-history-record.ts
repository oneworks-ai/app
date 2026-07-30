const RECORD_HEADER_PATTERN =
  /^\s*\{\s*"timestamp"\s*:\s*"(?:\\.|[^"\\])*"\s*,\s*"type"\s*:\s*"(session_meta|turn_context|event_msg)"\s*,\s*"payload"\s*:\s*\{/u
const TOKEN_COUNT_PAYLOAD_PATTERN = /^\s*"type"\s*:\s*"token_count"\s*,/u

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const readCodexUsageMetadataProperty = (source: string, property: string) => {
  const match = new RegExp(
    `"${property.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`,
    'u'
  ).exec(source)
  if (match?.[1] == null) return undefined
  try {
    return readString(JSON.parse(match[1]) as unknown)
  } catch {
    return undefined
  }
}

export const classifyCodexUsageLine = (line: string) => {
  const header = RECORD_HEADER_PATTERN.exec(line)
  if (header?.[1] === 'session_meta') {
    return { kind: 'session_meta' as const, payloadSource: line.slice(header[0].length) }
  }
  if (header?.[1] === 'turn_context') {
    return { kind: 'turn_context' as const, payloadSource: line.slice(header[0].length) }
  }
  if (
    header?.[1] === 'event_msg' &&
    TOKEN_COUNT_PAYLOAD_PATTERN.test(line.slice(header[0].length))
  ) {
    return { kind: 'token_count' as const }
  }
  return undefined
}
