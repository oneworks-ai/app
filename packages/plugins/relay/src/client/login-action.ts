import { DEFAULT_OFFICIAL_RELAY_SERVER_ID } from '../shared/official-services.js'
import { buildPluginHomeWebLoginRedirectUri, buildWebLoginRedirectUri, isDesktopRuntime } from './login-callback.js'
import { parseRelayLoginOptions } from './login-options.js'
import type { PluginClientContext, RelayLoginUrlResponse, RelayStatus } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

const responseBody = async (response: Response) => {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

const responseError = (body: unknown, fallback: string) => (
  isRecord(body) && typeof body.error === 'string' && body.error.trim() !== ''
    ? body.error.trim()
    : fallback
)

export class RelayLoginOptionsUnavailableError extends Error {
  loginUrl: string

  constructor(message: string, loginUrl: string) {
    super(message)
    this.name = 'RelayLoginOptionsUnavailableError'
    this.loginUrl = loginUrl
  }
}

export class RelayLoginRequestError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RelayLoginRequestError'
    this.code = code
  }
}

export type RelayNativeLoginAction =
  | 'email-code-login'
  | 'email-verification-send'
  | 'invite-login'
  | 'password-login'

const readServerIdFromStatus = (status: RelayStatus | null) => {
  const connection: NonNullable<RelayStatus['connection']> = status?.connection ?? {}
  const activeServerId = cleanText(connection.activeServerId)
  if (activeServerId != null) return activeServerId

  const servers = Array.isArray(status?.servers) ? status.servers : []
  const activeServer = servers.find(server => server.active === true)
  return cleanText(activeServer?.id) ?? cleanText(servers[0]?.id) ?? DEFAULT_OFFICIAL_RELAY_SERVER_ID
}

const readStatus = async (ctx: PluginClientContext): Promise<RelayStatus | null> => {
  try {
    const response = await ctx.api.fetch('relay/status')
    if (!response.ok) return null
    const body = await response.json()
    return isRecord(body) ? body as RelayStatus : null
  } catch {
    return null
  }
}

export const createRelayLoginUrl = async (
  ctx: PluginClientContext,
  input: {
    forcePluginHomeRedirect?: boolean
    serverId?: string
  } = {}
) => {
  const status = input.serverId == null ? await readStatus(ctx) : null
  const serverId = cleanText(input.serverId) ?? readServerIdFromStatus(status)
  const response = await ctx.api.fetch('relay/login-url', {
    body: JSON.stringify({
      serverId,
      ...(isDesktopRuntime()
        ? {}
        : {
          redirectUri: input.forcePluginHomeRedirect === true
            ? buildPluginHomeWebLoginRedirectUri(ctx.scope, serverId)
            : buildWebLoginRedirectUri(serverId)
        })
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Relay login failed with ${response.status}`)
  }
  const body = await response.json() as RelayLoginUrlResponse
  if (body.loginUrl == null || body.loginUrl.trim() === '') {
    throw new Error('Relay login URL was not returned.')
  }
  return {
    loginUrl: body.loginUrl,
    remoteBaseUrl: cleanText(body.remoteBaseUrl) ?? new URL(body.loginUrl).origin,
    serverId: cleanText(body.serverId) ?? serverId
  }
}

export const createRelayLoginOptions = async (
  ctx: PluginClientContext,
  input: {
    forcePluginHomeRedirect?: boolean
    serverId?: string
  } = {}
) => {
  const login = await createRelayLoginUrl(ctx, input)
  const loginUrl = new URL(login.loginUrl)
  const response = await ctx.api.fetch('relay/login-options', {
    body: JSON.stringify({
      redirectUri: loginUrl.searchParams.get('redirect_uri') ?? '',
      serverId: login.serverId
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  const body = await responseBody(response)
  if (!response.ok) {
    throw new RelayLoginOptionsUnavailableError(
      responseError(body, `Relay login options failed with ${response.status}`),
      login.loginUrl
    )
  }
  const options = parseRelayLoginOptions(isRecord(body) ? body.options : undefined, {
    expectedRedirectUri: loginUrl.searchParams.get('redirect_uri') ?? '',
    loginUrl: login.loginUrl,
    remoteBaseUrl: login.remoteBaseUrl
  })
  if (options == null) {
    throw new RelayLoginOptionsUnavailableError('Relay login options are invalid.', login.loginUrl)
  }
  return {
    ...login,
    options
  }
}

export const postRelayLoginJson = async (
  ctx: PluginClientContext,
  serverId: string,
  action: RelayNativeLoginAction,
  body: Record<string, unknown>
) => {
  const response = await ctx.api.fetch('relay/native-login', {
    body: JSON.stringify({ action, body, serverId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  const payload = await responseBody(response)
  if (!response.ok) {
    throw new RelayLoginRequestError(
      responseError(payload, `Relay login failed with ${response.status}`),
      isRecord(payload) ? cleanText(payload.code) : undefined
    )
  }
  if (!isRecord(payload)) throw new Error('Relay login response is invalid.')
  return payload
}

export const openRelayLogin = async (
  ctx: PluginClientContext,
  input: {
    forcePluginHomeRedirect?: boolean
    serverId?: string
  } = {}
) => {
  const result = await createRelayLoginUrl(ctx, input)
  const popup = window.open(result.loginUrl, '_blank', 'noopener,noreferrer')
  if (popup == null) window.location.href = result.loginUrl
  return result
}
