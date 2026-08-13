import {
  getFilesystemPathFamily,
  isWindowsFilesystemPath,
  readNonBlankFilesystemPath,
  stripOptionalTrailingPathSeparators
} from './filesystem-path-identity'

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp'
])

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+[;,]/i
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_FILESYSTEM_PATH_PATTERN = /^[a-z]:/i
const PLAIN_WORKSPACE_FILE_PATTERN =
  /(^|[\s([<{])((?:\.\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9][\w.-]*(?::\d+)?(?::\d+)?)(?=$|[\s)\]}>.,;!?])/gi

export type PlainWorkspaceFileSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; text: string }

export interface WorkspaceFileLinkTarget {
  column?: number
  line?: number
  path: string
}

export const getPathExtension = (value: string) => {
  const path = (value.trim().split('#')[0] ?? '').split('?')[0] ?? ''
  const fileName = path.split('/').pop() ?? path
  return fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
}

export const isLikelyImageUrl = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '' || IMAGE_DATA_URL_PATTERN.test(trimmed)) return trimmed !== ''

  if (trimmed.startsWith('blob:')) {
    return true
  }

  try {
    const parsed = new URL(trimmed, 'http://oneworks.local/')
    return IMAGE_EXTENSIONS.has(getPathExtension(parsed.pathname))
  } catch {
    return IMAGE_EXTENSIONS.has(getPathExtension(trimmed))
  }
}

export const isExternalUrl = (value: string) => {
  const trimmed = value.trim()
  return !WINDOWS_FILESYSTEM_PATH_PATTERN.test(trimmed) && URL_SCHEME_PATTERN.test(trimmed)
}

const splitLineColumnSuffix = (value: string) => {
  const match = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(value)
  const line = match?.[2] != null ? Number.parseInt(match[2], 10) : undefined
  const column = match?.[3] != null ? Number.parseInt(match[3], 10) : undefined
  return {
    path: match?.[1] ?? value,
    ...(line != null && line > 0 ? { line } : {}),
    ...(column != null && column > 0 ? { column } : {})
  }
}

const decodeLinkPath = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseWorkspaceFileLink = (value: string): WorkspaceFileLinkTarget | null => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('#') || isWindowsFilesystemPath(trimmed) || isExternalUrl(trimmed)) {
    return null
  }

  const splitTarget = splitLineColumnSuffix(
    decodeLinkPath((trimmed.split('#')[0] ?? '').split('?')[0] ?? '')
  )
  const normalized = splitTarget.path.replace(/^\.\//, '')
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    return null
  }

  return {
    path: normalized,
    ...(splitTarget.line != null ? { line: splitTarget.line } : {}),
    ...(splitTarget.column != null ? { column: splitTarget.column } : {})
  }
}

const normalizeWorkspaceRootPath = (value: string | undefined) => {
  const rawPath = readNonBlankFilesystemPath(value)
  return rawPath == null ? '' : stripOptionalTrailingPathSeparators(rawPath)
}
const normalizeWorkspaceFamilySeparators = (value: string, rootPath: string) => (
  isWindowsFilesystemPath(rootPath)
    ? value.replace(/\\/g, '/')
    : value
)

export const parseWorkspaceFileLinkForWorkspaceRoot = (
  value: string,
  workspaceRootPath?: string
): WorkspaceFileLinkTarget | null => {
  const relativeTarget = parseWorkspaceFileLink(value)
  if (relativeTarget != null) {
    return relativeTarget
  }

  const rawRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const rootPath = normalizeWorkspaceFamilySeparators(rawRootPath, rawRootPath)
  const trimmed = value.trim()
  if (rootPath === '' || trimmed === '' || trimmed.startsWith('#') || isExternalUrl(trimmed)) {
    return null
  }

  const splitTarget = splitLineColumnSuffix(
    normalizeWorkspaceFamilySeparators(
      decodeLinkPath((trimmed.split('#')[0] ?? '').split('?')[0] ?? ''),
      rawRootPath
    )
  )
  const rootFamily = getFilesystemPathFamily(rawRootPath)
  const candidateFamily = getFilesystemPathFamily(splitTarget.path)
  if (rootFamily !== candidateFamily) {
    return null
  }
  const comparableRoot = isWindowsFilesystemPath(rawRootPath) ? rootPath.toLowerCase() : rootPath
  const comparablePath = isWindowsFilesystemPath(rawRootPath) ? splitTarget.path.toLowerCase() : splitTarget.path
  const rootPrefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  if (!comparablePath.startsWith(rootPrefix)) {
    return null
  }

  const path = splitTarget.path.slice(rootPath.length + (rootPath.endsWith('/') ? 0 : 1))
  if (path === '' || path.endsWith('/') || path.split('/').includes('..')) {
    return null
  }

  return {
    path,
    ...(splitTarget.line != null ? { line: splitTarget.line } : {}),
    ...(splitTarget.column != null ? { column: splitTarget.column } : {})
  }
}

export const normalizeWorkspaceFileLink = (value: string) => parseWorkspaceFileLink(value)?.path ?? null

export const splitPlainWorkspaceFileLinks = (value: string): PlainWorkspaceFileSegment[] => {
  const segments: PlainWorkspaceFileSegment[] = []
  let lastIndex = 0

  for (const match of value.matchAll(PLAIN_WORKSPACE_FILE_PATTERN)) {
    const fullMatch = match[0] ?? ''
    const prefix = match[1] ?? ''
    const href = match[2] ?? ''
    const matchIndex = match.index ?? 0
    const linkIndex = matchIndex + prefix.length

    if (normalizeWorkspaceFileLink(href) == null) {
      continue
    }

    if (linkIndex > lastIndex) {
      segments.push({ type: 'text', text: value.slice(lastIndex, linkIndex) })
    }
    segments.push({ type: 'link', href, text: href })
    lastIndex = matchIndex + fullMatch.length
  }

  if (lastIndex === 0) {
    return [{ type: 'text', text: value }]
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', text: value.slice(lastIndex) })
  }

  return segments
}
