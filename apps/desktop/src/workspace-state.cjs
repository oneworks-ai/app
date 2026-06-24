const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MAX_RECENT_WORKSPACES = 20

const isDirectory = (value) => {
  try {
    return fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

const normalizeWorkspaceFolder = (value) => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  if (trimmedValue === '') return undefined

  const resolvedPath = path.resolve(trimmedValue)
  if (!isDirectory(resolvedPath)) {
    return undefined
  }

  try {
    return fs.realpathSync.native(resolvedPath)
  } catch {
    return resolvedPath
  }
}

const readGitWorkspaceRoot = (workspaceFolder) => {
  try {
    const output = execFileSync(
      'git',
      [
        '-C',
        workspaceFolder,
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel'
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2_000
      }
    )
    const [topLevel] = output
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)

    return normalizeWorkspaceFolder(topLevel)
  } catch {
    return undefined
  }
}

const resolveProjectWorkspaceFolder = (value) => {
  const workspaceFolder = normalizeWorkspaceFolder(value)
  if (workspaceFolder == null) return undefined

  return readGitWorkspaceRoot(workspaceFolder) ?? workspaceFolder
}

const dedupeWorkspaceFolders = (values) => {
  const normalizedValues = []
  const seenPaths = new Set()

  for (const value of values) {
    const normalizedPath = resolveProjectWorkspaceFolder(value)
    if (normalizedPath == null || seenPaths.has(normalizedPath)) {
      continue
    }
    seenPaths.add(normalizedPath)
    normalizedValues.push(normalizedPath)
  }

  return normalizedValues
}

const getRecentWorkspaceFoldersFromState = (state) => {
  const recentWorkspaces = Array.isArray(state?.recentWorkspaces) ? state.recentWorkspaces : []
  const legacyWorkspace = typeof state?.workspaceFolder === 'string' ? [state.workspaceFolder] : []

  return dedupeWorkspaceFolders([
    ...recentWorkspaces,
    ...legacyWorkspace
  ]).slice(0, MAX_RECENT_WORKSPACES)
}

const rememberRecentWorkspaceFolder = (recentWorkspaces, workspaceFolder) => (
  dedupeWorkspaceFolders([
    workspaceFolder,
    ...recentWorkspaces
  ]).slice(0, MAX_RECENT_WORKSPACES)
)

const removeRecentWorkspaceFolder = (recentWorkspaces, workspaceFolder) => {
  const normalizedWorkspaceFolder = resolveProjectWorkspaceFolder(workspaceFolder) ?? path.resolve(workspaceFolder)
  return dedupeWorkspaceFolders(recentWorkspaces)
    .filter(candidate => candidate !== normalizedWorkspaceFolder)
    .slice(0, MAX_RECENT_WORKSPACES)
}

const getWorkspaceDisplayName = (workspaceFolder) => (
  path.basename(workspaceFolder) || workspaceFolder
)

const getWorkspaceDescription = (workspaceFolder) => workspaceFolder

const getWorkspaceStorageKey = (workspaceFolder) => {
  const normalizedName = getWorkspaceDisplayName(workspaceFolder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stableHash = createHash('sha1').update(workspaceFolder).digest('hex').slice(0, 10)
  return normalizedName === '' ? stableHash : `${normalizedName}-${stableHash}`
}

const isEmptyLaunchMode = (value) => {
  if (typeof value !== 'string') return false
  return /^(?:1|true|yes|on|empty|launcher|none)$/i.test(value.trim())
}

const resolveDesktopLaunchWorkspaceFolder = ({ env }) => {
  if (isEmptyLaunchMode(env.ONEWORKS_DESKTOP_LAUNCH_MODE)) {
    return undefined
  }

  return resolveProjectWorkspaceFolder(env.ONEWORKS_DESKTOP_WORKSPACE)
}

module.exports = {
  MAX_RECENT_WORKSPACES,
  getRecentWorkspaceFoldersFromState,
  getWorkspaceDescription,
  getWorkspaceDisplayName,
  getWorkspaceStorageKey,
  normalizeWorkspaceFolder,
  rememberRecentWorkspaceFolder,
  removeRecentWorkspaceFolder,
  resolveProjectWorkspaceFolder,
  resolveDesktopLaunchWorkspaceFolder
}
