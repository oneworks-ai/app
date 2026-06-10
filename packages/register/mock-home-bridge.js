/* eslint-disable max-lines -- mock-home bridge centralizes CJS startup filesystem safety. */
const {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync
} = require('node:fs')
const path = require('node:path')
const process = require('node:process')

const DEFAULT_DIRECT_LINK_ENTRIES = [
  '.cache'
]

const DEFAULT_EXCLUDED_ENTRIES = [
  '.oneworks'
]

const DEFAULT_EXCLUDED_ENTRY_PATTERNS = [
  /^\.zcompdump/
]

const DEFAULT_PLATFORM_BRIDGE_ENTRIES = process.platform === 'darwin'
  ? [
    path.join('Library', 'Keychains'),
    path.join('Library', 'Application Support')
  ]
  : []

const DEFAULT_DIRECT_LINK_PLATFORM_ENTRIES = [
  ...DEFAULT_PLATFORM_BRIDGE_ENTRIES
]

const GIT_HOME_ENTRIES = [
  '.git-credentials',
  '.git-credential',
  '.git-credential-cache',
  path.join('.config', 'git')
]

const normalizeHome = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? path.resolve(trimmed) : undefined
}

const pathExistsOrSymlink = (targetPath) => {
  try {
    lstatSync(targetPath)
    return true
  } catch {
    return false
  }
}

const readLinkStat = (targetPath) => {
  try {
    return lstatSync(targetPath)
  } catch {
    return undefined
  }
}

const resolveSymlinkType = (sourcePath) => {
  try {
    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      return process.platform === 'win32' ? 'junction' : 'dir'
    }
  } catch {}

  return 'file'
}

const isPathInside = (parentPath, targetPath) => {
  const relative = path.relative(parentPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const normalizeBridgeEntry = (entry) => {
  const normalized = typeof entry === 'string' ? entry.trim() : ''
  if (normalized === '' || path.isAbsolute(normalized)) return undefined

  const resolved = path.normalize(normalized)
  if (resolved === '.' || resolved === '..' || resolved.startsWith(`..${path.sep}`)) {
    return undefined
  }

  return resolved
}

const matchesBridgeEntryPattern = (entry, patterns) => patterns.some(pattern => pattern.test(entry))

const isExcludedBridgeEntry = (entry, excludedEntries, excludedEntryPatterns) => (
  excludedEntries.has(entry) || matchesBridgeEntryPattern(entry, excludedEntryPatterns)
)

const materializeSymlinkAncestor = (params) => {
  const {
    mockHome,
    targetPath
  } = params
  const relative = path.relative(mockHome, targetPath)
  const segments = relative.split(path.sep).filter(Boolean)
  let current = mockHome

  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment)
    const stat = readLinkStat(current)
    if (stat?.isSymbolicLink() || (stat != null && !stat.isDirectory())) {
      rmSync(current, { recursive: true, force: true })
      mkdirSync(current, { recursive: true })
      continue
    }
    if (stat == null) {
      return true
    }
  }

  return true
}

const collectDotHomeEntries = (realHome) => {
  try {
    return readdirSync(realHome)
      .filter(entry => entry.startsWith('.') && entry !== '.' && entry !== '..')
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

const collectGitHomeEntries = (realHome) => {
  const entries = new Set(GIT_HOME_ENTRIES)

  try {
    for (const entry of readdirSync(realHome)) {
      if (entry.startsWith('.gitconfig')) {
        entries.add(entry)
      }
    }
  } catch {}

  return [...entries]
}

const createSymlinkIfMissing = (sourcePath, targetPath) => {
  if (!pathExistsOrSymlink(sourcePath) || pathExistsOrSymlink(targetPath)) return

  mkdirSync(path.dirname(targetPath), { recursive: true })
  symlinkSync(sourcePath, targetPath, resolveSymlinkType(sourcePath))
}

const hasExpectedSymlinkTarget = (sourcePath, targetPath) => {
  const targetStat = readLinkStat(targetPath)
  if (!targetStat?.isSymbolicLink()) return false

  try {
    return path.resolve(path.dirname(targetPath), readlinkSync(targetPath)) === path.resolve(sourcePath)
  } catch {
    return false
  }
}

const resolveBackupPath = (targetPath) => {
  const backupBase = `${targetPath}.backup-${Date.now().toString(36)}`
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? backupBase : `${backupBase}-${index}`
    if (!pathExistsOrSymlink(candidate)) return candidate
  }

  return `${backupBase}-${process.pid}-${Math.random().toString(36).slice(2)}`
}

const moveAsideIncorrectDirectTarget = (targetPath) => {
  const targetStat = readLinkStat(targetPath)
  if (targetStat == null) return true

  if (targetStat.isSymbolicLink()) {
    rmSync(targetPath, { recursive: true, force: true })
    return true
  }

  try {
    renameSync(targetPath, resolveBackupPath(targetPath))
    return true
  } catch {
    return false
  }
}

const syncDirectSymlinkTarget = (params) => {
  const {
    mockHome,
    sourcePath,
    targetPath
  } = params

  if (!pathExistsOrSymlink(sourcePath)) return
  materializeSymlinkAncestor({ mockHome, targetPath })
  if (hasExpectedSymlinkTarget(sourcePath, targetPath)) return
  if (!moveAsideIncorrectDirectTarget(targetPath)) return

  mkdirSync(path.dirname(targetPath), { recursive: true })
  symlinkSync(sourcePath, targetPath, resolveSymlinkType(sourcePath))
}

const bridgeDirectoryChildren = (sourceDir, targetDir) => {
  const targetStat = readLinkStat(targetDir)
  if (targetStat?.isSymbolicLink()) {
    rmSync(targetDir, { recursive: true, force: true })
  } else if (targetStat != null && !targetStat.isDirectory()) {
    return
  }

  mkdirSync(targetDir, { recursive: true })

  let entries
  try {
    entries = readdirSync(sourceDir)
  } catch {
    return
  }

  for (const entry of entries) {
    createSymlinkIfMissing(path.join(sourceDir, entry), path.join(targetDir, entry))
  }
}

const bridgeRealHomeEntry = (params) => {
  const {
    directLinkEntries,
    entry,
    mockHome,
    realHome
  } = params
  const sourcePath = path.join(realHome, entry)
  const targetPath = path.join(mockHome, entry)

  try {
    const sourceStat = statSync(sourcePath)
    const shouldDirectLink = directLinkEntries.has(entry)

    if (shouldDirectLink) {
      syncDirectSymlinkTarget({
        mockHome,
        sourcePath,
        targetPath
      })
      return
    }

    if (!sourceStat.isDirectory()) {
      createSymlinkIfMissing(sourcePath, targetPath)
      return
    }

    bridgeDirectoryChildren(sourcePath, targetPath)
  } catch {}
}

const resolveRealPath = (targetPath) => {
  try {
    return realpathSync(targetPath)
  } catch {
    return undefined
  }
}

const unlinkExcludedBridgeEntry = (params) => {
  const {
    entry,
    mockHome,
    realHome
  } = params
  const sourcePath = path.join(realHome, entry)
  const resolvedSourcePath = resolveRealPath(sourcePath) ?? sourcePath
  const targetPath = path.join(mockHome, entry)
  const targetStat = readLinkStat(targetPath)
  if (targetStat == null) return

  if (targetStat.isSymbolicLink()) {
    const resolvedTargetPath = resolveRealPath(targetPath)
    if (resolvedTargetPath != null && isPathInside(resolvedSourcePath, resolvedTargetPath)) {
      rmSync(targetPath, { recursive: true, force: true })
    }
    return
  }

  if (!targetStat.isDirectory()) return

  let entries
  try {
    entries = readdirSync(targetPath)
  } catch {
    return
  }

  for (const childEntry of entries) {
    const childPath = path.join(targetPath, childEntry)
    const childStat = readLinkStat(childPath)
    if (!childStat?.isSymbolicLink()) continue

    const resolvedChildPath = resolveRealPath(childPath)
    if (resolvedChildPath != null && isPathInside(resolvedSourcePath, resolvedChildPath)) {
      rmSync(childPath, { recursive: true, force: true })
    }
  }

  try {
    rmdirSync(targetPath)
  } catch {}
}

const unlinkExcludedBridgeEntryPatternMatches = (params) => {
  const {
    excludedEntryPatterns,
    mockHome
  } = params

  let entries
  try {
    entries = readdirSync(mockHome)
  } catch {
    return
  }

  for (const entry of entries) {
    const normalized = normalizeBridgeEntry(entry)
    if (normalized == null || !matchesBridgeEntryPattern(normalized, excludedEntryPatterns)) continue

    const targetPath = path.join(mockHome, normalized)
    const targetStat = readLinkStat(targetPath)
    if (targetStat?.isSymbolicLink()) {
      rmSync(targetPath, { recursive: true, force: true })
    }
  }
}

const bridgeRealHomeToMockHome = (options = {}) => {
  const realHome = normalizeHome(options.realHome ?? process.env.__ONEWORKS_PROJECT_REAL_HOME__)
  const mockHome = normalizeHome(options.mockHome ?? process.env.HOME)

  if (realHome == null || mockHome == null || realHome === mockHome) {
    return
  }

  const entries = new Set()
  const excludedEntries = new Set(
    (options.excludeEntries ?? DEFAULT_EXCLUDED_ENTRIES)
      .map(normalizeBridgeEntry)
      .filter(Boolean)
  )
  const excludedEntryPatterns = options.excludeEntryPatterns ?? DEFAULT_EXCLUDED_ENTRY_PATTERNS
  for (const entry of excludedEntries) {
    const sourcePath = path.join(realHome, entry)
    const targetPath = path.join(mockHome, entry)
    if (!isPathInside(realHome, sourcePath) || !isPathInside(mockHome, targetPath)) continue
    unlinkExcludedBridgeEntry({
      entry,
      mockHome,
      realHome
    })
  }
  unlinkExcludedBridgeEntryPatternMatches({
    excludedEntryPatterns,
    mockHome
  })
  if (options.includeDotEntries !== false) {
    for (const entry of collectDotHomeEntries(realHome)) {
      if (isExcludedBridgeEntry(entry, excludedEntries, excludedEntryPatterns)) continue
      entries.add(entry)
    }
  }
  for (const entry of options.includePlatformEntries === false ? [] : DEFAULT_PLATFORM_BRIDGE_ENTRIES) {
    if (isExcludedBridgeEntry(entry, excludedEntries, excludedEntryPatterns)) continue
    entries.add(entry)
  }
  for (const entry of options.entries ?? []) {
    const normalized = normalizeBridgeEntry(entry)
    if (normalized != null && !isExcludedBridgeEntry(normalized, excludedEntries, excludedEntryPatterns)) {
      entries.add(normalized)
    }
  }

  const directLinkEntries = new Set(
    (options.directLinkEntries ?? [
      ...DEFAULT_DIRECT_LINK_ENTRIES,
      ...DEFAULT_DIRECT_LINK_PLATFORM_ENTRIES
    ])
      .map(normalizeBridgeEntry)
      .filter(Boolean)
  )

  for (const entry of entries) {
    const sourcePath = path.join(realHome, entry)
    const targetPath = path.join(mockHome, entry)
    if (!isPathInside(realHome, sourcePath) || !isPathInside(mockHome, targetPath)) continue

    bridgeRealHomeEntry({
      directLinkEntries,
      entry,
      mockHome,
      realHome
    })
  }
}

const claimMockHomePaths = (options = {}) => {
  const mockHome = normalizeHome(options.mockHome ?? process.env.HOME)
  if (mockHome == null) return

  for (const entry of options.paths ?? []) {
    const normalized = normalizeBridgeEntry(entry)
    if (normalized == null) continue

    const targetPath = path.join(mockHome, normalized)
    if (!isPathInside(mockHome, targetPath)) continue
    if (!materializeSymlinkAncestor({ mockHome, targetPath })) continue

    const stat = readLinkStat(targetPath)
    if (stat?.isSymbolicLink()) {
      rmSync(targetPath, { recursive: true, force: true })
    }
  }
}

const linkRealHomeGitConfig = (options = {}) => {
  const realHome = normalizeHome(options.realHome ?? process.env.__ONEWORKS_PROJECT_REAL_HOME__)
  const entries = realHome == null ? GIT_HOME_ENTRIES : collectGitHomeEntries(realHome)
  const mockHome = normalizeHome(options.mockHome ?? process.env.HOME)
  if (realHome == null || mockHome == null || realHome === mockHome) return

  for (const entry of entries) {
    const normalized = normalizeBridgeEntry(entry)
    if (normalized == null) continue

    const sourcePath = path.join(realHome, normalized)
    const targetPath = path.join(mockHome, normalized)
    if (!isPathInside(realHome, sourcePath) || !isPathInside(mockHome, targetPath)) continue
    createSymlinkIfMissing(sourcePath, targetPath)
  }
}

module.exports = {
  bridgeRealHomeToMockHome,
  claimMockHomePaths,
  collectGitHomeEntries,
  linkRealHomeGitConfig
}
