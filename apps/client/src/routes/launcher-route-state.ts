export type LauncherRoutingMode = 'embedded' | 'url'
export type LauncherViewMode = 'about' | 'commands' | 'plugin' | 'preview' | 'settings'

const launcherUrlViewModes = new Set<LauncherViewMode>(['about', 'preview', 'settings'])

const safeDecodePathSegment = (value: string | undefined) => {
  if (value == null || value === '') return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const readLauncherViewModeFromPathname = (pathname: string): LauncherViewMode | undefined => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'launcher') return undefined

  const mode = safeDecodePathSegment(segments[1]) as LauncherViewMode | undefined
  return mode != null && launcherUrlViewModes.has(mode) ? mode : undefined
}

const readLauncherViewModeFromSearch = (search: string): LauncherViewMode | undefined => {
  const mode = new URLSearchParams(search).get('view') as LauncherViewMode | null
  return mode != null && launcherUrlViewModes.has(mode) ? mode : undefined
}

export const buildLauncherViewRoutePath = (mode: LauncherViewMode) => (
  mode === 'about' || mode === 'preview' || mode === 'settings'
    ? `/launcher/${mode}`
    : '/launcher'
)

export const readLauncherViewModeFromLocation = (pathname: string, search: string): LauncherViewMode =>
  readLauncherViewModeFromPathname(pathname) ?? readLauncherViewModeFromSearch(search) ?? 'commands'

export const readLauncherQueryFromSearch = (search: string) => new URLSearchParams(search).get('q') ?? ''

export const readLauncherLocationState = (
  routingMode: LauncherRoutingMode,
  pathname: string,
  search: string
) =>
  routingMode === 'embedded'
    ? { mode: 'commands' as const, query: '' }
    : {
      mode: readLauncherViewModeFromLocation(pathname, search),
      query: readLauncherQueryFromSearch(search)
    }

export const buildLauncherSearchForState = (
  search: string,
  input: {
    mode?: LauncherViewMode
    query?: string
  }
) => {
  const searchParams = new URLSearchParams(search)
  if (input.mode != null) {
    searchParams.delete('view')
    searchParams.delete('path')
  }
  if (input.query != null) {
    if (input.query === '') searchParams.delete('q')
    else searchParams.set('q', input.query)
  }

  const nextSearch = searchParams.toString()
  return nextSearch === '' ? '' : `?${nextSearch}`
}

export const resolveLauncherUrlNavigation = (input: {
  currentHash: string
  currentPathname: string
  currentSearch: string
  mode?: LauncherViewMode
  query?: string
  replace?: boolean
  routingMode: LauncherRoutingMode
}) => {
  if (input.routingMode === 'embedded') return undefined

  const nextSearch = buildLauncherSearchForState(input.currentSearch, input)
  const nextPathname = input.mode == null || input.mode === 'plugin'
    ? input.currentPathname
    : buildLauncherViewRoutePath(input.mode)
  if (nextSearch === input.currentSearch && nextPathname === input.currentPathname) return undefined

  return {
    replace: input.replace === true,
    to: {
      hash: input.currentHash,
      pathname: nextPathname,
      search: nextSearch
    }
  }
}
