import type { RelayLoginCallback } from './types.js'

export const isDesktopRuntime = () => (
  (window as { oneworksDesktop?: unknown }).oneworksDesktop != null
)

const readSearchAndHashParams = () => ({
  hash: new URLSearchParams(window.location.hash.replace(/^#/, '')),
  search: new URLSearchParams(window.location.search)
})

export const buildWebLoginRedirectUri = (serverId?: string) => {
  const url = new URL(window.location.href)
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

export const readLoginCallback = (): RelayLoginCallback | undefined => {
  const params = readSearchAndHashParams()
  const token = params.hash.get('relay_token') || params.search.get('relay_token') || ''
  if (token === '') return undefined
  return {
    serverId: params.search.get('relayLoginServerId') ?? params.hash.get('relayLoginServerId') ?? undefined,
    token
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
