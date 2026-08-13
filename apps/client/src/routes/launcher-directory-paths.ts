import { getFilesystemPathDisplayName } from '#~/utils/filesystem-path-identity'

export interface LauncherDirectoryBreadcrumb {
  label: string
  path: string
}

type DirectoryRootKind = 'drive' | 'drive-relative' | 'posix' | 'relative' | 'unc' | 'windows-rooted'

interface DirectoryRoot {
  end: number
  kind: DirectoryRootKind
  path: string
}

export const hasNonBlankDirectoryPath = (directory: string | null | undefined): directory is string => (
  directory != null && directory.trim() !== ''
)

const readDirectoryRoot = (directory: string): DirectoryRoot => {
  const uncMatch = /^([\\/])\1([^\\/]+)[\\/]+([^\\/]+)/u.exec(directory)
  if (uncMatch != null) {
    return { end: uncMatch[0].length, kind: 'unc', path: uncMatch[0] }
  }

  const driveMatch = /^[a-z]:[\\/]+/iu.exec(directory)
  if (driveMatch != null) {
    return { end: driveMatch[0].length, kind: 'drive', path: driveMatch[0] }
  }

  const driveRelativeMatch = /^[a-z]:/iu.exec(directory)
  if (driveRelativeMatch != null) {
    return { end: driveRelativeMatch[0].length, kind: 'drive-relative', path: driveRelativeMatch[0] }
  }

  const posixMatch = /^\/+/u.exec(directory)
  if (posixMatch != null) {
    return { end: posixMatch[0].length, kind: 'posix', path: posixMatch[0] }
  }

  const windowsRootMatch = /^\\+/u.exec(directory)
  if (windowsRootMatch != null) {
    return { end: windowsRootMatch[0].length, kind: 'windows-rooted', path: windowsRootMatch[0] }
  }

  return { end: 0, kind: 'relative', path: '' }
}

export const getDirectoryDisplayName = (directory: string) => {
  return getFilesystemPathDisplayName(directory) ?? directory
}

export const normalizeDirectoryPathKey = (directory: string) => {
  const root = readDirectoryRoot(directory)
  const windowsFamily = root.kind === 'drive' || root.kind === 'drive-relative' || root.kind === 'unc' ||
    root.kind === 'windows-rooted'
  const normalizedSeparators = windowsFamily ? directory.replace(/[\\/]+/gu, '/') : directory.replace(/\/+/gu, '/')
  const normalizedPath = normalizedSeparators.replace(/\/+$/u, '') || (root.kind === 'relative' ? '' : '/')
  if (
    root.kind === 'drive' || root.kind === 'drive-relative' || root.kind === 'unc' || root.kind === 'windows-rooted'
  ) {
    return `${root.kind}:${normalizedPath.toLowerCase()}`
  }
  return `${root.kind}:${normalizedPath}`
}

export const buildDirectoryBreadcrumbs = (directory: string): LauncherDirectoryBreadcrumb[] => {
  if (!hasNonBlankDirectoryPath(directory)) return []
  const root = readDirectoryRoot(directory)
  const breadcrumbs: LauncherDirectoryBreadcrumb[] = root.kind === 'relative'
    ? []
    : [{ label: root.path, path: root.path }]
  const segmentPattern =
    root.kind === 'drive' || root.kind === 'drive-relative' || root.kind === 'unc' || root.kind === 'windows-rooted'
      ? /[^\\/]+/gu
      : /[^/]+/gu
  segmentPattern.lastIndex = root.end
  for (let match = segmentPattern.exec(directory); match != null; match = segmentPattern.exec(directory)) {
    const segment = match[0]
    const path = directory.slice(0, match.index + segment.length)
    breadcrumbs.push({ label: segment, path })
  }
  return breadcrumbs
}

export const isDirectoryPathInSameParent = (directory: string, parentDirectory: string) => {
  const parentBreadcrumb = buildDirectoryBreadcrumbs(directory).at(-2)
  return parentBreadcrumb != null &&
    normalizeDirectoryPathKey(parentBreadcrumb.path) === normalizeDirectoryPathKey(parentDirectory)
}

export const isLikelyAbsoluteDirectoryPath = (directory: string) => (
  hasNonBlankDirectoryPath(directory) && readDirectoryRoot(directory).kind !== 'relative'
)

export const buildLauncherDirectoryRoutePath = (
  mode: string,
  targetId: string,
  directory?: string
) => {
  const routePath = `/launcher/browse/${encodeURIComponent(mode)}/${encodeURIComponent(targetId)}`
  return hasNonBlankDirectoryPath(directory)
    ? `${routePath}/${encodeURIComponent(directory)}`
    : routePath
}

export const normalizeStoredDirectoryPaths = (value: unknown, limit: number) => {
  if (!Array.isArray(value)) return []
  const seenKeys = new Set<string>()
  return value.flatMap((directory) => {
    if (typeof directory !== 'string' || !hasNonBlankDirectoryPath(directory)) return []
    const key = normalizeDirectoryPathKey(directory)
    if (seenKeys.has(key)) return []
    seenKeys.add(key)
    return [directory]
  }).slice(0, limit)
}

export const rememberDirectoryPath = (directories: string[], directory: string, limit: number) => {
  if (!hasNonBlankDirectoryPath(directory)) return directories
  const key = normalizeDirectoryPathKey(directory)
  return [
    directory,
    ...directories.filter(candidate => normalizeDirectoryPathKey(candidate) !== key)
  ].slice(0, limit)
}
