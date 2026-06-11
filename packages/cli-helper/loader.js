const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const process = require('node:process')

const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']

const readDesktopServerChildStartedAt = () => {
  const startedAt = Number(process.env.__ONEWORKS_DESKTOP_SERVER_CHILD_STARTED_AT__)
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : undefined
}

const logDesktopLoaderTiming = (message) => {
  const childStartedAt = readDesktopServerChildStartedAt()
  if (childStartedAt == null) return
  process.stdout.write(`[ow-cli-loader] ${message} processElapsed=${Date.now() - childStartedAt}ms\n`)
}

const splitNodePath = (value) => (
  typeof value === 'string'
    ? value
      .split(path.delimiter)
      .map(item => item.trim())
      .filter(Boolean)
    : []
)

const quoteNodeOptionValue = (value) => (
  /[\s"']/.test(value) ? JSON.stringify(value) : value
)

const resolvePackageNodePaths = (packageDir) => {
  if (!packageDir || typeof packageDir !== 'string') return []

  try {
    const packageRequire = Module.createRequire(path.resolve(packageDir, 'package.json'))
    // Probe package resolution with a synthetic name so Node returns the
    // lookup paths for dependencies installed around the project package.
    return packageRequire.resolve.paths('@oneworks/cli-helper-node-path-probe') ?? []
  } catch {
    return []
  }
}

const bootstrapNodePath = () => {
  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? process.cwd()
  const nextNodePaths = [
    ...new Set([
      ...splitNodePath(process.env.NODE_PATH),
      ...resolvePackageNodePaths(packageDir)
    ])
  ]

  if (nextNodePaths.length === 0) return

  process.env.NODE_PATH = nextNodePaths.join(path.delimiter)
  Module._initPaths()
}

const resolveEntryPath = (value) => {
  if (!value || typeof value !== 'string') return undefined
  if (path.isAbsolute(value)) return value

  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? process.cwd()
  return path.resolve(packageDir, value)
}

const resolveExistingEntrypoint = (value) => {
  const resolvedPath = resolveEntryPath(value)
  if (resolvedPath == null) return undefined
  if (existsSync(resolvedPath)) return resolvedPath

  if (path.extname(resolvedPath) !== '') {
    return undefined
  }

  for (const extension of ENTRY_EXTENSIONS) {
    const candidatePath = `${resolvedPath}${extension}`
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return undefined
}

const resolveCliEntrypoint = () => {
  const sourceEntrypoint = resolveExistingEntrypoint(process.env.__ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__)
  if (sourceEntrypoint != null) {
    return sourceEntrypoint
  }

  const distEntrypoint = resolveExistingEntrypoint(process.env.__ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__)
  if (distEntrypoint != null) {
    return distEntrypoint
  }

  throw new Error(
    'CLI entrypoint not found. Set __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__ or __ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__.'
  )
}

logDesktopLoaderTiming('bootstrap node path begin')
bootstrapNodePath()
logDesktopLoaderTiming('bootstrap node path complete')

if (!process.env.__IS_LOADER_CLI__) {
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: [
        '--conditions=__oneworks__',
        `--require=${quoteNodeOptionValue(require.resolve('@oneworks/register/preload'))}`,
        process.env.NODE_OPTIONS ?? ''
      ].filter(Boolean).join(' ').trim(),
      __IS_LOADER_CLI__: 'true'
    }
  })

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  function handleSigint() {
    forwardSignal('SIGINT')
  }

  function handleSigterm() {
    forwardSignal('SIGTERM')
  }

  const cleanup = () => {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  child.on('error', (error) => {
    cleanup()
    console.error(error.message)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    cleanup()
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
} else {
  logDesktopLoaderTiming('loader cli branch begin')
  logDesktopLoaderTiming('requiring register dotenv begin')
  const { resolveProjectWorkspaceFolder } = require('@oneworks/register/dotenv')
  logDesktopLoaderTiming('requiring register dotenv complete')

  const workspaceFolder = resolveProjectWorkspaceFolder(process.cwd(), process.env)
  const inheritedWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  const inheritedWorkspaceMatches = typeof inheritedWorkspaceFolder === 'string' &&
    inheritedWorkspaceFolder.trim() !== '' &&
    path.resolve(inheritedWorkspaceFolder) === path.resolve(workspaceFolder)
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = path.resolve(workspaceFolder)
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = path.resolve(workspaceFolder)
  if (!inheritedWorkspaceMatches) {
    delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
  }
  process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? process.cwd()
  process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__ = process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__ ??
    process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__

  logDesktopLoaderTiming('resolve entrypoint begin')
  const cliEntrypoint = resolveCliEntrypoint()
  logDesktopLoaderTiming(`resolve entrypoint complete path=${cliEntrypoint}`)
  logDesktopLoaderTiming('requiring entrypoint begin')
  require(cliEntrypoint)
  logDesktopLoaderTiming('requiring entrypoint complete')
}
