import type { SessionPanelArea } from './session'

export const standaloneDevicesRoutePath = '/standalone/devices'
export const standaloneDeviceSettingsRoutePath = '/standalone/devices/settings'
export const standaloneSessionsRoutePath = '/standalone/sessions'

export type StandaloneDeviceRouteMode = 'devices' | 'settings' | 'debug'
export type StandaloneRouteKind = 'devices' | 'session-tab'

export interface StandaloneDeviceRoute {
  deviceId?: string
  kind: 'devices'
  mode: StandaloneDeviceRouteMode
}

export interface StandaloneSessionTabRoute {
  area: SessionPanelArea
  kind: 'session-tab'
  sessionId: string
  tabId: string
}

export type StandaloneRoute = StandaloneDeviceRoute | StandaloneSessionTabRoute

const sessionPanelAreas = new Set<SessionPanelArea>(['bottom', 'right'])

const decodeRouteSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const readNonEmptyText = (value: string | null | undefined) => {
  const text = value?.trim()
  return text == null || text === '' ? undefined : text
}

const createRouteUrl = (routePath: string) => {
  try {
    return new URL(routePath, 'http://localhost')
  } catch {
    return undefined
  }
}

const isSessionPanelArea = (value: string | undefined): value is SessionPanelArea =>
  value != null && sessionPanelAreas.has(value as SessionPanelArea)

export const buildStandaloneDeviceDebugRoutePath = (deviceId: string) =>
  `${standaloneDevicesRoutePath}/${encodeURIComponent(deviceId)}/debug`

export const buildStandaloneSessionTabRoutePath = ({
  area,
  sessionId,
  tabId
}: {
  area: SessionPanelArea
  sessionId: string
  tabId: string
}) => `${standaloneSessionsRoutePath}/${encodeURIComponent(sessionId)}/panels/${area}/tabs/${encodeURIComponent(tabId)}`

export const buildStandaloneDeviceRoutePath = (
  route: Omit<StandaloneDeviceRoute, 'kind'> = { mode: 'devices' }
) => {
  if (route.mode === 'settings') return standaloneDeviceSettingsRoutePath
  if (route.mode === 'debug' && route.deviceId != null && route.deviceId.trim() !== '') {
    return buildStandaloneDeviceDebugRoutePath(route.deviceId)
  }
  return standaloneDevicesRoutePath
}

export const buildStandaloneRoutePath = (route: StandaloneRoute) => (
  route.kind === 'session-tab'
    ? buildStandaloneSessionTabRoutePath(route)
    : buildStandaloneDeviceRoutePath(route)
)

export const parseStandaloneDeviceRoutePath = (routePath: string): StandaloneDeviceRoute | undefined => {
  const url = createRouteUrl(routePath.trim())
  if (url == null) return undefined

  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'standalone') return undefined
  if (segments[1] !== 'devices') return undefined
  if (segments.length === 2) return { kind: 'devices', mode: 'devices' }
  if (segments.length === 3 && segments[2] === 'settings') return { kind: 'devices', mode: 'settings' }

  const deviceId = readNonEmptyText(segments[2] == null ? undefined : decodeRouteSegment(segments[2]))
  if (deviceId == null) return undefined
  if (segments.length === 4 && segments[3] === 'debug') return { deviceId, kind: 'devices', mode: 'debug' }
  return undefined
}

export const parseStandaloneSessionTabRoutePath = (routePath: string): StandaloneSessionTabRoute | undefined => {
  const url = createRouteUrl(routePath.trim())
  if (url == null) return undefined

  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'standalone' || segments[1] !== 'sessions') return undefined

  const sessionId = readNonEmptyText(segments[2] == null ? undefined : decodeRouteSegment(segments[2]))
  const area = segments[4]
  const tabId = readNonEmptyText(segments[6] == null ? undefined : decodeRouteSegment(segments[6]))
  if (
    sessionId == null ||
    segments[3] !== 'panels' ||
    !isSessionPanelArea(area) ||
    segments[5] !== 'tabs' ||
    tabId == null ||
    segments.length !== 7
  ) {
    return undefined
  }

  return { area, kind: 'session-tab', sessionId, tabId }
}

export const parseStandaloneRoutePath = (routePath: string): StandaloneRoute | undefined =>
  parseStandaloneDeviceRoutePath(routePath) ?? parseStandaloneSessionTabRoutePath(routePath)

export const normalizeStandaloneDeviceRoutePath = (routePath: string) => {
  const trimmedRoutePath = routePath.trim()
  if (trimmedRoutePath === 'devices') return standaloneDevicesRoutePath
  const route = parseStandaloneDeviceRoutePath(trimmedRoutePath)
  return route == null ? undefined : buildStandaloneDeviceRoutePath(route)
}

export const normalizeStandaloneRoutePath = (routePath: string) => {
  const trimmedRoutePath = routePath.trim()
  if (trimmedRoutePath === 'devices') return standaloneDevicesRoutePath
  const route = parseStandaloneRoutePath(trimmedRoutePath)
  return route == null ? undefined : buildStandaloneRoutePath(route)
}

export const isStandaloneDeviceRoutePath = (routePath: string) => parseStandaloneDeviceRoutePath(routePath) != null

export const isStandaloneRoutePath = (routePath: string) => parseStandaloneRoutePath(routePath) != null
