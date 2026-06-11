export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const toString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const toBoolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export const toInteger = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  const text = toString(value)
  if (text === '') return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

export const parseJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const normalizeRemoteBaseUrl = (value: unknown) => {
  const raw = toString(value)
  if (raw === '') return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export const normalizeRelayProtocol = (value: unknown) => {
  const protocol = toString(value).replace(/:$/, '').toLowerCase()
  return protocol === 'http' || protocol === 'https' ? protocol : 'https'
}

export const normalizeRelayPort = (value: unknown) => {
  const port = toInteger(value)
  if (port == null || port < 1 || port > 65535) return undefined
  return port
}

export const normalizeRemoteBaseUrlFromParts = (parts: {
  baseUrl?: unknown
  path?: unknown
  port?: unknown
  protocol?: unknown
  remoteBaseUrl?: unknown
  server?: unknown
}) => {
  const directBaseUrl = normalizeRemoteBaseUrl(parts.baseUrl ?? parts.remoteBaseUrl)
  if (directBaseUrl !== '') return directBaseUrl

  const server = toString(parts.server)
  if (server === '') return ''

  try {
    const protocol = normalizeRelayProtocol(parts.protocol)
    const port = normalizeRelayPort(parts.port)
    const url = new URL(server.includes('://') ? server : `${protocol}://${server}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (port != null) url.port = String(port)
    const path = toString(parts.path)
    if (path !== '') {
      url.pathname = path.startsWith('/') ? path : `/${path}`
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export const slugify = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'relay' : slug
}
