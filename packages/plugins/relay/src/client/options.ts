interface RelayServerOptionRecord {
  id?: string
  name?: string
  [key: string]: unknown
}

interface RelayOptionsRecord {
  activeServerId?: string
  servers?: unknown
  [key: string]: unknown
}

export interface RelayServerOptionsDraft {
  id?: string
  name?: string
  remoteBaseUrl: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value: string | undefined) => {
  const text = value?.trim()
  return text == null || text === '' ? undefined : text
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/u, '')

const createServerId = (url: URL) =>
  [
    url.protocol.replace(/:$/u, ''),
    url.hostname.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, ''),
    url.port
  ].filter(Boolean).join('-').toLowerCase()

const normalizeServerUrl = (remoteBaseUrl: string) => {
  let url: URL
  try {
    url = new URL(remoteBaseUrl)
  } catch {
    throw new Error('invalid_relay_server_url')
  }

  const protocol = url.protocol.replace(/:$/u, '')
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error('invalid_relay_server_url')
  }

  const path = trimTrailingSlash(url.pathname)
  const port = url.port === '' ? undefined : Number(url.port)

  return {
    id: createServerId(url),
    name: url.host,
    server: url.hostname,
    protocol,
    ...(port == null ? {} : { port }),
    ...(path === '' ? {} : { path })
  }
}

export const buildRelayServerOptionsUpdate = (
  currentOptions: Record<string, unknown>,
  draft: RelayServerOptionsDraft
) => {
  const options = currentOptions as RelayOptionsRecord
  const normalized = normalizeServerUrl(draft.remoteBaseUrl)
  const existingServers = Array.isArray(options.servers)
    ? options.servers.filter(isRecord).map(server => ({ ...server } as RelayServerOptionRecord))
    : []
  const targetId = cleanText(draft.id) ?? cleanText(options.activeServerId) ?? normalized.id
  const existingIndex = existingServers.findIndex(server => server.id === targetId)
  const existingServer = existingIndex >= 0 ? existingServers[existingIndex] : {}
  const nextServer: RelayServerOptionRecord = {
    ...existingServer,
    id: targetId,
    name: cleanText(draft.name) ?? normalized.name,
    protocol: normalized.protocol,
    server: normalized.server
  }

  delete nextServer.baseUrl

  if (normalized.port != null) {
    nextServer.port = normalized.port
  } else {
    delete nextServer.port
  }

  if (normalized.path != null) {
    nextServer.path = normalized.path
  } else {
    delete nextServer.path
  }

  const servers = existingIndex >= 0
    ? existingServers.map((server, index) => index === existingIndex ? nextServer : server)
    : [nextServer, ...existingServers]

  return {
    ...currentOptions,
    activeServerId: targetId,
    servers
  }
}
