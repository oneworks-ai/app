import { isAbsolute, relative, sep } from 'node:path'

export const normalizePath = (value: string) => value.split('\\').join('/')

const normalizeFilesystemPath = (value: string) => (
  sep === '\\' ? normalizePath(value) : value
)

export const resolveRelativePath = (cwd: string, value: string) => (
  normalizeFilesystemPath(relative(cwd, value))
)

export const resolvePromptPath = (cwd: string, value: string) => {
  const relativePath = resolveRelativePath(cwd, value)
  const isOutside = relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)
  return isOutside ? normalizeFilesystemPath(value) : relativePath
}
