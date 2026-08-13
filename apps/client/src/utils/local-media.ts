import {
  getFilesystemPathFamily,
  isAbsoluteFilesystemPath,
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
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm'])
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav'])
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_FILESYSTEM_PATH_PATTERN = /^[a-z]:/i

export type LocalMediaKind = 'audio' | 'image' | 'video'

export interface LocalMediaSource {
  kind: LocalMediaKind
  path: string
}

const decodeLocalPath = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const getExtension = (value: string) => {
  const fileName = value.split('/').pop() ?? value
  return fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
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

export const parseLocalMediaSource = (value: string): LocalMediaSource | null => {
  const trimmed = value.trim()
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    (!WINDOWS_FILESYSTEM_PATH_PATTERN.test(trimmed) && URL_SCHEME_PATTERN.test(trimmed))
  ) {
    return null
  }

  const pathWithoutHash = value.split('#')[0] ?? ''
  const pathWithoutQuery = pathWithoutHash.split('?')[0] ?? ''
  const path = decodeLocalPath(pathWithoutQuery)
  const extension = getExtension(path.trimEnd())
  const kind = IMAGE_EXTENSIONS.has(extension)
    ? 'image'
    : VIDEO_EXTENSIONS.has(extension)
    ? 'video'
    : AUDIO_EXTENSIONS.has(extension)
    ? 'audio'
    : null

  return kind == null || path.trim() === '' ? null : { kind, path }
}

export const parseLocalMediaSourceForWorkspaceRoot = (
  value: string,
  workspaceRootPath?: string
): LocalMediaSource | null => {
  const media = parseLocalMediaSource(value)
  if (media == null || !isAbsoluteFilesystemPath(media.path)) return media

  const rawRoot = normalizeWorkspaceRootPath(workspaceRootPath)
  const normalizedPath = normalizeWorkspaceFamilySeparators(media.path, rawRoot)
  if (/^\/(?:private\/)?tmp\/oneworks-cua(?:\/|$)/.test(normalizedPath)) {
    return media
  }

  const normalizedRoot = normalizeWorkspaceFamilySeparators(rawRoot, rawRoot)
  const sameFamily = getFilesystemPathFamily(rawRoot) === getFilesystemPathFamily(media.path)
  const comparableRoot = isWindowsFilesystemPath(rawRoot) ? normalizedRoot.toLowerCase() : normalizedRoot
  const comparablePath = isWindowsFilesystemPath(rawRoot) ? normalizedPath.toLowerCase() : normalizedPath
  const rootPrefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  return sameFamily && comparableRoot !== '' && (
      comparablePath === comparableRoot || comparablePath.startsWith(rootPrefix)
    )
    ? media
    : null
}
