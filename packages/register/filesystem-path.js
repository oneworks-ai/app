const { posix, sep, win32 } = require('node:path')

const readNonBlankFilesystemPath = (value) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const getPathPolicy = (value) => {
  const windowsFamily = /^[a-z]:[\\/]/i.test(value) || (sep === '\\' && /^\\/.test(value)) || (
    sep === '\\' && !value.startsWith('/')
  )
  return {
    root: windowsFamily ? win32.parse(value).root : posix.parse(value).root,
    isTrailingSeparator: windowsFamily
      ? character => character === '/' || character === '\\'
      : character => character === '/'
  }
}

const normalizeFilesystemDirPath = (value) => {
  const rawPath = readNonBlankFilesystemPath(value)
  if (rawPath == null) return undefined

  const { isTrailingSeparator, root } = getPathPolicy(rawPath)
  let end = rawPath.length
  while (end > root.length && isTrailingSeparator(rawPath[end - 1] ?? '')) {
    end -= 1
  }
  return rawPath.slice(0, end)
}

const readFilesystemPathOutput = (value) => {
  if (value == null) return undefined
  const output = sep === '\\' && value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
    ? value.slice(0, -1)
    : value
  return readNonBlankFilesystemPath(output)
}

module.exports = {
  normalizeFilesystemDirPath,
  readFilesystemPathOutput,
  readNonBlankFilesystemPath
}
