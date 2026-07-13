export type PluginPage = 'create' | 'home' | 'list' | 'store'

export const PLUGIN_PATHS = {
  create: '/plugins/create',
  home: '/plugins',
  list: '/plugins/list',
  store: '/plugins/store'
} as const

export interface PluginLocationState {
  page: PluginPage
  pathname: string
  search: string
  shouldReplace: boolean
}

const MARKETPLACE_PLUGIN_ROUTE_PREFIX = 'market:'

const encodeUtf8Hex = (value: string) => (
  [...new TextEncoder().encode(value)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
)

const decodeUtf8Hex = (value: string) => {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/iu.test(value)) return undefined
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

export const createMarketplacePluginRouteKey = (marketplace: string, plugin: string) => (
  `${MARKETPLACE_PLUGIN_ROUTE_PREFIX}${encodeUtf8Hex(JSON.stringify([marketplace, plugin]))}`
)

export const resolveMarketplacePluginRouteKey = (
  value: string
): { marketplace: string; plugin: string } | undefined => {
  if (!value.startsWith(MARKETPLACE_PLUGIN_ROUTE_PREFIX)) return undefined
  const decoded = decodeUtf8Hex(value.slice(MARKETPLACE_PLUGIN_ROUTE_PREFIX.length))
  if (decoded == null) return undefined
  try {
    const parsed: unknown = JSON.parse(decoded)
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !parsed.every(item => typeof item === 'string' && item !== '')
    ) return undefined
    return { marketplace: parsed[0], plugin: parsed[1] }
  } catch {
    return undefined
  }
}

const stripLegacyPageParams = (search: string) => {
  const params = new URLSearchParams(search)
  params.delete('mode')
  const value = params.toString()
  return value === '' ? '' : `?${value}`
}

export const resolvePluginLocation = (pathname: string, search: string): PluginLocationState => {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const legacyMode = new URLSearchParams(search).get('mode')
  const nextSearch = stripLegacyPageParams(search)
  const page: PluginPage = normalizedPathname === PLUGIN_PATHS.home && legacyMode !== 'create'
    ? 'home'
    : normalizedPathname === PLUGIN_PATHS.list || normalizedPathname.startsWith(`${PLUGIN_PATHS.list}/`)
    ? 'list'
    : normalizedPathname === PLUGIN_PATHS.create || (normalizedPathname === '/plugins' && legacyMode === 'create')
    ? 'create'
    : 'store'
  const nextPathname = normalizedPathname === PLUGIN_PATHS.home && legacyMode === 'create'
    ? PLUGIN_PATHS.create
    : normalizedPathname

  return {
    page,
    pathname: nextPathname,
    search: nextSearch,
    shouldReplace: nextPathname !== normalizedPathname || nextSearch !== search
  }
}
