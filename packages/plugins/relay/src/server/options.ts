import { hostname } from 'node:os'

import {
  DEFAULT_OFFICIAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID,
  officialRelayServicePresets
} from '../shared/official-services.js'
import type { RelayOptions, RelayServerOptions } from './types.js'
import {
  isRecord,
  normalizeRelayPort,
  normalizeRelayProtocol,
  normalizeRemoteBaseUrlFromParts,
  slugify,
  toBoolean,
  toString
} from './utils.js'

export interface ResolvedRelayServer extends RelayServerOptions {
  pairingToken: string
}

const OFFICIAL_RELAY_OPTION_DEFAULTS = {
  enableOfficialCloudflareRelay: true,
  enableOfficialVercelRelay: true
}

const serverIdFromBaseUrl = (baseUrl: string, index: number) => {
  try {
    const url = new URL(baseUrl)
    return slugify(`${url.protocol.replace(':', '')}-${url.host}${url.pathname}`)
  } catch {
    return `relay-${index + 1}`
  }
}

const normalizeServerName = (value: unknown, baseUrl: string, id: string) => {
  const name = toString(value)
  if (name !== '') return name
  try {
    return new URL(baseUrl).host
  } catch {
    return id
  }
}

const normalizeRelayServer = (
  value: Record<string, unknown>,
  index: number,
  fallbackId = `relay-${index + 1}`
): ResolvedRelayServer | undefined => {
  const remoteBaseUrl = normalizeRemoteBaseUrlFromParts(value)
  if (remoteBaseUrl === '') return undefined
  const url = new URL(remoteBaseUrl)
  const id = slugify(toString(value.id) || serverIdFromBaseUrl(remoteBaseUrl, index) || fallbackId)
  const port = normalizeRelayPort(value.port) ?? (url.port === '' ? undefined : Number(url.port))
  return {
    id,
    name: normalizeServerName(value.name, remoteBaseUrl, id),
    ...(value.official === true ? { official: true } : {}),
    pairingToken: toString(value.pairingToken),
    pairingTokenConfigured: toString(value.pairingToken) !== '',
    ...(toString(value.platform) === '' ? {} : { platform: toString(value.platform) }),
    port,
    protocol: normalizeRelayProtocol(url.protocol),
    remoteBaseUrl,
    server: url.hostname
  }
}

const readOfficialServiceFlags = (options: Record<string, unknown>) => ({
  cloudflare: toBoolean(
    options.enableOfficialCloudflareRelay,
    OFFICIAL_RELAY_OPTION_DEFAULTS.enableOfficialCloudflareRelay
  ),
  vercel: toBoolean(
    options.enableOfficialVercelRelay,
    OFFICIAL_RELAY_OPTION_DEFAULTS.enableOfficialVercelRelay
  )
})

const readOfficialServers = (options: Record<string, unknown>) => {
  const flags = readOfficialServiceFlags(options)
  return officialRelayServicePresets
    .filter(preset =>
      preset.id === OFFICIAL_RELAY_CLOUDFLARE_SERVER_ID
        ? flags.cloudflare
        : flags.vercel
    )
    .map((preset, index) =>
      normalizeRelayServer(
        {
          baseUrl: preset.remoteBaseUrl,
          id: preset.id,
          name: preset.name,
          official: true,
          platform: preset.platform
        },
        index,
        preset.id
      )
    )
    .filter((server): server is ResolvedRelayServer => server != null)
}

const readConfiguredServers = (options: Record<string, unknown>) => {
  const rawServers = Array.isArray(options.servers) ? options.servers : []
  return rawServers
    .map((value, index) => isRecord(value) ? normalizeRelayServer(value, index) : undefined)
    .filter((server): server is ResolvedRelayServer => server != null)
}

export const resolveRelayServers = (options: Record<string, unknown>): ResolvedRelayServer[] => {
  return [
    ...readOfficialServers(options),
    ...readConfiguredServers(options)
  ]
}

export const resolveActiveRelayServer = (
  options: Record<string, unknown>,
  requestedServerId?: string
) => {
  const servers = resolveRelayServers(options)
  const requested = toString(requestedServerId)
  if (requested !== '') {
    const requestedServerId = slugify(requested)
    return servers.find(server => server.id === requestedServerId)
  }
  const active = toString(options.activeServerId)
  if (active !== '') {
    const activeServerId = slugify(active)
    return servers.find(server => server.id === activeServerId) ?? servers[0]
  }
  return servers.find(server => server.id === DEFAULT_OFFICIAL_RELAY_SERVER_ID) ?? servers[0]
}

export const normalizeOptions = (options: Record<string, unknown>): RelayOptions => {
  const servers = resolveRelayServers(options)
  const activeServer = resolveActiveRelayServer(options)
  const officialServices = readOfficialServiceFlags(options)
  return {
    activeServerId: activeServer?.id ?? '',
    servers: servers.map(({ pairingToken: _pairingToken, ...server }) => server),
    deviceName: toString(options.deviceName) || hostname(),
    autoConnect: toBoolean(options.autoConnect, false),
    capabilities: {
      sessions: toBoolean(options.exposeSessions, true),
      terminal: toBoolean(options.exposeTerminal, false),
      workspaceFiles: toBoolean(options.exposeWorkspaceFiles, false)
    },
    officialServices
  }
}
