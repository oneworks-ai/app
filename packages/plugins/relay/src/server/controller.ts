import { startHeartbeat } from './heartbeat.js'
import { normalizeOptions, resolveActiveRelayServer } from './options.js'
import type { ResolvedRelayServer } from './options.js'
import { createRelaySessionWorker } from './session-worker.js'
import { createRelayDeviceStore } from './store.js'
import type {
  RelayAccountProfile,
  RelayConnectionState,
  RelayPluginContext,
  RelayRemoteDeviceSummary,
  RelayStore,
  RelayStoredServer
} from './types.js'
import { isRecord, toString } from './utils.js'

export interface RelayController {
  connect: (payload?: unknown) => Promise<unknown>
  createLoginUrl: (payload?: unknown) => Promise<unknown>
  disconnect: () => Promise<unknown>
  dispose: () => void
  forget: (payload?: unknown) => Promise<unknown>
  getPublicStatus: () => Promise<unknown>
  completeLogin: (payload?: unknown) => Promise<unknown>
  search: (payload?: unknown) => unknown[]
}

const initialState = (): RelayConnectionState => ({
  state: 'idle',
  message: 'Relay plugin loaded.',
  lastConnectedAt: null,
  lastError: null
})

const createMissingRemoteState = (state: RelayConnectionState, requestedServerId?: string): RelayConnectionState => ({
  state: 'error',
  message: requestedServerId == null || requestedServerId === ''
    ? 'Configure at least one relay server before connecting.'
    : `Unknown relay server: ${requestedServerId}.`,
  lastConnectedAt: state.lastConnectedAt,
  lastError: requestedServerId == null || requestedServerId === ''
    ? 'missing_relay_server'
    : 'unknown_relay_server'
})

const createRegisterBody = (
  ctx: RelayPluginContext,
  store: RelayStore,
  options: ReturnType<typeof normalizeOptions>
) => ({
  deviceId: store.deviceId,
  deviceName: options.deviceName,
  capabilities: options.capabilities,
  workspaceFolder: ctx.workspaceFolder,
  pluginScope: ctx.scope
})

const readServerId = (payload?: unknown) => isRecord(payload) ? toString(payload.serverId) : ''

const readTextField = (payload: unknown, key: string) => (
  isRecord(payload) ? toString(payload[key]) : ''
)

const readOptionalText = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

const buildDesktopRedirectUri = (ctx: RelayPluginContext, serverId: string) => {
  const url = new URL('oneworks://relay/auth')
  url.searchParams.set('workspace', ctx.workspaceFolder)
  url.searchParams.set('scope', ctx.scope)
  url.searchParams.set('serverId', serverId)
  return url.toString()
}

const getStoredServer = (
  store: RelayStore,
  server: ResolvedRelayServer
): RelayStoredServer | undefined => store.servers[server.id]

const createServerStatuses = (
  store: RelayStore,
  options: ReturnType<typeof normalizeOptions>,
  activeServerId?: string
) =>
  options.servers.map(server => {
    const stored = store.servers[server.id]
    return {
      ...server,
      active: server.id === (activeServerId ?? options.activeServerId),
      ...(stored?.account == null ? {} : { account: stored.account }),
      hasToken: (stored?.deviceToken ?? '') !== '',
      registeredAt: stored?.registeredAt ?? null,
      updatedAt: stored?.updatedAt ?? null
    }
  })

const withStoredServer = (
  store: RelayStore,
  server: ResolvedRelayServer,
  update: {
    account?: RelayAccountProfile
    deviceName: string
    deviceToken: string
    registeredAt: string
  }
): RelayStore => {
  const previous = getStoredServer(store, server)
  const account = update.account ?? previous?.account
  return {
    ...store,
    deviceName: update.deviceName,
    servers: {
      ...store.servers,
      [server.id]: {
        deviceToken: update.deviceToken,
        id: server.id,
        ...(account == null ? {} : { account }),
        registeredAt: previous?.registeredAt ?? update.registeredAt,
        remoteBaseUrl: server.remoteBaseUrl,
        updatedAt: update.registeredAt
      }
    }
  }
}

const normalizeAccountProfile = (value: unknown): RelayAccountProfile | undefined => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  const email = toString(value.email)
  const name = toString(value.name)
  const avatarUrl = toString(value.avatarUrl)
  const provider = toString(value.provider)
  const role = toString(value.role)
  if ([id, email, name, avatarUrl, provider, role].every(item => item === '')) return undefined
  return {
    ...(avatarUrl === '' ? {} : { avatarUrl }),
    ...(email === '' ? {} : { email }),
    ...(id === '' ? {} : { id }),
    ...(name === '' ? {} : { name }),
    ...(provider === '' ? {} : { provider }),
    ...(role === '' ? {} : { role })
  }
}

const normalizeRemoteDeviceSummary = (value: unknown): RelayRemoteDeviceSummary | undefined => {
  if (!isRecord(value)) return undefined
  const id = readOptionalText(value.id)
  const name = readOptionalText(value.name)
  const status = readOptionalText(value.status)
  const pluginScope = readOptionalText(value.pluginScope)
  const createdAt = readOptionalText(value.createdAt)
  const lastSeenAt = readOptionalText(value.lastSeenAt)
  const capabilities = isRecord(value.capabilities) ? value.capabilities : undefined
  if ([id, name, status, pluginScope, createdAt, lastSeenAt].every(item => item == null) && capabilities == null) {
    return undefined
  }
  return {
    ...(capabilities == null ? {} : { capabilities }),
    ...(createdAt == null ? {} : { createdAt }),
    ...(id == null ? {} : { id }),
    ...(lastSeenAt == null ? {} : { lastSeenAt }),
    ...(name == null ? {} : { name }),
    ...(pluginScope == null ? {} : { pluginScope }),
    ...(status == null ? {} : { status })
  }
}

const readResponseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const fetchRelayDevices = async (
  server: Pick<ResolvedRelayServer, 'remoteBaseUrl'>,
  storedServer: RelayStoredServer | undefined
): Promise<RelayRemoteDeviceSummary[]> => {
  const deviceToken = storedServer?.deviceToken ?? ''
  if (deviceToken === '') return []

  const response = await fetch(new URL('/api/relay/devices', server.remoteBaseUrl), {
    headers: {
      authorization: `Bearer ${deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    const message = toString(body.error) || `Relay device list failed with ${response.status}.`
    throw new Error(message)
  }
  return Array.isArray(body.devices)
    ? body.devices.map(normalizeRemoteDeviceSummary).filter((device): device is RelayRemoteDeviceSummary => {
      return device != null
    })
    : []
}

export const createRelayController = (ctx: RelayPluginContext): RelayController => {
  let state = initialState()
  const deviceStore = createRelayDeviceStore(ctx.projectHome)
  let heartbeat: ReturnType<typeof startHeartbeat> | undefined
  let sessionWorker: ReturnType<typeof createRelaySessionWorker> | undefined

  const stopRemoteLoops = () => {
    heartbeat?.stop()
    heartbeat = undefined
    sessionWorker?.stop()
    sessionWorker = undefined
  }

  const getPublicStatus = async () => {
    const options = normalizeOptions(ctx.options)
    const statusActiveServerId = state.activeServerId || options.activeServerId
    const activeServer = resolveActiveRelayServer(ctx.options, statusActiveServerId) ??
      resolveActiveRelayServer(ctx.options)
    const store = await deviceStore.readStore()
    const storedActiveServer = activeServer == null ? undefined : getStoredServer(store, activeServer)
    const serverStatuses = await Promise.all(
      createServerStatuses(store, options, activeServer?.id).map(
        async (serverStatus) => {
          const server = options.servers.find(item => item.id === serverStatus.id)
          if (server == null) return serverStatus
          try {
            return {
              ...serverStatus,
              devices: await fetchRelayDevices(server, store.servers[server.id])
            }
          } catch (error) {
            ctx.logger.warn({ err: error, scope: ctx.scope, serverId: server.id }, '[relay] device list failed')
            return {
              ...serverStatus,
              devices: [],
              devicesError: error instanceof Error ? error.message : String(error)
            }
          }
        }
      )
    )
    return {
      options,
      servers: serverStatuses,
      device: {
        id: store.deviceId,
        name: store.deviceName || options.deviceName,
        hasToken: (storedActiveServer?.deviceToken ?? '') !== '',
        registeredAt: storedActiveServer?.registeredAt ?? null,
        updatedAt: storedActiveServer?.updatedAt ?? null
      },
      connection: {
        ...state,
        activeServerId: activeServer?.id ?? options.activeServerId,
        remoteBaseUrl: state.remoteBaseUrl || activeServer?.remoteBaseUrl || ''
      },
      storePath: deviceStore.storePath
    }
  }

  const connect = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    const transientAuthToken = readTextField(payload, 'authToken') ||
      readTextField(payload, 'loginToken') ||
      readTextField(payload, 'token')
    const options = normalizeOptions(ctx.options)
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      stopRemoteLoops()
      state = createMissingRemoteState(state, requestedServerId)
      return await getPublicStatus()
    }

    stopRemoteLoops()
    const store = await deviceStore.readStore()
    const storedServer = getStoredServer(store, activeServer)
    const authToken = transientAuthToken || storedServer?.deviceToken || activeServer.pairingToken
    const registerUrl = new URL('/api/relay/devices/register', activeServer.remoteBaseUrl)
    state = {
      state: 'connecting',
      message: `Registering ${store.deviceId} with ${activeServer.name}.`,
      activeServerId: activeServer.id,
      lastConnectedAt: state.lastConnectedAt,
      lastError: null,
      remoteBaseUrl: activeServer.remoteBaseUrl
    }

    try {
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authToken === '' ? {} : { authorization: `Bearer ${authToken}` })
        },
        body: JSON.stringify(createRegisterBody(ctx, store, options))
      })

      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = isRecord(responseBody) && typeof responseBody.error === 'string'
          ? responseBody.error
          : `Relay registration failed with ${response.status}.`
        throw new Error(message)
      }

      const registeredAt = new Date().toISOString()
      const nextDeviceToken = isRecord(responseBody)
        ? toString(responseBody.deviceToken) || storedServer?.deviceToken || ''
        : storedServer?.deviceToken || ''
      const nextStore = withStoredServer(store, activeServer, {
        account: isRecord(responseBody) ? normalizeAccountProfile(responseBody.user) : undefined,
        deviceName: options.deviceName,
        deviceToken: nextDeviceToken,
        registeredAt
      })
      await deviceStore.writeStore(nextStore)
      const nextStoredServer = nextStore.servers[activeServer.id]
      if ((nextStoredServer?.deviceToken ?? '') !== '') {
        const auth = {
          deviceId: nextStore.deviceId,
          deviceToken: nextStoredServer?.deviceToken ?? '',
          remoteBaseUrl: activeServer.remoteBaseUrl
        }
        heartbeat = startHeartbeat({
          capabilities: options.capabilities,
          deviceId: auth.deviceId,
          deviceName: options.deviceName,
          deviceToken: auth.deviceToken,
          logger: ctx.logger,
          pluginScope: ctx.scope,
          remoteBaseUrl: auth.remoteBaseUrl,
          workspaceFolder: ctx.workspaceFolder
        })
        if (options.capabilities.sessions && ctx.sessions != null) {
          sessionWorker = createRelaySessionWorker({
            adapter: ctx.sessions,
            auth,
            logger: ctx.logger
          })
          void sessionWorker.runOnce().catch(error => {
            ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] session forwarding bootstrap failed')
          })
        }
      }
      state = {
        state: 'registered',
        message: `Device registered with ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: registeredAt,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] device registration failed')
      state = {
        state: 'error',
        message,
        activeServerId: activeServer.id,
        lastConnectedAt: state.lastConnectedAt,
        lastError: message,
        remoteBaseUrl: activeServer.remoteBaseUrl
      }
    }

    return await getPublicStatus()
  }

  const createLoginUrl = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      throw new Error(
        requestedServerId === ''
          ? 'Configure at least one relay server before logging in.'
          : `Unknown relay server: ${requestedServerId}.`
      )
    }

    const redirectUri = readTextField(payload, 'redirectUri') || buildDesktopRedirectUri(ctx, activeServer.id)
    const loginUrl = new URL('/login', activeServer.remoteBaseUrl)
    loginUrl.searchParams.set('redirect_uri', redirectUri)
    loginUrl.searchParams.set('scope', ctx.scope)
    loginUrl.searchParams.set('server_id', activeServer.id)
    return {
      loginUrl: loginUrl.toString(),
      redirectUri,
      remoteBaseUrl: activeServer.remoteBaseUrl,
      serverId: activeServer.id
    }
  }

  const completeLogin = async (payload?: unknown) => {
    const token = readTextField(payload, 'token') || readTextField(payload, 'relayToken')
    if (token === '') {
      throw new Error('Missing relay login token.')
    }
    return await connect({
      ...(isRecord(payload) ? payload : {}),
      authToken: token
    })
  }

  const disconnect = async () => {
    stopRemoteLoops()
    state = {
      state: 'idle',
      message: 'Relay connection disabled for this server process.',
      activeServerId: state.activeServerId,
      lastConnectedAt: state.lastConnectedAt,
      lastError: null,
      remoteBaseUrl: state.remoteBaseUrl
    }
    return await getPublicStatus()
  }

  const forget = async (payload?: unknown) => {
    stopRemoteLoops()
    const store = await deviceStore.readStore()
    const requestedServerId = readServerId(payload)
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    const nextServers = { ...store.servers }
    if (activeServer == null) {
      for (const server of Object.values(nextServers)) {
        nextServers[server.id] = {
          ...server,
          deviceToken: ''
        }
      }
    } else {
      const previous = getStoredServer(store, activeServer)
      nextServers[activeServer.id] = {
        deviceToken: '',
        id: activeServer.id,
        registeredAt: previous?.registeredAt,
        remoteBaseUrl: activeServer.remoteBaseUrl,
        updatedAt: new Date().toISOString()
      }
    }
    await deviceStore.writeStore({
      deviceId: store.deviceId,
      deviceSecret: store.deviceSecret,
      deviceName: store.deviceName,
      servers: nextServers
    })
    state = {
      state: 'idle',
      message: activeServer == null
        ? 'Stored relay device tokens removed.'
        : `Stored relay device token removed for ${activeServer.name}.`,
      activeServerId: activeServer?.id,
      lastConnectedAt: null,
      lastError: null,
      remoteBaseUrl: activeServer?.remoteBaseUrl
    }
    return await getPublicStatus()
  }

  return {
    completeLogin,
    connect,
    createLoginUrl,
    disconnect,
    dispose: () => {
      stopRemoteLoops()
      state = {
        state: 'idle',
        message: 'Relay plugin disposed.',
        activeServerId: state.activeServerId,
        lastConnectedAt: state.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: state.remoteBaseUrl
      }
    },
    forget,
    getPublicStatus,
    search: payload => [{
      id: 'status',
      title: 'Account status',
      subtitle: `Query: ${toString(isRecord(payload) ? payload.query : undefined) || 'relay'}`,
      icon: 'account_circle'
    }]
  }
}
