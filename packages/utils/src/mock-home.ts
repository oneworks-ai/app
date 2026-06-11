import { lstat, mkdir, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const normalizeBridgePath = (entry: string) => {
  const trimmed = entry.trim()
  if (trimmed === '' || isAbsolute(trimmed)) return undefined

  const resolved = resolve('/', trimmed)
  const normalized = relative('/', resolved)
  if (normalized === '' || normalized === '..' || normalized.startsWith('../')) {
    return undefined
  }

  return normalized
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = relative(parentPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const readLinkStat = async (targetPath: string) => {
  try {
    return await lstat(targetPath)
  } catch {
    return undefined
  }
}

const materializeSymlinkAncestors = async (params: {
  mockHome: string
  targetPath: string
}) => {
  const { mockHome, targetPath } = params
  const segments = relative(mockHome, targetPath).split(/[\\/]+/).filter(Boolean)
  let current = mockHome

  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment)
    const stat = await readLinkStat(current)
    if (stat?.isSymbolicLink()) {
      await rm(current, { recursive: true, force: true })
      await mkdir(current, { recursive: true })
      return false
    }
    if (stat == null) return true
    if (!stat.isDirectory()) {
      await rm(current, { recursive: true, force: true })
      await mkdir(current, { recursive: true })
    }
  }

  return true
}

export const unlinkMockHomeBridgePaths = async (params: {
  mockHome: string
  paths: readonly string[]
}) => {
  const mockHome = resolve(params.mockHome)

  for (const entry of params.paths) {
    const normalized = normalizeBridgePath(entry)
    if (normalized == null) continue

    const targetPath = resolve(mockHome, normalized)
    if (!isPathInside(mockHome, targetPath)) continue
    if (!await materializeSymlinkAncestors({ mockHome, targetPath })) continue

    const stat = await readLinkStat(targetPath)
    if (stat?.isSymbolicLink()) {
      await rm(targetPath, { recursive: true, force: true })
    }
  }
}
