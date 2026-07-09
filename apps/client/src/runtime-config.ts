export type RuntimeEnv = Partial<{
  __ONEWORKS_PROJECT_SERVER_BASE_URL__: string
  __ONEWORKS_PROJECT_SERVER_HOST__: string
  __ONEWORKS_PROJECT_SERVER_PORT__: string
  __ONEWORKS_PROJECT_SERVER_ROLE__: string
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: string
  __ONEWORKS_PROJECT_CLIENT_MODE__: string
  __ONEWORKS_PROJECT_CLIENT_BASE__: string
  __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__: string
  __ONEWORKS_PROJECT_CLIENT_VERSION__: string
  __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: string
  __ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__: string
  __ONEWORKS_PROJECT_WORKSPACE_ID__: string
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: string
}>

export const SERVER_BASE_URL_STORAGE_KEY = 'oneworks_server_base_url'
export const SERVER_CONNECTION_PICKER_STORAGE_KEY = 'oneworks_server_connection_picker_requested'

export const resolveDevDocumentTitle = (
  baseTitle: string,
  input: {
    isDev: boolean
    gitRef?: string
  }
) => {
  const normalizedBaseTitle = (baseTitle.trim() === '' ? 'One Works Web' : baseTitle.trim())
    .replace(/\s+\[[^\]]+\]$/, '')
  if (!input.isDev) {
    return normalizedBaseTitle
  }

  const gitRef = input.gitRef?.trim()
  if (gitRef == null || gitRef === '') {
    return normalizedBaseTitle
  }

  return `${normalizedBaseTitle} [${gitRef}]`
}

const getGlobalRuntimeEnv = () => {
  const globalScope = globalThis as { __ONEWORKS_PROJECT_RUNTIME_ENV__?: RuntimeEnv }
  return globalScope.__ONEWORKS_PROJECT_RUNTIME_ENV__
}

export const mergeRuntimeEnv = (patch: RuntimeEnv) => {
  const globalScope = globalThis as { __ONEWORKS_PROJECT_RUNTIME_ENV__?: RuntimeEnv }
  const nextRuntimeEnv = {
    ...(globalScope.__ONEWORKS_PROJECT_RUNTIME_ENV__ ?? {}),
    ...patch
  }
  globalScope.__ONEWORKS_PROJECT_RUNTIME_ENV__ = nextRuntimeEnv
  return nextRuntimeEnv
}

const pickNonEmptyValue = (...values: Array<string | undefined>) => (
  values.find((value) => typeof value === 'string' && value.trim() !== '')
)

const normalizeBase = (value?: string) => {
  let base = value?.trim() ?? '/ui'
  if (!base.startsWith('/')) {
    base = `/${base}`
  }
  if (base.length > 1 && base.endsWith('/')) {
    base = base.slice(0, -1)
  }
  return base
}

const normalizePath = (value?: string) => {
  let next = value?.trim() ?? ''
  if (!next) {
    return '/ws'
  }
  if (!next.startsWith('/')) {
    next = `/${next}`
  }
  return next
}

const normalizeServerHost = (value?: string) => {
  const next = value?.trim()
  if (next == null || next === '' || next === '0.0.0.0' || next === '::' || next === '[::]') {
    return undefined
  }
  return next
}

const hasUrlProtocol = (value: string) => /^[a-z][a-z\d+.-]*:\/\//i.test(value)

const getStorage = () => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const getBrowserProtocol = () => (
  globalThis.location?.protocol === 'https:' ? 'https' : 'http'
)

const getClientMode = () => (
  pickNonEmptyValue(
    getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_MODE__,
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_MODE__,
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_DEPLOY_MODE__
  )?.trim().toLowerCase()
)

const isDevClientMode = () => getClientMode() === 'dev'

const isDevServerClient = () => (
  isDevClientMode() ||
  /^(?:1|true|yes|on)$/i.test(
    pickNonEmptyValue(
      getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_DEV_SERVER__,
      import.meta.env.__ONEWORKS_PROJECT_CLIENT_DEV_SERVER__
    ) ?? ''
  )
)

export const normalizeServerBaseUrl = (value?: string) => {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    return undefined
  }

  const rawUrl = hasUrlProtocol(trimmed) ? trimmed : `${getBrowserProtocol()}://${trimmed}`
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined
    }
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export const createServerUrlFromBase = (baseUrl: string, path: string) => {
  const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl)
  if (normalizedBaseUrl == null) {
    throw new Error('Invalid server base URL')
  }

  const relativePath = path.replace(/^\/+/, '')
  return new URL(relativePath, `${normalizedBaseUrl}/`).toString()
}

export const getStoredServerBaseUrl = () => (
  normalizeServerBaseUrl(getStorage()?.getItem(SERVER_BASE_URL_STORAGE_KEY) ?? undefined)
)

export const setStoredServerBaseUrl = (value: string) => {
  const normalized = normalizeServerBaseUrl(value)
  if (normalized == null) {
    return undefined
  }
  getStorage()?.setItem(SERVER_BASE_URL_STORAGE_KEY, normalized)
  return normalized
}

export const clearStoredServerBaseUrl = () => {
  getStorage()?.removeItem(SERVER_BASE_URL_STORAGE_KEY)
}

export const getRuntimeManagerServerBaseUrl = () => (
  normalizeServerBaseUrl(getRuntimeEnv().__ONEWORKS_PROJECT_MANAGER_SERVER_BASE_URL__)
)

export const isStandaloneClientMode = () => {
  const mode = getClientMode()
  return mode === 'standalone' || mode === 'independent'
}

export const isDesktopClientMode = () => getClientMode() === 'desktop'

export const getServerRole = () => (
  pickNonEmptyValue(
    getRuntimeEnv().__ONEWORKS_PROJECT_SERVER_ROLE__,
    import.meta.env.__ONEWORKS_PROJECT_SERVER_ROLE__
  )?.trim().toLowerCase()
)

export const isServerManagerRole = () => getServerRole() === 'manager'

export const isServerConnectionManagedClientMode = () => {
  const mode = getClientMode()
  return mode === 'standalone' || mode === 'independent' || mode === 'desktop' || isServerManagerRole()
}

export const getRuntimeEnv = (): RuntimeEnv => getGlobalRuntimeEnv() ?? {}

export const resolveClientBase = (...values: Array<string | undefined>) => (
  normalizeBase(pickNonEmptyValue(...values))
)

export const getClientBase = () => (
  resolveClientBase(
    getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_BASE__,
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_BASE__,
    import.meta.env.BASE_URL,
    '/ui'
  )
)

export const WORKSPACE_CLIENT_ROUTE_SEGMENT = 'w'

export const normalizeWorkspaceId = (value?: string) => {
  const trimmedValue = value?.trim()
  if (trimmedValue == null || trimmedValue === '') {
    return undefined
  }
  return /^w_[\w-]{8,64}$/u.test(trimmedValue) ? trimmedValue : undefined
}

export const getRuntimeWorkspaceId = () => (
  normalizeWorkspaceId(getRuntimeEnv().__ONEWORKS_PROJECT_WORKSPACE_ID__)
)

export const buildWorkspaceClientBase = (
  workspaceId: string,
  clientBase = resolveClientBase(
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_BASE__,
    import.meta.env.BASE_URL,
    '/ui'
  )
) => {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  if (normalizedWorkspaceId == null) {
    throw new Error('Invalid workspace id')
  }
  const normalizedClientBase = normalizeBase(clientBase)
  const workspacePath = `${WORKSPACE_CLIENT_ROUTE_SEGMENT}/${encodeURIComponent(normalizedWorkspaceId)}`
  return normalizedClientBase === '/'
    ? `/${workspacePath}`
    : `${normalizedClientBase}/${workspacePath}`
}

export const resolveWorkspaceIdFromPathname = (
  pathname: string,
  clientBase = resolveClientBase(
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_BASE__,
    import.meta.env.BASE_URL,
    '/ui'
  )
) => {
  const normalizedBase = normalizeBase(clientBase)
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  const relativePath = normalizedBase === '/'
    ? normalizedPathname
    : normalizedPathname === normalizedBase
    ? '/'
    : normalizedPathname.startsWith(`${normalizedBase}/`)
    ? normalizedPathname.slice(normalizedBase.length)
    : ''

  const [segment, workspaceId] = relativePath.split('/').filter(Boolean)
  if (segment !== WORKSPACE_CLIENT_ROUTE_SEGMENT) {
    return undefined
  }
  if (workspaceId == null) {
    return undefined
  }
  try {
    return normalizeWorkspaceId(decodeURIComponent(workspaceId))
  } catch {
    return undefined
  }
}

export const getServerHostEnv = () =>
  normalizeServerHost(
    getRuntimeEnv().__ONEWORKS_PROJECT_SERVER_HOST__ ??
      import.meta.env.__ONEWORKS_PROJECT_SERVER_HOST__
  )

export const getServerPortEnv = () =>
  getRuntimeEnv().__ONEWORKS_PROJECT_SERVER_PORT__ ??
    import.meta.env.__ONEWORKS_PROJECT_SERVER_PORT__

const getExplicitServerBaseUrl = () => (
  normalizeServerBaseUrl(
    getRuntimeEnv().__ONEWORKS_PROJECT_SERVER_BASE_URL__ ??
      import.meta.env.__ONEWORKS_PROJECT_SERVER_BASE_URL__
  )
)

export const getConfiguredServerBaseUrl = () => {
  const explicitServerBaseUrl = getExplicitServerBaseUrl()
  if (explicitServerBaseUrl != null) {
    return explicitServerBaseUrl
  }

  const serverHost = getServerHostEnv()
  const serverPort = getServerPortEnv()?.trim()
  if (serverHost == null || serverPort == null || serverPort === '') {
    return undefined
  }

  return normalizeServerBaseUrl(`${serverHost}:${serverPort}`)
}

export const isServerConnectionPickerRequested = () => (
  getStorage()?.getItem(SERVER_CONNECTION_PICKER_STORAGE_KEY) === 'true'
)

export const requestServerConnectionPicker = (
  { clearCurrentServer = false }: { clearCurrentServer?: boolean } = {}
) => {
  if (clearCurrentServer) {
    clearStoredServerBaseUrl()
  }
  getStorage()?.setItem(SERVER_CONNECTION_PICKER_STORAGE_KEY, 'true')
}

export const clearServerConnectionPickerRequest = () => {
  getStorage()?.removeItem(SERVER_CONNECTION_PICKER_STORAGE_KEY)
}

export const getServerWsPath = () =>
  normalizePath(
    getRuntimeEnv().__ONEWORKS_PROJECT_SERVER_WS_PATH__ ?? import.meta.env.__ONEWORKS_PROJECT_SERVER_WS_PATH__
  )

export const getServerBaseUrl = () => {
  const configuredServerBaseUrl = getConfiguredServerBaseUrl()
  const explicitServerBaseUrl = getExplicitServerBaseUrl()
  if (isDesktopClientMode()) {
    if (explicitServerBaseUrl != null) {
      return explicitServerBaseUrl
    }

    if (isDevServerClient() && globalThis.location?.origin != null) {
      return globalThis.location.origin
    }

    if (configuredServerBaseUrl != null) {
      return configuredServerBaseUrl
    }

    const serverHost = getServerHostEnv() ?? 'localhost'
    const serverPort = getServerPortEnv() ?? '8787'
    return normalizeServerBaseUrl(`${serverHost}:${serverPort}`) ?? `${getBrowserProtocol()}://localhost:8787`
  }

  if (explicitServerBaseUrl != null) {
    return explicitServerBaseUrl
  }

  if (isServerConnectionManagedClientMode()) {
    const storedServerBaseUrl = getStoredServerBaseUrl()
    if (storedServerBaseUrl != null) {
      return storedServerBaseUrl
    }
  }

  if (configuredServerBaseUrl != null) {
    if (explicitServerBaseUrl != null || !isDevServerClient()) {
      return configuredServerBaseUrl
    }
  }

  if (isDevServerClient() && globalThis.location?.origin != null) {
    return globalThis.location.origin
  }

  if (configuredServerBaseUrl != null) {
    return configuredServerBaseUrl
  }

  const serverHost = getServerHostEnv() ?? globalThis.location?.hostname ?? 'localhost'
  const serverPort = getServerPortEnv() ?? '8787'
  return normalizeServerBaseUrl(`${serverHost}:${serverPort}`) ?? `${getBrowserProtocol()}://localhost:8787`
}

export const createServerUrl = (path: string) => createServerUrlFromBase(getServerBaseUrl(), path)
