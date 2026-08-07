import { readFile } from 'node:fs/promises'

const CODEX_PROFILE_ENDPOINTS = [
  'https://chatgpt.com/backend-api/wham/profiles/me',
  'https://chatgpt.com/backend-api/api/codex/profiles/me'
] as const
const CODEX_PROFILE_TIMEOUT_MS = 3_000
const TRUSTED_AVATAR_DOMAIN_ROOTS = [
  'chatgpt.com',
  'openai.com',
  'oaistatic.com',
  'oaiusercontent.com'
] as const

interface CodexProfileAuthTokens {
  access_token?: unknown
  account_id?: unknown
}

interface CodexProfileFetchOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface CodexAccountProfile {
  avatarUrl?: string
  displayName?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const parseCodexProfileAuth = (authContent: string) => {
  try {
    const parsed = JSON.parse(authContent) as unknown
    const tokens = isRecord(parsed) && isRecord(parsed.tokens)
      ? parsed.tokens as CodexProfileAuthTokens
      : undefined
    const accessToken = normalizeString(tokens?.access_token)
    if (accessToken == null) {
      return undefined
    }

    return {
      accessToken,
      accountId: normalizeString(tokens?.account_id)
    }
  } catch {
    return undefined
  }
}

const normalizeTrustedAvatarUrl = (value: unknown) => {
  const normalized = normalizeString(value)
  if (normalized == null) {
    return undefined
  }

  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase()
    const isTrustedHost = TRUSTED_AVATAR_DOMAIN_ROOTS.some(domain => (
      hostname === domain || hostname.endsWith(`.${domain}`)
    ))
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      !isTrustedHost
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

const readProfileDisplayName = (profile: Record<string, unknown>) => {
  const directName = normalizeString(profile.name) ?? normalizeString(profile.display_name)
  if (directName != null) {
    return directName
  }

  const composedName = [
    normalizeString(profile.first_name),
    normalizeString(profile.last_name)
  ].filter((part): part is string => part != null).join(' ')
  return composedName === '' ? undefined : composedName
}

const fetchCodexProfile = async (params: {
  endpoint: string
  accessToken: string
  accountId?: string
  fetchImpl: typeof fetch
  timeoutMs: number
}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)

  try {
    const response = await params.fetchImpl(params.endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
        ...(params.accountId == null ? {} : { 'ChatGPT-Account-Id': params.accountId })
      },
      redirect: 'error',
      signal: controller.signal
    })
    if (!response.ok) {
      return undefined
    }

    const payload = await response.json() as unknown
    const profile = isRecord(payload) && isRecord(payload.profile) ? payload.profile : undefined
    if (profile == null) {
      return undefined
    }

    const result: CodexAccountProfile = {
      avatarUrl: normalizeTrustedAvatarUrl(profile.profile_picture_url),
      displayName: readProfileDisplayName(profile)
    }
    return Object.values(result).some(value => value != null) ? result : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

export const fetchCodexProfileFromContent = async (
  authContent: string,
  options: CodexProfileFetchOptions = {}
) => {
  const auth = parseCodexProfileAuth(authContent)
  if (auth == null) {
    return undefined
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = typeof options.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
    ? options.timeoutMs
    : CODEX_PROFILE_TIMEOUT_MS

  let mergedProfile: CodexAccountProfile | undefined
  for (const endpoint of CODEX_PROFILE_ENDPOINTS) {
    const profile = await fetchCodexProfile({
      endpoint,
      accessToken: auth.accessToken,
      accountId: auth.accountId,
      fetchImpl,
      timeoutMs
    })
    if (profile != null) {
      mergedProfile = {
        avatarUrl: mergedProfile?.avatarUrl ?? profile.avatarUrl,
        displayName: mergedProfile?.displayName ?? profile.displayName
      }
      if (mergedProfile.avatarUrl != null && mergedProfile.displayName != null) {
        return mergedProfile
      }
    }
  }

  return mergedProfile
}

export const fetchCodexProfileFromFile = async (
  authFilePath: string,
  options: CodexProfileFetchOptions = {}
) => {
  try {
    return await fetchCodexProfileFromContent(await readFile(authFilePath, 'utf8'), options)
  } catch {
    return undefined
  }
}

export const fetchCodexProfileAvatarFromContent = async (
  authContent: string,
  options: CodexProfileFetchOptions = {}
) => (await fetchCodexProfileFromContent(authContent, options))?.avatarUrl

export const fetchCodexProfileAvatarFromFile = async (
  authFilePath: string,
  options: CodexProfileFetchOptions = {}
) => (await fetchCodexProfileFromFile(authFilePath, options))?.avatarUrl
