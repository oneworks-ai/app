import { randomUUID } from 'node:crypto'

export const websitePermissionModes = ['always_ask', 'always_allow'] as const
export type WebsitePermissionMode = typeof websitePermissionModes[number]

export interface WebsitePermissionRule {
  created_at: string
  id: string
  mode: WebsitePermissionMode
  pattern: string
  updated_at: string
}

export interface WebsitePermissions {
  rules: WebsitePermissionRule[]
  scope: 'oneworks_configuration'
  updated_at?: string
}

interface ParsedPattern {
  host: string
  path: string
  port?: string
  scheme: '*' | 'http' | 'https'
}

const MAX_RULES = 100
const MAX_PATTERN_LENGTH = 512

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const parseAuthority = (authority: string) => {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) throw new TypeError('URL pattern contains an invalid IPv6 host.')
    const host = authority.slice(0, end + 1)
    const suffix = authority.slice(end + 1)
    if (suffix !== '' && !/^:(?:\*|\d{1,5})$/u.test(suffix)) {
      throw new TypeError('URL pattern contains an invalid port.')
    }
    return { host, port: suffix === '' ? undefined : suffix.slice(1) }
  }
  const colon = authority.lastIndexOf(':')
  if (colon < 0) return { host: authority, port: undefined }
  const port = authority.slice(colon + 1)
  if (!/^(?:\*|\d{1,5})$/u.test(port)) throw new TypeError('URL pattern contains an invalid port.')
  return { host: authority.slice(0, colon), port }
}

const normalizeHost = (host: string) => {
  if (host === '*') return host
  const wildcard = host.startsWith('*.')
  const candidate = wildcard ? host.slice(2) : host
  if (candidate === '' || candidate.includes('*')) {
    throw new TypeError('Host wildcard is only supported as *.example.com.')
  }
  let normalized = ''
  try {
    normalized = new URL(`https://${candidate}`).hostname.toLowerCase()
  } catch {
    throw new TypeError('URL pattern contains an invalid host.')
  }
  if (normalized === '') throw new TypeError('URL pattern contains an invalid host.')
  return wildcard ? `*.${normalized}` : normalized
}

const parseWebsitePattern = (input: string): ParsedPattern => {
  const value = input.trim()
  if (value.length === 0 || value.length > MAX_PATTERN_LENGTH || /\s/u.test(value)) {
    throw new TypeError('Enter a URL pattern between 1 and 512 characters without spaces.')
  }
  if (value.includes('@') || value.includes('?') || value.includes('#')) {
    throw new TypeError('URL patterns cannot contain credentials, query strings, or fragments.')
  }
  const match = /^(\*|https?):\/\/([^/]+)(\/.*)?$/iu.exec(value)
  if (match == null) {
    throw new TypeError('Use a pattern such as https://example.com/* or https://*.example.com/*.')
  }
  const scheme = match[1].toLowerCase() as ParsedPattern['scheme']
  const { host, port } = parseAuthority(match[2].toLowerCase())
  if (port != null && port !== '*' && (Number(port) < 1 || Number(port) > 65_535)) {
    throw new TypeError('URL pattern port must be between 1 and 65535.')
  }
  const path = match[3] ?? '/*'
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError('URL pattern path must start with / and cannot contain a query or fragment.')
  }
  return { host: normalizeHost(host), path, port, scheme }
}

export const normalizeWebsitePattern = (input: string) => {
  const pattern = parseWebsitePattern(input)
  return `${pattern.scheme}://${pattern.host}${pattern.port == null ? '' : `:${pattern.port}`}${pattern.path}`
}

const normalizedRule = (value: unknown): WebsitePermissionRule | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.mode !== 'string') {
    return undefined
  }
  const mode = value.mode as WebsitePermissionMode
  if (!websitePermissionModes.includes(mode)) return undefined
  try {
    const pattern = normalizeWebsitePattern(typeof value.pattern === 'string' ? value.pattern : '')
    const createdAt = typeof value.created_at === 'string' ? value.created_at : new Date(0).toISOString()
    const updatedAt = typeof value.updated_at === 'string' ? value.updated_at : createdAt
    return {
      created_at: createdAt,
      id: value.id,
      mode,
      pattern,
      updated_at: updatedAt
    }
  } catch {
    return undefined
  }
}

export const emptyWebsitePermissions = (): WebsitePermissions => ({
  rules: [],
  scope: 'oneworks_configuration'
})

export const normalizeWebsitePermissions = (value: unknown): WebsitePermissions => {
  const record = isRecord(value) ? value : {}
  const rules = Array.isArray(record.rules)
    ? record.rules.map(normalizedRule).filter((rule): rule is WebsitePermissionRule => rule != null).slice(0, MAX_RULES)
    : []
  return {
    rules,
    scope: 'oneworks_configuration',
    ...(typeof record.updated_at === 'string' ? { updated_at: record.updated_at } : {})
  }
}

const wildcardPathMatches = (pattern: string, path: string) => {
  const expression = pattern
    .split('*')
    .map(part => part.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'))
    .join('.*')
  return new RegExp(`^${expression}$`, 'u').test(path)
}

export const matchesWebsitePattern = (pattern: string, inputUrl: string) => {
  const parsed = parseWebsitePattern(pattern)
  let url: URL
  try {
    url = new URL(inputUrl)
  } catch {
    return false
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (!['http', 'https'].includes(scheme) || (parsed.scheme !== '*' && parsed.scheme !== scheme)) return false
  const hostname = url.hostname.toLowerCase()
  const hostMatches = parsed.host === '*' || parsed.host.startsWith('*.')
    ? parsed.host === '*' || hostname === parsed.host.slice(2) || hostname.endsWith(`.${parsed.host.slice(2)}`)
    : hostname === parsed.host
  if (!hostMatches) return false
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (parsed.port != null && parsed.port !== '*' && effectivePort !== parsed.port) return false
  return wildcardPathMatches(parsed.path, url.pathname)
}

export const findWebsitePermission = (rules: WebsitePermissionRule[], url: string) => (
  rules.find(rule => matchesWebsitePattern(rule.pattern, url))
)

export const createWebsitePermissionRule = (
  pattern: string,
  mode: WebsitePermissionMode,
  now = new Date().toISOString()
): WebsitePermissionRule => {
  if (!websitePermissionModes.includes(mode)) throw new TypeError('A known website permission mode is required.')
  return {
    created_at: now,
    id: `site_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    mode,
    pattern: normalizeWebsitePattern(pattern),
    updated_at: now
  }
}

export const assertWebsitePermissionCapacity = (rules: WebsitePermissionRule[]) => {
  if (rules.length >= MAX_RULES) throw new TypeError(`Website permission rules are limited to ${MAX_RULES}.`)
}
