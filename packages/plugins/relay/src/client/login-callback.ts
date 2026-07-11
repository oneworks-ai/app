import type { RelayLoginCallback } from './types.js'

export const isDesktopRuntime = () => (
  typeof window !== 'undefined' &&
  (window as { oneworksDesktop?: unknown }).oneworksDesktop != null
)

const readSearchAndHashParams = () => ({
  hash: new URLSearchParams(window.location.hash.replace(/^#/, '')),
  search: new URLSearchParams(window.location.search)
})

const normalizeClientBase = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || text === '/') return ''
  return `/${text.replace(/^\/+|\/+$/g, '')}`
}

const readRuntimeClientBase = () => {
  const runtimeEnv = (globalThis as {
    __ONEWORKS_PROJECT_RUNTIME_ENV__?: {
      __ONEWORKS_PROJECT_CLIENT_BASE__?: unknown
    }
  }).__ONEWORKS_PROJECT_RUNTIME_ENV__
  return normalizeClientBase(runtimeEnv?.__ONEWORKS_PROJECT_CLIENT_BASE__)
}

const readDocumentBase = () => {
  const querySelector = typeof document === 'undefined' ? undefined : document.querySelector?.bind(document)
  const href = querySelector?.('base')?.getAttribute('href')
  if (href == null || href.trim() === '') return ''
  try {
    return normalizeClientBase(new URL(href, window.location.href).pathname)
  } catch {
    return ''
  }
}

const inferClientBaseFromPath = (pathname: string, scope: string) => {
  const marker = `/plugins/${encodeURIComponent(scope)}/`
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex > 0) return normalizeClientBase(pathname.slice(0, markerIndex))
  if (pathname === '/ui' || pathname.startsWith('/ui/')) return '/ui'
  return ''
}

const buildLoginRedirectUri = (url: URL, serverId?: string) => {
  url.hash = ''
  url.searchParams.set('relayLogin', '1')
  if (serverId == null || serverId === '') {
    url.searchParams.delete('relayLoginServerId')
  } else {
    url.searchParams.set('relayLoginServerId', serverId)
  }
  url.searchParams.delete('relay_token')
  return url.toString()
}

export const buildWebLoginRedirectUri = (serverId?: string) => {
  return buildLoginRedirectUri(new URL(window.location.href), serverId)
}

export const buildPluginHomeWebLoginRedirectUri = (scope: string, serverId?: string) => {
  const url = new URL(window.location.href)
  const basePath = readRuntimeClientBase() || readDocumentBase() || inferClientBaseFromPath(url.pathname, scope)
  url.pathname = `${basePath}/plugins/${encodeURIComponent(scope)}/home`
  url.search = ''
  return buildLoginRedirectUri(url, serverId)
}

const readLoginCallbackFromParams = (
  params: ReturnType<typeof readSearchAndHashParams>
): RelayLoginCallback | undefined => {
  const token = params.hash.get('relay_token') || params.search.get('relay_token') || ''
  if (token === '') return undefined
  return {
    serverId: params.search.get('relayLoginServerId') ?? params.hash.get('relayLoginServerId') ?? undefined,
    token
  }
}

export const readLoginCallback = (): RelayLoginCallback | undefined =>
  readLoginCallbackFromParams(readSearchAndHashParams())

export const readLoginCallbackFromUrl = (value: string): RelayLoginCallback | undefined => {
  try {
    const url = new URL(value, window.location.href)
    return readLoginCallbackFromParams({
      hash: new URLSearchParams(url.hash.replace(/^#/, '')),
      search: url.searchParams
    })
  } catch {
    return undefined
  }
}

export const clearLoginCallbackFromUrl = () => {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  hash.delete('relay_token')
  hash.delete('relayLoginServerId')
  url.hash = hash.toString()
  url.searchParams.delete('relay_token')
  url.searchParams.delete('relayLogin')
  url.searchParams.delete('relayLoginServerId')
  window.history.replaceState(null, '', url.toString())
}
