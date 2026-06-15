import type { RelayConfigSnapshot } from '../shared/config-assignment.js'
import { createRelayConfigSnapshotStore } from '../shared/config-cache.js'
import { syncRelayConfigSnapshot } from './config-sync.js'
import { startHeartbeat } from './heartbeat.js'
import { normalizeOptions, resolveActiveRelayServer } from './options.js'
import type { ResolvedRelayServer } from './options.js'
import { createRelaySessionWorker } from './session-worker.js'
import { createRelayDeviceStore } from './store.js'
import type {
  RelayAccountProfile,
  RelayConfigDistributionStatus,
  RelayConnectionState,
  RelayPluginContext,
  RelayPublicStatus,
  RelayRemoteDeviceSummary,
  RelayStore,
  RelayStoredServer
} from './types.js'
import { isRecord, toString } from './utils.js'

export interface RelayController {
  connect: (payload?: unknown) => Promise<unknown>
  createLoginUrl: (payload?: unknown) => Promise<unknown>
  disconnect: (payload?: unknown) => Promise<unknown>
  dispose: () => void
  forget: (payload?: unknown) => Promise<unknown>
  getPublicStatus: () => Promise<RelayPublicStatus>
  refreshConfigDistribution: (payload?: unknown) => Promise<RelayPublicStatus>
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
  ...(requestedServerId == null || requestedServerId === '' ? {} : { activeServerId: requestedServerId }),
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
  getConnectionState: (server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>) => RelayConnectionState,
  activeServerId?: string
) =>
  options.servers.map(server => {
    const stored = store.servers[server.id]
    const connection = getConnectionState(server)
    return {
      ...server,
      active: server.id === (activeServerId ?? options.activeServerId),
      connected: connection.state === 'registered',
      connection,
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

const emptyConfigDistributionStatus = (): RelayConfigDistributionStatus => ({
  allowedFields: [],
  hash: null,
  lastAppliedAt: null,
  lastError: null,
  lastSyncedAt: null,
  marketplaceKeys: [],
  matchedProject: null,
  modelServiceKeys: [],
  pluginKeys: [],
  skillKeys: [],
  skillRegistryKeys: [],
  sourceServerId: null,
  version: null
})

const readStringList = (value: unknown) => (
  Array.isArray(value)
    ? value.map(item => toString(item).trim()).filter(item => item !== '')
    : []
)

const readStatusText = (value: unknown) => {
  const text = readOptionalText(value)
  return text == null ? null : text
}

const readRecordKeys = (value: unknown) => (
  isRecord(value) ? Object.keys(value).filter(key => key.trim() !== '') : []
)

const readArrayOrRecordKeys = (value: unknown) => {
  if (Array.isArray(value)) return readStringList(value)
  return readRecordKeys(value)
}

const readMatchedProject = (value: unknown) => {
  if (typeof value === 'boolean') return value
  return readStatusText(value)
}

const normalizeConfigDistributionStatus = (value: unknown): RelayConfigDistributionStatus => {
  if (!isRecord(value)) return emptyConfigDistributionStatus()

  const modelServiceKeys = readStringList(value.modelServiceKeys)
  const derivedModelServiceKeys = modelServiceKeys.length === 0 && isRecord(value.modelServices)
    ? Object.keys(value.modelServices).filter(key => key.trim() !== '')
    : modelServiceKeys
  const marketplaceKeys = readStringList(value.marketplaceKeys)
  const pluginKeys = readStringList(value.pluginKeys)
  const skillKeys = readStringList(value.skillKeys)
  const skillRegistryKeys = readStringList(value.skillRegistryKeys)

  return {
    allowedFields: readStringList(value.allowedFields),
    hash: readStatusText(value.hash),
    lastAppliedAt: readStatusText(value.lastAppliedAt),
    lastError: readStatusText(value.lastError),
    lastSyncedAt: readStatusText(value.lastSyncedAt),
    marketplaceKeys: marketplaceKeys.length === 0 ? readRecordKeys(value.marketplaces) : marketplaceKeys,
    matchedProject: readMatchedProject(value.matchedProject),
    modelServiceKeys: derivedModelServiceKeys,
    pluginKeys: pluginKeys.length === 0 ? readRecordKeys(value.plugins) : pluginKeys,
    skillKeys: skillKeys.length === 0 ? readArrayOrRecordKeys(value.skills) : skillKeys,
    skillRegistryKeys: skillRegistryKeys.length === 0
      ? readArrayOrRecordKeys(value.skillRegistries)
      : skillRegistryKeys,
    sourceServerId: readStatusText(value.sourceServerId),
    version: readStatusText(value.version)
  }
}

const collectSnapshotPatchKeys = (
  snapshot: RelayConfigSnapshot | undefined,
  field: 'marketplaces' | 'modelServices' | 'plugins' | 'skillRegistries' | 'skills'
) => {
  const keys = new Set<string>()
  const collectAssignment = (assignment: NonNullable<RelayConfigSnapshot['assignments']>[number]) => {
    for (const key of readArrayOrRecordKeys(assignment.configPatch?.[field])) keys.add(key)
    if (Array.isArray(assignment.rules)) {
      for (const rule of assignment.rules) {
        if (typeof rule === 'string') continue
        collectAssignment(rule)
      }
    }
  }
  for (const assignment of snapshot?.assignments ?? []) collectAssignment(assignment)
  for (const rule of snapshot?.rules ?? []) collectAssignment(rule)
  return [...keys]
}

const collectSnapshotAllowedFields = (snapshot: RelayConfigSnapshot | undefined) => {
  const fields = new Set<string>()
  const collectAssignment = (assignment: NonNullable<RelayConfigSnapshot['assignments']>[number]) => {
    for (const field of assignment.allowedFields ?? []) fields.add(field)
    if (Array.isArray(assignment.rules)) {
      for (const rule of assignment.rules) {
        if (typeof rule === 'string') continue
        collectAssignment(rule)
      }
    }
  }
  for (const assignment of snapshot?.assignments ?? []) collectAssignment(assignment)
  for (const rule of snapshot?.rules ?? []) collectAssignment(rule)
  return [...fields]
}

const snapshotToConfigDistributionStatus = (
  snapshot: RelayConfigSnapshot | undefined
): RelayConfigDistributionStatus => {
  if (snapshot == null) return emptyConfigDistributionStatus()
  return {
    allowedFields: collectSnapshotAllowedFields(snapshot),
    hash: snapshot.hash ?? null,
    lastAppliedAt: snapshot.lastAppliedAt ?? null,
    lastError: snapshot.lastError ?? null,
    lastSyncedAt: snapshot.lastSyncedAt ?? null,
    marketplaceKeys: collectSnapshotPatchKeys(snapshot, 'marketplaces'),
    matchedProject: snapshot.matchedProject ?? null,
    modelServiceKeys: collectSnapshotPatchKeys(snapshot, 'modelServices'),
    pluginKeys: collectSnapshotPatchKeys(snapshot, 'plugins'),
    skillKeys: collectSnapshotPatchKeys(snapshot, 'skills'),
    skillRegistryKeys: collectSnapshotPatchKeys(snapshot, 'skillRegistries'),
    sourceServerId: snapshot.sourceServerId ?? null,
    version: snapshot.version
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
  const configSnapshotStore = createRelayConfigSnapshotStore(ctx.projectHome)
  const heartbeats = new Map<string, ReturnType<typeof startHeartbeat>>()
  const sessionWorkers = new Map<string, ReturnType<typeof createRelaySessionWorker>>()
  const connectionStates: Record<string, RelayConnectionState> = {}
  let configDistributionStatus: RelayConfigDistributionStatus | undefined

  const getConnectionState = (server: Pick<ResolvedRelayServer, 'id' | 'remoteBaseUrl'>) => ({
    ...initialState(),
    activeServerId: server.id,
    remoteBaseUrl: server.remoteBaseUrl,
    ...connectionStates[server.id]
  })

  const setConnectionState = (serverId: string, nextState: RelayConnectionState) => {
    connectionStates[serverId] = nextState
    state = nextState
  }

  const readConfiguredConfigDistributionStatus = () =>
    normalizeConfigDistributionStatus(ctx.options.configDistribution ?? ctx.options.configSync)

  const setConfigDistributionError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    configDistributionStatus = {
      ...(configDistributionStatus ?? readConfiguredConfigDistributionStatus()),
      lastError: message
    }
    return configDistributionStatus
  }

  const readConfigDistributionStatus = async () => {
    const getStatus = ctx.configDistribution?.getStatus
    if (getStatus != null) {
      try {
        configDistributionStatus = normalizeConfigDistributionStatus(await getStatus())
        return configDistributionStatus
      } catch (error) {
        ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] config distribution status failed')
        return setConfigDistributionError(error)
      }
    }
    const cachedStatus = snapshotToConfigDistributionStatus(await configSnapshotStore.readSnapshot())
    configDistributionStatus = cachedStatus.version == null && cachedStatus.lastError == null
      ? configDistributionStatus ?? readConfiguredConfigDistributionStatus()
      : cachedStatus
    return configDistributionStatus
  }

  const refreshConfigDistributionStatus = async (payload?: unknown) => {
    const refresh = ctx.configDistribution?.refresh
    try {
      if (refresh != null) {
        configDistributionStatus = normalizeConfigDistributionStatus(await refresh())
        return configDistributionStatus
      }

      const requestedServerId = readServerId(payload)
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        throw new Error(
          requestedServerId === ''
            ? 'Configure at least one relay server before refreshing relay config.'
            : `Unknown relay server: ${requestedServerId}.`
        )
      }

      const store = await deviceStore.readStore()
      const result = await syncRelayConfigSnapshot({
        ctx,
        server: activeServer,
        storedServer: getStoredServer(store, activeServer)
      })
      configDistributionStatus = snapshotToConfigDistributionStatus(result.snapshot)
      return configDistributionStatus
    } catch (error) {
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] config distribution refresh failed')
      return setConfigDistributionError(error)
    }
  }

  const stopRemoteLoop = (serverId: string) => {
    heartbeats.get(serverId)?.stop()
    heartbeats.delete(serverId)
    sessionWorkers.get(serverId)?.stop()
    sessionWorkers.delete(serverId)
  }

  const stopRemoteLoops = () => {
    for (const serverId of new Set([...heartbeats.keys(), ...sessionWorkers.keys()])) {
      stopRemoteLoop(serverId)
    }
  }

  const getPublicStatus = async (
    configDistributionOverride?: RelayConfigDistributionStatus
  ): Promise<RelayPublicStatus> => {
    const options = normalizeOptions(ctx.options)
    const statusActiveServerId = state.activeServerId || options.activeServerId
    const resolvedStatusServer = statusActiveServerId === ''
      ? undefined
      : resolveActiveRelayServer(ctx.options, statusActiveServerId)
    const activeServer = resolvedStatusServer ??
      (state.activeServerId == null || state.activeServerId === '' ? resolveActiveRelayServer(ctx.options) : undefined)
    const summaryState = activeServer == null
      ? state
      : getConnectionState(activeServer)
    const store = await deviceStore.readStore()
    const storedActiveServer = activeServer == null ? undefined : getStoredServer(store, activeServer)
    const serverStatuses = await Promise.all(
      createServerStatuses(store, options, getConnectionState, activeServer?.id).map(
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
      configDistribution: configDistributionOverride ?? await readConfigDistributionStatus(),
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
        ...summaryState,
        activeServerId: summaryState.activeServerId || activeServer?.id || options.activeServerId,
        remoteBaseUrl: summaryState.remoteBaseUrl || activeServer?.remoteBaseUrl || ''
      },
      storePath: deviceStore.storePath
    }
  }

  const refreshConfigDistribution = async (payload?: unknown) => {
    const configDistribution = await refreshConfigDistributionStatus(payload)
    return await getPublicStatus(configDistribution)
  }

  const connect = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    const transientAuthToken = readTextField(payload, 'authToken') ||
      readTextField(payload, 'loginToken') ||
      readTextField(payload, 'token')
    const options = normalizeOptions(ctx.options)
    const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
    if (activeServer == null) {
      state = createMissingRemoteState(state, requestedServerId)
      return await getPublicStatus()
    }

    stopRemoteLoop(activeServer.id)
    const store = await deviceStore.readStore()
    const storedServer = getStoredServer(store, activeServer)
    const authToken = transientAuthToken || storedServer?.deviceToken || activeServer.pairingToken
    const registerUrl = new URL('/api/relay/devices/register', activeServer.remoteBaseUrl)
    setConnectionState(activeServer.id, {
      state: 'connecting',
      message: `Registering ${store.deviceId} with ${activeServer.name}.`,
      activeServerId: activeServer.id,
      lastConnectedAt: getConnectionState(activeServer).lastConnectedAt,
      lastError: null,
      remoteBaseUrl: activeServer.remoteBaseUrl
    })

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
        heartbeats.set(
          activeServer.id,
          startHeartbeat({
            capabilities: options.capabilities,
            deviceId: auth.deviceId,
            deviceName: options.deviceName,
            deviceToken: auth.deviceToken,
            logger: ctx.logger,
            pluginScope: ctx.scope,
            remoteBaseUrl: auth.remoteBaseUrl,
            serverId: activeServer.id,
            workspaceFolder: ctx.workspaceFolder
          })
        )
        if (options.capabilities.sessions && ctx.sessions != null) {
          const sessionWorker = createRelaySessionWorker({
            adapter: ctx.sessions,
            auth,
            logger: ctx.logger,
            serverId: activeServer.id
          })
          sessionWorkers.set(activeServer.id, sessionWorker)
          void sessionWorker.runOnce().catch(error => {
            ctx.logger.warn(
              { err: error, scope: ctx.scope, serverId: activeServer.id },
              '[relay] session forwarding bootstrap failed'
            )
          })
        }
        await refreshConfigDistributionStatus({ serverId: activeServer.id })
      }
      setConnectionState(activeServer.id, {
        state: 'registered',
        message: `Device registered with ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: registeredAt,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn({ err: error, scope: ctx.scope, serverId: activeServer.id }, '[relay] device registration failed')
      setConnectionState(activeServer.id, {
        state: 'error',
        message,
        activeServerId: activeServer.id,
        lastConnectedAt: getConnectionState(activeServer).lastConnectedAt,
        lastError: message,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
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

  const disconnect = async (payload?: unknown) => {
    const requestedServerId = readServerId(payload)
    if (requestedServerId !== '') {
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        state = createMissingRemoteState(state, requestedServerId)
        return await getPublicStatus()
      }
      const previousState = getConnectionState(activeServer)
      stopRemoteLoop(activeServer.id)
      setConnectionState(activeServer.id, {
        state: 'idle',
        message: `Relay connection disabled for ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: previousState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
      return await getPublicStatus()
    }

    const options = normalizeOptions(ctx.options)
    const previousState = state
    stopRemoteLoops()
    for (const server of options.servers) {
      const previousServerState = getConnectionState(server)
      connectionStates[server.id] = {
        state: 'idle',
        message: 'Relay connection disabled for this server process.',
        activeServerId: server.id,
        lastConnectedAt: previousServerState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: server.remoteBaseUrl
      }
    }
    for (const [serverId, previousServerState] of Object.entries(connectionStates)) {
      if (options.servers.some(server => server.id === serverId)) continue
      connectionStates[serverId] = {
        state: 'idle',
        message: 'Relay connection disabled for this server process.',
        activeServerId: previousServerState.activeServerId ?? serverId,
        lastConnectedAt: previousServerState.lastConnectedAt,
        lastError: null,
        remoteBaseUrl: previousServerState.remoteBaseUrl
      }
    }
    state = {
      state: 'idle',
      message: 'Relay connections disabled for this server process.',
      activeServerId: previousState.activeServerId,
      lastConnectedAt: previousState.lastConnectedAt,
      lastError: null,
      remoteBaseUrl: previousState.remoteBaseUrl
    }
    return await getPublicStatus()
  }

  const forget = async (payload?: unknown) => {
    const store = await deviceStore.readStore()
    const requestedServerId = readServerId(payload)
    const nextServers = { ...store.servers }
    if (requestedServerId === '') {
      const options = normalizeOptions(ctx.options)
      stopRemoteLoops()
      for (const server of Object.values(nextServers)) {
        nextServers[server.id] = {
          ...server,
          deviceToken: ''
        }
      }
      for (const server of options.servers) {
        connectionStates[server.id] = {
          state: 'idle',
          message: 'Stored relay device tokens removed.',
          activeServerId: server.id,
          lastConnectedAt: null,
          lastError: null,
          remoteBaseUrl: server.remoteBaseUrl
        }
      }
      for (const [serverId, previousServerState] of Object.entries(connectionStates)) {
        if (options.servers.some(server => server.id === serverId)) continue
        connectionStates[serverId] = {
          state: 'idle',
          message: 'Stored relay device tokens removed.',
          activeServerId: previousServerState.activeServerId ?? serverId,
          lastConnectedAt: null,
          lastError: null,
          remoteBaseUrl: previousServerState.remoteBaseUrl
        }
      }
      state = {
        state: 'idle',
        message: 'Stored relay device tokens removed.',
        activeServerId: state.activeServerId,
        lastConnectedAt: null,
        lastError: null,
        remoteBaseUrl: state.remoteBaseUrl
      }
    } else {
      const activeServer = resolveActiveRelayServer(ctx.options, requestedServerId)
      if (activeServer == null) {
        state = createMissingRemoteState(state, requestedServerId)
        return await getPublicStatus()
      }
      const previous = getStoredServer(store, activeServer)
      stopRemoteLoop(activeServer.id)
      nextServers[activeServer.id] = {
        deviceToken: '',
        id: activeServer.id,
        registeredAt: previous?.registeredAt,
        remoteBaseUrl: activeServer.remoteBaseUrl,
        updatedAt: new Date().toISOString()
      }
      setConnectionState(activeServer.id, {
        state: 'idle',
        message: `Stored relay device token removed for ${activeServer.name}.`,
        activeServerId: activeServer.id,
        lastConnectedAt: null,
        lastError: null,
        remoteBaseUrl: activeServer.remoteBaseUrl
      })
    }
    await deviceStore.writeStore({
      deviceId: store.deviceId,
      deviceSecret: store.deviceSecret,
      deviceName: store.deviceName,
      servers: nextServers
    })
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
    refreshConfigDistribution,
    search: payload => [{
      id: 'status',
      title: 'Account status',
      subtitle: `Query: ${toString(isRecord(payload) ? payload.query : undefined) || 'relay'}`,
      icon: 'account_circle'
    }]
  }
}
