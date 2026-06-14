/* eslint-disable max-lines -- Web debug API keeps Chii runtime, target normalization, and devtools URL construction together. */
export interface WebDebugChiiRuntime {
  basePath: string
  consoleUrl: string
  devtoolsAssetVersion?: string
  targetUrl: string
  targetsUrl: string
}

export interface WebDebugTarget {
  favicon: string | null
  id: string
  ip: string | null
  rtc: boolean
  title: string | null
  url: string | null
  userAgent: string | null
}

export interface WebDebugTargetsResponse {
  targets: WebDebugTarget[]
}

export type WebDebugDevtoolsDockSide = 'bottom' | 'left' | 'right'
export type WebDebugDevtoolsDockControlsMode = 'menu'

export interface BuildWebDebugDevtoolsUrlOptions {
  debug?: boolean
  dockControls?: boolean | WebDebugDevtoolsDockControlsMode
  dockSide?: WebDebugDevtoolsDockSide
  toolbarBackgroundColor?: string
  toolbarIconSize?: number
  toolbarTotalHeight?: number
}

const WEB_DEBUG_DEVTOOLS_DEBUG_QUERY_KEYS = ['oneworks_debug', 'oneworks_devtools_debug']
const WEB_DEBUG_DEVTOOLS_DEBUG_STORAGE_KEYS = ['oneworks-devtools-debug', 'oneworks_debug']

const isDebugValueEnabled = (value: string | null) => {
  if (value == null) return false
  const normalizedValue = value.trim().toLowerCase()
  return normalizedValue === '' || (
    normalizedValue !== '0' &&
    normalizedValue !== 'false' &&
    normalizedValue !== 'off' &&
    normalizedValue !== 'no'
  )
}

const readStoredDebugValue = () => {
  if (typeof window === 'undefined') return null

  for (const key of WEB_DEBUG_DEVTOOLS_DEBUG_STORAGE_KEYS) {
    try {
      const storedValue = window.localStorage?.getItem(key) ?? window.sessionStorage?.getItem(key)
      if (storedValue != null) return storedValue
    } catch {
      return null
    }
  }

  return null
}

export const isWebDebugDevtoolsDebugEnabled = () => {
  if (typeof window === 'undefined') return false

  const searchParams = new URLSearchParams(window.location.search)
  for (const key of WEB_DEBUG_DEVTOOLS_DEBUG_QUERY_KEYS) {
    const queryValue = searchParams.get(key)
    if (queryValue != null) return isDebugValueEnabled(queryValue)
  }

  return isDebugValueEnabled(readStoredDebugValue())
}

const debugWebDebugDevtools = (...args: unknown[]) => {
  if (!isWebDebugDevtoolsDebugEnabled()) return
  console.debug('[web-debug]', ...args) // eslint-disable-line no-console
}

const resolveIsolatedBrowserOrigin = (origin: string) => {
  const url = new URL(origin)
  if (url.hostname === '127.0.0.1') {
    url.hostname = 'localhost'
  } else if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1'
  }
  return url.origin
}

const resolveBrowserChiiRuntime = (runtime: WebDebugChiiRuntime): WebDebugChiiRuntime => {
  if (typeof window === 'undefined') return runtime

  const runtimeOrigin = new URL(runtime.consoleUrl).origin
  const browserOrigin = window.location.origin
  const consoleOrigin = runtimeOrigin === browserOrigin
    ? browserOrigin
    : resolveIsolatedBrowserOrigin(runtimeOrigin)
  const targetUrl = new URL(`${runtime.basePath}target.js`, browserOrigin)
  targetUrl.searchParams.set('oneworks_chii_server_url', new URL(runtime.basePath, runtimeOrigin).toString())
  return {
    ...runtime,
    consoleUrl: new URL(runtime.basePath, consoleOrigin).toString(),
    targetUrl: targetUrl.toString(),
    targetsUrl: new URL(`${runtime.basePath}targets`, runtimeOrigin).toString()
  }
}

const createWebDebugClientId = () => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues != null) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('')
  }

  return Math.random().toString(36).slice(2, 10)
}

const setPositiveNumberSearchParam = (url: URL, key: string, value: number | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return
  url.searchParams.set(key, String(Math.round(value * 100) / 100))
}

const setNonEmptySearchParam = (url: URL, key: string, value: string | undefined) => {
  if (value == null || value.trim() === '') return
  url.searchParams.set(key, value.trim())
}

const fetchHostApiJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  const body = await response.json() as unknown
  if (
    body != null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'success' in body &&
    (body as { success?: unknown }).success === true &&
    'data' in body
  ) {
    return (body as { data: T }).data
  }
  return body as T
}

const normalizeWebDebugTargets = (value: unknown): WebDebugTargetsResponse => {
  const targets = (value as Partial<WebDebugTargetsResponse> | null)?.targets
  if (!Array.isArray(targets)) return { targets: [] }

  return {
    targets: targets
      .filter((target): target is WebDebugTarget => (
        target != null &&
        typeof target === 'object' &&
        typeof target.id === 'string' &&
        target.id.trim() !== ''
      ))
      .map(target => ({
        favicon: typeof target.favicon === 'string' && target.favicon !== '' ? target.favicon : null,
        id: target.id,
        ip: typeof target.ip === 'string' && target.ip !== '' ? target.ip : null,
        rtc: target.rtc === true,
        title: typeof target.title === 'string' && target.title !== '' ? target.title : null,
        url: typeof target.url === 'string' && target.url !== '' ? target.url : null,
        userAgent: typeof target.userAgent === 'string' && target.userAgent !== '' ? target.userAgent : null
      }))
  }
}

export const readWebDebugChiiRuntime = async () => {
  const runtime = await fetchHostApiJson<WebDebugChiiRuntime>('/api/web-debug/chii', {
    cache: 'no-store'
  })
  const resolvedRuntime = resolveBrowserChiiRuntime(runtime)
  debugWebDebugDevtools('read chii runtime', resolvedRuntime)
  return resolvedRuntime
}

export const readWebDebugTargets = async (runtime?: WebDebugChiiRuntime) => {
  const resolvedRuntime = runtime ?? await readWebDebugChiiRuntime()
  const response = await fetch(resolvedRuntime.targetsUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to read web debug targets: ${response.status}`)
  const targets = normalizeWebDebugTargets(await response.json())
  debugWebDebugDevtools('read chii targets', {
    targetCount: targets.targets.length,
    targets: targets.targets.map(target => ({
      id: target.id,
      title: target.title,
      url: target.url
    })),
    targetsUrl: resolvedRuntime.targetsUrl
  })
  return targets
}

export const buildWebDebugDevtoolsUrl = (
  runtime: WebDebugChiiRuntime,
  target: Pick<WebDebugTarget, 'id' | 'rtc'>,
  options: BuildWebDebugDevtoolsUrlOptions = {}
) => {
  const consoleUrl = new URL(runtime.consoleUrl)
  const devtoolsUrl = new URL('front_end/chii_app.html', consoleUrl)
  const websocketProtocol = consoleUrl.protocol === 'https:' ? 'wss' : 'ws'
  const isDebugEnabled = options.debug ?? isWebDebugDevtoolsDebugEnabled()
  const clientEndpointUrl = new URL(`${runtime.basePath}client/${createWebDebugClientId()}`, consoleUrl)
  clientEndpointUrl.searchParams.set('target', target.id)
  if (isDebugEnabled) {
    clientEndpointUrl.searchParams.set('oneworks_debug', '1')
  }
  const clientEndpoint = `${clientEndpointUrl.host}${clientEndpointUrl.pathname}${clientEndpointUrl.search}`

  devtoolsUrl.searchParams.set(websocketProtocol, clientEndpoint)
  devtoolsUrl.searchParams.set('rtc', String(target.rtc === true))
  if (typeof window !== 'undefined') {
    devtoolsUrl.searchParams.set('oneworks_host_origin', window.location.origin)
  }
  if (options.dockControls === true) {
    devtoolsUrl.searchParams.set('oneworks_dock_controls', '1')
  } else if (typeof options.dockControls === 'string') {
    devtoolsUrl.searchParams.set('oneworks_dock_controls', options.dockControls)
  }
  if (options.dockSide != null) {
    devtoolsUrl.searchParams.set('oneworks_dock_side', options.dockSide)
  }
  setNonEmptySearchParam(devtoolsUrl, 'oneworks_asset_version', runtime.devtoolsAssetVersion)
  setNonEmptySearchParam(devtoolsUrl, 'oneworks_toolbar_background_color', options.toolbarBackgroundColor)
  setPositiveNumberSearchParam(devtoolsUrl, 'oneworks_toolbar_icon_size', options.toolbarIconSize)
  setPositiveNumberSearchParam(devtoolsUrl, 'oneworks_toolbar_total_height', options.toolbarTotalHeight)
  debugWebDebugDevtools('build devtools url', {
    debug: isDebugEnabled,
    dockControls: options.dockControls,
    dockSide: options.dockSide,
    devtoolsAssetVersion: runtime.devtoolsAssetVersion,
    toolbarBackgroundColor: options.toolbarBackgroundColor,
    toolbarIconSize: options.toolbarIconSize,
    toolbarTotalHeight: options.toolbarTotalHeight,
    targetId: target.id,
    url: devtoolsUrl.toString()
  })
  return devtoolsUrl.toString()
}
