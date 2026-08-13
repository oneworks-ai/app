export type RelayFilesystemPathFamily =
  | 'posix-absolute'
  | 'posix-relative'
  | 'windows-drive-rooted'
  | 'windows-drive-relative'
  | 'windows-rooted'
  | 'windows-unc'

export const relayFilesystemPathFamily = (value: string): RelayFilesystemPathFamily => {
  if (/^[\\/]{2}/u.test(value)) return 'windows-unc'
  if (/^[a-z]:[\\/]/iu.test(value)) return 'windows-drive-rooted'
  if (/^[a-z]:/iu.test(value)) return 'windows-drive-relative'
  if (value.startsWith('\\')) return 'windows-rooted'
  return value.startsWith('/') ? 'posix-absolute' : 'posix-relative'
}

const isWindowsPathFamily = (value: string) => relayFilesystemPathFamily(value).startsWith('windows-')

const pathRootLength = (value: string, family = relayFilesystemPathFamily(value)) => {
  if (family === 'windows-unc') {
    const unc = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/u.exec(value)
    return unc?.[0].length ?? 2
  }
  if (family === 'windows-drive-rooted') return 3
  if (family === 'windows-drive-relative') return 2
  return family === 'posix-absolute' || family === 'windows-rooted' ? 1 : 0
}

export const readRelayFilesystemPath = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const stripOptionalTrailingSeparators = (
  value: string,
  family = relayFilesystemPathFamily(value)
) => {
  const windowsFamily = family.startsWith('windows-')
  const floor = pathRootLength(value, family)
  let end = value.length
  const isOptionalSeparator = windowsFamily
    ? (character: string) => character === '/' || character === '\\'
    : (character: string) => character === '/'
  while (end > floor && isOptionalSeparator(value[end - 1])) end -= 1
  return value.slice(0, end)
}

export const normalizeRelayFilesystemPath = (
  value: string,
  family = relayFilesystemPathFamily(value)
) => {
  const path = stripOptionalTrailingSeparators(value, family)
  return family.startsWith('windows-') ? path.replace(/[\\/]+/gu, '/') : path
}

export const relayFilesystemPathComparisonKey = (
  value: string,
  family = relayFilesystemPathFamily(value),
  isBasename = false
) => {
  const path = isBasename
    ? (family.startsWith('windows-') ? value.replace(/[\\/]+/gu, '/') : value)
    : normalizeRelayFilesystemPath(value, family)
  return `${family}:${family.startsWith('windows-') ? path.toLowerCase() : path}`
}

export const relayFilesystemPathBasename = (value: string | undefined) => {
  if (value == null) return undefined
  const path = stripOptionalTrailingSeparators(value)
  if (
    /^[a-z]:[\\/]*$/iu.test(path) ||
    /^[\\/]$/u.test(path) ||
    /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]*$/u.test(path)
  ) {
    return undefined
  }
  const segments = path.split(isWindowsPathFamily(path) ? /[\\/]+/u : /\/+/u).filter(Boolean)
  return segments.at(-1) ?? path
}

export const relayFilesystemPathBasenameCandidate = (value: string | undefined) => {
  if (value == null) return undefined
  const basename = relayFilesystemPathBasename(value)
  return basename == null ? undefined : {
    family: relayFilesystemPathFamily(value),
    value: basename
  }
}
