export const readNonBlankFilesystemPath = (value: string | null | undefined): string | undefined => (
  value != null && value.trim() !== '' ? value : undefined
)

type FilesystemPathFamily =
  | 'posix-absolute'
  | 'posix-relative'
  | 'windows-drive-rooted'
  | 'windows-drive-relative'
  | 'windows-rooted'
  | 'windows-unc'

export const getFilesystemPathFamily = (value: string): FilesystemPathFamily => {
  if (/^[\\/]{2}/u.test(value)) return 'windows-unc'
  if (/^[a-z]:[\\/]/iu.test(value)) return 'windows-drive-rooted'
  if (/^[a-z]:/iu.test(value)) return 'windows-drive-relative'
  if (value.startsWith('\\')) return 'windows-rooted'
  return value.startsWith('/') ? 'posix-absolute' : 'posix-relative'
}

const getFilesystemRootLength = (value: string, family = getFilesystemPathFamily(value)) => {
  if (family === 'windows-unc') return /^([\\/])\1[^\\/]+[\\/]+[^\\/]+/u.exec(value)?.[0].length ?? 2
  if (family === 'windows-drive-rooted') return 3
  if (family === 'windows-drive-relative') return 2
  return family === 'posix-absolute' || family === 'windows-rooted' ? 1 : 0
}

const usesWindowsPathSeparators = (value: string) => getFilesystemPathFamily(value).startsWith('windows-')

export const isWindowsFilesystemPath = (value: string) => usesWindowsPathSeparators(value)

export const isAbsoluteFilesystemPath = (value: string) => {
  const family = getFilesystemPathFamily(value)
  return family === 'posix-absolute' || family === 'windows-drive-rooted' || family === 'windows-rooted' ||
    family === 'windows-unc'
}

export const stripOptionalTrailingPathSeparators = (value: string) => {
  const family = getFilesystemPathFamily(value)
  const rootLength = getFilesystemRootLength(value, family)
  const windowsFamily = family.startsWith('windows-')
  let end = value.length
  while (end > rootLength) {
    const character = value[end - 1]
    if (character !== '/' && (!windowsFamily || character !== '\\')) break
    end -= 1
  }
  return value.slice(0, end)
}

export const getFilesystemPathComparisonKey = (value: string) => {
  const family = getFilesystemPathFamily(value)
  const normalized = stripOptionalTrailingPathSeparators(value)
  const path = family.startsWith('windows-')
    ? normalized.replace(/[\\/]+/gu, '/').toLowerCase()
    : normalized
  return `${family}:${path}`
}

export const getFilesystemPathDisplayName = (value: string | null | undefined) => {
  const path = readNonBlankFilesystemPath(value)
  if (path == null) return undefined
  const normalized = stripOptionalTrailingPathSeparators(path)
  const windowsFamily = usesWindowsPathSeparators(normalized)
  const segments = normalized.split(windowsFamily ? /[\\/]+/u : /\/+/u).filter(Boolean)
  return segments.at(-1) ?? normalized
}
