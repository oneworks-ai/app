const { resolve } = require('node:path')
const process = require('node:process')

const readDesktopServerChildStartedAt = () => {
  const startedAt = Number(process.env.__ONEWORKS_DESKTOP_SERVER_CHILD_STARTED_AT__)
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : undefined
}

const shouldDisableMockHomeBridge = () => (
  process.env.__ONEWORKS_DISABLE_MOCK_HOME_BRIDGE === '1'
)

const logDesktopEntryTiming = (message) => {
  const childStartedAt = readDesktopServerChildStartedAt()
  if (childStartedAt == null) return
  process.stdout.write(`[ow-cli-entry] ${message} processElapsed=${Date.now() - childStartedAt}ms\n`)
}

const scopeProjectWorkspaceEnv = (workspaceFolder) => {
  const normalizedWorkspaceFolder = resolve(workspaceFolder)
  const inheritedWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  const inheritedWorkspaceMatches = typeof inheritedWorkspaceFolder === 'string' &&
    inheritedWorkspaceFolder.trim() !== '' &&
    resolve(inheritedWorkspaceFolder) === normalizedWorkspaceFolder

  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = normalizedWorkspaceFolder
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = normalizedWorkspaceFolder
  if (!inheritedWorkspaceMatches) {
    delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  }
}

const runCliPackageEntrypoint = (options) => {
  logDesktopEntryTiming('entry begin')
  const {
    packageDir,
    sourceEntry = './src/cli',
    distEntry = './dist/cli.js'
  } = options ?? {}

  if (!packageDir || typeof packageDir !== 'string') {
    throw new Error('packageDir is required')
  }

  logDesktopEntryTiming('requiring register helpers begin')
  const {
    migrateProjectHomeSegmentsSync,
    resolveProjectMockHome,
    resolveProjectWorkspaceFolder
  } = require('@oneworks/register/dotenv')
  const { bridgeRealHomeToMockHome } = require('@oneworks/register/mock-home-bridge')
  logDesktopEntryTiming('requiring register helpers complete')

  const workspaceFolder = resolveProjectWorkspaceFolder(process.cwd(), process.env)
  scopeProjectWorkspaceEnv(workspaceFolder)
  process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ = packageDir
  process.env.__ONEWORKS_PROJECT_REAL_HOME__ = process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? ''
  if (readDesktopServerChildStartedAt() == null) {
    try {
      logDesktopEntryTiming('mock home migration begin')
      migrateProjectHomeSegmentsSync(workspaceFolder, process.env, ['.mock'])
      logDesktopEntryTiming('mock home migration complete')
    } catch {}
  } else {
    logDesktopEntryTiming('mock home migration deferred')
  }
  logDesktopEntryTiming('resolve mock home begin')
  process.env.HOME = resolveProjectMockHome(process.cwd(), process.env)
  if (!shouldDisableMockHomeBridge()) {
    bridgeRealHomeToMockHome()
  }
  logDesktopEntryTiming('resolve mock home complete')
  process.env.__ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__ = sourceEntry
  process.env.__ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__ = distEntry

  logDesktopEntryTiming('requiring loader begin')
  require('./loader')
  logDesktopEntryTiming('requiring loader complete')
}

module.exports = {
  runCliPackageEntrypoint
}
