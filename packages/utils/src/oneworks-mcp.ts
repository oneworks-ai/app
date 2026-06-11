export const CANONICAL_ONEWORKS_MCP_SERVER_NAME = 'OneWorks'
export const ONEWORKS_MCP_PERMISSION_SERVER_KEY = 'oneworks'

export const isCanonicalOneworksMcpServerName = (value: string | undefined) =>
  value?.trim() === CANONICAL_ONEWORKS_MCP_SERVER_NAME

export const sanitizeMcpPermissionKeySegment = (value: string | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return undefined

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized !== '' ? normalized : undefined
}

export const resolveMcpPermissionServerKeys = (value: string | undefined) => {
  if (isCanonicalOneworksMcpServerName(value)) {
    return [ONEWORKS_MCP_PERMISSION_SERVER_KEY]
  }

  const key = sanitizeMcpPermissionKeySegment(value)
  return key != null ? [key] : []
}

export const resolveMcpPermissionServerKey = (value: string | undefined) => (
  resolveMcpPermissionServerKeys(value)[0]
)
