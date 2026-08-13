const stripTerminalLineEndings = (value: string) => value.replace(/(?:\r\n|\r|\n)+$/u, '')

const readControlFilePath = (value: string) => {
  const path = stripTerminalLineEndings(value)
  return path.trim() === '' || /[\r\n]/u.test(path) ? undefined : path
}

export const readGitdirControlFilePath = (value: string) => {
  const line = stripTerminalLineEndings(value)
  const prefix = 'gitdir:'
  if (!line.toLowerCase().startsWith(prefix)) return undefined
  const payload = line.slice(prefix.length)
  return readControlFilePath(/^[\t ]/u.test(payload) ? payload.slice(1) : payload)
}

export const readGitCommonDirControlFilePath = readControlFilePath
