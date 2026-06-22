import type { LaunchRequest } from './types'

export const desktopDeepLinkSchemes = ['oneworks', 'one-works'] as const

const desktopDeepLinkProtocols = new Set(desktopDeepLinkSchemes.map(scheme => `${scheme}:`))

const readHashToken = (url: URL) => {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  return hash.get('relay_token') || url.searchParams.get('relay_token') || ''
}

const buildStandaloneRoutePath = (url: URL) => {
  if (url.hostname !== 'standalone') return undefined
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname !== '/mobile-debug') return undefined
  const route = new URL('/standalone/mobile-debug', 'http://localhost')
  const deviceId = url.searchParams.get('deviceId')?.trim()
  if (deviceId != null && deviceId !== '') route.searchParams.set('deviceId', deviceId)
  return `${route.pathname}${route.search}`
}

const buildRelayPluginRoutePath = (url: URL) => {
  const token = readHashToken(url)
  const scope = url.searchParams.get('scope')?.trim() || 'relay'
  const serverId = url.searchParams.get('serverId')?.trim() || ''
  const route = new URL(`/plugins/${encodeURIComponent(scope)}/home`, 'http://localhost')
  route.searchParams.set('relayLogin', '1')
  if (serverId !== '') route.searchParams.set('relayLoginServerId', serverId)
  if (token !== '') {
    route.hash = new URLSearchParams({ relay_token: token }).toString()
  }
  return `${route.pathname.replace(/^\/+/, '')}${route.search}${route.hash}`
}

export const parseDesktopDeepLinkLaunchRequest = (rawUrl: string): LaunchRequest | undefined => {
  if (rawUrl.trim() === '') return undefined

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }

  if (!desktopDeepLinkProtocols.has(url.protocol)) return undefined
  const standaloneRoutePath = buildStandaloneRoutePath(url)
  if (standaloneRoutePath != null) return { standaloneRoutePath }

  const isRelayAuthRoute = url.hostname === 'relay' && url.pathname.replace(/\/+$/, '') === '/auth'
  if (!isRelayAuthRoute) return undefined

  const workspaceFolder = url.searchParams.get('workspace')?.trim() || undefined
  if (workspaceFolder == null) return undefined
  return {
    routePath: buildRelayPluginRoutePath(url),
    workspaceFolder
  }
}

export const findDesktopDeepLinkArg = (argv: string[]) => (
  argv.find(arg => parseDesktopDeepLinkLaunchRequest(arg) != null)
)
