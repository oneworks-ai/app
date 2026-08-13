import { posix, sep, win32 } from 'node:path'

export const readNonBlankFilesystemPath = (
  value: string | null | undefined
) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const getPathPolicy = (value: string) => {
  const windowsFamily = /^[a-z]:[\\/]/i.test(value) || (sep === '\\' && /^\\/.test(value)) || (
    sep === '\\' && !value.startsWith('/')
  )
  return {
    root: windowsFamily ? win32.parse(value).root : posix.parse(value).root,
    isTrailingSeparator: windowsFamily
      ? (character: string) => character === '/' || character === '\\'
      : (character: string) => character === '/'
  }
}

export const normalizeFilesystemDirPath = (
  value: string | null | undefined
) => {
  const rawPath = readNonBlankFilesystemPath(value)
  if (rawPath == null) return undefined

  const { isTrailingSeparator, root } = getPathPolicy(rawPath)
  let end = rawPath.length
  while (end > root.length && isTrailingSeparator(rawPath[end - 1] ?? '')) {
    end -= 1
  }
  return rawPath.slice(0, end)
}

export const readFilesystemPathOutput = (
  value: string | null | undefined
) => {
  if (value == null) return undefined
  const output = sep === '\\' && value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
    ? value.slice(0, -1)
    : value
  return readNonBlankFilesystemPath(output)
}
