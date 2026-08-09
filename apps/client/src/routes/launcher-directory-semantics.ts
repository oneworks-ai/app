/* eslint-disable max-lines -- Directory command, breadcrumb, and URL semantics stay in one testable boundary. */
export type LauncherDirectoryBrowserMode = 'clone' | 'create-workspace' | 'open-workspace'

export type LauncherDirectoryCommandActionLabel =
  | 'back'
  | 'clone'
  | 'create'
  | 'enter-directory'
  | 'open-as-project'

export type LauncherDirectoryCommandOperation =
  | 'clone'
  | 'create-workspace'
  | 'enter-directory'
  | 'open-workspace'

interface LauncherDirectoryCommandAction {
  icon: string
  label: LauncherDirectoryCommandActionLabel
  operation: LauncherDirectoryCommandOperation
}

interface ResolveLauncherDirectoryCommandSemanticsOptions {
  isBackAction?: boolean
  mode: LauncherDirectoryBrowserMode
  showSecondaryAction?: boolean
}

export interface LauncherDirectoryCommandSemantics {
  primary: LauncherDirectoryCommandAction
  secondary?: LauncherDirectoryCommandAction
}

export interface LauncherDirectoryRouteState {
  directory?: string
  mode: LauncherDirectoryBrowserMode
  targetId: string
}

const LAUNCHER_DIRECTORY_PATH_SEARCH_PARAM = 'path'
const LAUNCHER_QUERY_SEARCH_PARAM = 'q'
const LAUNCHER_VIEW_SEARCH_PARAM = 'view'

const safeDecodeLauncherPathSegment = (value: string | undefined) => {
  if (value == null || value === '') return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const encodeLauncherPathSegment = (value: string) => encodeURIComponent(value)

export const resolveLauncherDirectoryCommandSemantics = ({
  isBackAction = false,
  mode,
  showSecondaryAction = true
}: ResolveLauncherDirectoryCommandSemanticsOptions): LauncherDirectoryCommandSemantics => {
  if (isBackAction) {
    return {
      primary: {
        icon: 'keyboard_return',
        label: 'back',
        operation: 'enter-directory'
      }
    }
  }

  if (mode === 'open-workspace') {
    return {
      primary: {
        icon: 'chevron_right',
        label: 'enter-directory',
        operation: 'enter-directory'
      },
      ...(showSecondaryAction
        ? {
          secondary: {
            icon: 'folder_open',
            label: 'open-as-project',
            operation: 'open-workspace' as const
          }
        }
        : {})
    }
  }

  return {
    primary: mode === 'clone'
      ? {
        icon: 'keyboard_return',
        label: 'clone',
        operation: 'clone'
      }
      : {
        icon: 'keyboard_return',
        label: 'create',
        operation: 'create-workspace'
      },
    ...(showSecondaryAction
      ? {
        secondary: {
          icon: 'chevron_right',
          label: 'enter-directory',
          operation: 'enter-directory' as const
        }
      }
      : {})
  }
}

export const buildLauncherDirectoryBreadcrumbs = (directory: string) => {
  if (directory === '') return []

  const separator = directory.includes('\\') ? '\\' : '/'
  const windowsUncMatch = /^([\\/]{2}[^\\/]+[\\/][^\\/]+)/u.exec(directory)
  if (windowsUncMatch != null) {
    const authorityPath = windowsUncMatch[1]
    const segments = directory
      .slice(authorityPath.length)
      .replace(/^[\\/]+/u, '')
      .split(/[\\/]+/u)
      .filter(segment => segment !== '')
    return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
      const previousPath = breadcrumbs.at(-1)?.path ?? authorityPath
      breadcrumbs.push({
        label: segment,
        path: `${previousPath}${separator}${segment}`
      })
      return breadcrumbs
    }, [{ label: authorityPath, path: authorityPath }])
  }

  const windowsDriveMatch = /^([a-z]:)/iu.exec(directory)
  if (windowsDriveMatch != null) {
    const drivePrefix = windowsDriveMatch[1]
    const rootPath = `${drivePrefix}${separator}`
    const segments = directory
      .slice(drivePrefix.length)
      .replace(/^[\\/]+/u, '')
      .split(/[\\/]+/u)
      .filter(segment => segment !== '')
    return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
      const previousPath = breadcrumbs.at(-1)?.path ?? rootPath
      breadcrumbs.push({
        label: segment,
        path: previousPath.endsWith(separator) ? `${previousPath}${segment}` : `${previousPath}${separator}${segment}`
      })
      return breadcrumbs
    }, [{ label: rootPath, path: rootPath }])
  }

  if (directory.startsWith('/')) {
    const segments = directory.replace(/\/+$/u, '').slice(1).split('/').filter(segment => segment !== '')
    return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
      const previousPath = breadcrumbs.at(-1)?.path ?? '/'
      breadcrumbs.push({
        label: segment,
        path: previousPath === '/' ? `/${segment}` : `${previousPath}/${segment}`
      })
      return breadcrumbs
    }, [{ label: '/', path: '/' }])
  }

  const segments = directory.replace(/[\\/]+$/u, '').split(/[\\/]+/u).filter(segment => segment !== '')
  return segments.reduce<Array<{ label: string; path: string }>>((breadcrumbs, segment) => {
    const previousPath = breadcrumbs.at(-1)?.path
    breadcrumbs.push({
      label: segment,
      path: previousPath == null ? segment : `${previousPath}${separator}${segment}`
    })
    return breadcrumbs
  }, [])
}

export const isLauncherAbsoluteDirectoryPath = (directory: string) => {
  return directory.startsWith('/') ||
    /^[a-z]:[\\/]/iu.test(directory) ||
    /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(directory)
}

export const resolveLauncherDirectoryPathInput = (directory: string | undefined) => {
  return directory == null || directory.trim() === '' ? undefined : directory
}

const normalizeLauncherDirectoryPathIdentity = (directory: string) => {
  const isUncPath = /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(directory)
  const rootFamily = isUncPath
    ? 'unc'
    : /^[a-z]:[\\/]/iu.test(directory)
    ? 'drive'
    : directory.startsWith('/')
    ? 'rooted'
    : 'relative'
  const pathWithoutUncAuthorityPrefix = isUncPath ? directory.slice(2) : directory
  const normalizedDirectory = pathWithoutUncAuthorityPrefix
    .replace(/[\\/]+/gu, '/')
    .replace(/\/+$/u, '') || '/'
  const normalizedPath = rootFamily === 'drive'
    ? normalizedDirectory.toLowerCase()
    : normalizedDirectory
  return `${rootFamily}:${normalizedPath}`
}

export const areLauncherDirectoryPathsEquivalent = (left: string, right: string) => {
  return normalizeLauncherDirectoryPathIdentity(left) === normalizeLauncherDirectoryPathIdentity(right)
}

export const parseLauncherDirectoryPathList = (value: unknown) => {
  if (!Array.isArray(value)) return []

  const seenDirectories = new Set<string>()
  return value.flatMap((candidate) => {
    const directory = typeof candidate === 'string'
      ? resolveLauncherDirectoryPathInput(candidate)
      : undefined
    if (directory == null || seenDirectories.has(directory)) return []

    seenDirectories.add(directory)
    return [directory]
  })
}

export const rememberLauncherDirectoryPath = (
  directories: string[],
  directory: string,
  limit: number
) => {
  const resolvedDirectory = resolveLauncherDirectoryPathInput(directory)
  if (resolvedDirectory == null) return directories

  return [
    resolvedDirectory,
    ...directories.filter(candidate => candidate !== resolvedDirectory)
  ].slice(0, limit)
}

export const readLauncherDirectoryRouteState = (
  pathname: string,
  search: string
): LauncherDirectoryRouteState | undefined => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'launcher' || segments[1] !== 'browse') return undefined

  const mode = safeDecodeLauncherPathSegment(segments[2]) as LauncherDirectoryBrowserMode | undefined
  if (mode !== 'clone' && mode !== 'create-workspace' && mode !== 'open-workspace') return undefined

  const encodedDirectory = segments.slice(4).join('/')
  const legacyDirectory = new URLSearchParams(search).get(LAUNCHER_DIRECTORY_PATH_SEARCH_PARAM)
  const directory = safeDecodeLauncherPathSegment(encodedDirectory) ??
    (legacyDirectory == null || legacyDirectory === '' ? undefined : legacyDirectory)

  return {
    ...(directory == null ? {} : { directory }),
    mode,
    targetId: safeDecodeLauncherPathSegment(segments[3]) ?? 'local'
  }
}

export const buildLauncherDirectoryRoutePath = (
  mode: LauncherDirectoryBrowserMode,
  targetId: string,
  directory?: string
) => {
  const routePath = `/launcher/browse/${encodeLauncherPathSegment(mode)}/${encodeLauncherPathSegment(targetId)}`
  return directory == null || directory === ''
    ? routePath
    : `${routePath}/${encodeLauncherPathSegment(directory)}`
}

export const buildLauncherDirectoryRouteSearch = (search: string) => {
  const searchParams = new URLSearchParams(search)
  searchParams.delete(LAUNCHER_VIEW_SEARCH_PARAM)
  searchParams.delete(LAUNCHER_QUERY_SEARCH_PARAM)
  searchParams.delete(LAUNCHER_DIRECTORY_PATH_SEARCH_PARAM)

  const nextSearch = searchParams.toString()
  return nextSearch === '' ? '' : `?${nextSearch}`
}

export const resolveLauncherDirectoryRouteReplacement = ({
  directory,
  mode,
  pathname,
  search,
  targetId
}: {
  directory?: string
  mode: LauncherDirectoryBrowserMode
  pathname: string
  search: string
  targetId: string
}) => {
  const nextPathname = buildLauncherDirectoryRoutePath(mode, targetId, directory)
  const nextSearch = buildLauncherDirectoryRouteSearch(search)
  if (nextPathname === pathname && nextSearch === search) return undefined

  return {
    pathname: nextPathname,
    replace: true as const,
    search: nextSearch
  }
}
