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

const normalizeWorkspaceRootPath = (value: string | undefined) => value?.trim().replace(/[\\/]+$/, '') ?? ''

export const parseLocalMediaSource = (value: string): LocalMediaSource | null => {
  const trimmed = value.trim()
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    URL_SCHEME_PATTERN.test(trimmed)
  ) {
    return null
  }

  const pathWithoutHash = trimmed.split('#')[0] ?? ''
  const pathWithoutQuery = pathWithoutHash.split('?')[0] ?? ''
  const path = decodeLocalPath(pathWithoutQuery)
  const extension = getExtension(path)
  const kind = IMAGE_EXTENSIONS.has(extension)
    ? 'image'
    : VIDEO_EXTENSIONS.has(extension)
    ? 'video'
    : AUDIO_EXTENSIONS.has(extension)
    ? 'audio'
    : null

  return kind == null || path === '' ? null : { kind, path }
}

export const parseLocalMediaSourceForWorkspaceRoot = (
  value: string,
  workspaceRootPath?: string
): LocalMediaSource | null => {
  const media = parseLocalMediaSource(value)
  if (media == null || !media.path.startsWith('/')) return media

  const normalizedPath = media.path.replace(/\\/g, '/')
  if (/^\/(?:private\/)?tmp\/oneworks-cua(?:\/|$)/.test(normalizedPath)) {
    return media
  }

  const normalizedRoot = normalizeWorkspaceRootPath(workspaceRootPath).replace(/\\/g, '/')
  return normalizedRoot !== '' && (
      normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
    )
    ? media
    : null
}
