import { DEFAULT_OFFICIAL_RELAY_SERVER_ID } from '../shared/official-services.js'
import {
  buildPluginHomeWebLoginRedirectUri,
  buildWebLoginRedirectUri,
  isDesktopRuntime
} from './login-callback.js'
import type { PluginClientContext, RelayLoginUrlResponse, RelayStatus } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

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

export const openRelayLogin = async (
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
  const popup = window.open(body.loginUrl, '_blank', 'noopener,noreferrer')
  if (popup == null) window.location.href = body.loginUrl
  return {
    loginUrl: body.loginUrl,
    serverId
  }
}
