#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const process = require('node:process')

process.env.__ONEWORKS_HOOK_CHILD_SCRIPT_ENTRY_EPOCH_MS__ = String(Date.now())

const setProfileDuration = (name, startedAt) => {
  process.env[`__ONEWORKS_HOOK_BOOTSTRAP_${name}_MS__`] = String(Number((performance.now() - startedAt).toFixed(1)))
}

const splitNodePath = (value) => (
  typeof value === 'string'
    ? value
      .split(path.delimiter)
      .map(item => item.trim())
      .filter(Boolean)
    : []
)

const resolvePackageNodePaths = (packageDir) => {
  if (!packageDir || typeof packageDir !== 'string') return []

  try {
    const packageRequire = Module.createRequire(path.resolve(packageDir, 'package.json'))
    // Probe package resolution with a synthetic name so Node returns the
    // lookup paths for dependencies installed around the project package.
    return packageRequire.resolve.paths('@oneworks/hooks-node-path-probe') ?? []
  } catch {
    return []
  }
}

const bootstrapNodePath = () => {
  const packageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? __dirname
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

const nodePathStartedAt = performance.now()
bootstrapNodePath()
setProfileDuration('NODE_PATH', nodePathStartedAt)

const requireProjectEnvStartedAt = performance.now()
const {
  migrateProjectHomeSegmentsSync,
  resolveProjectMockHome,
  resolveProjectWorkspaceFolder
} = require('@oneworks/register/dotenv')
const { bridgeRealHomeToMockHome } = require('@oneworks/register/mock-home-bridge')
setProfileDuration('REQUIRE_PROJECT_ENV', requireProjectEnvStartedAt)

const resolveWorkspaceStartedAt = performance.now()
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
setProfileDuration('RESOLVE_WORKSPACE', resolveWorkspaceStartedAt)

process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? __dirname
process.env.__ONEWORKS_PROJECT_REAL_HOME__ = process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? ''

const migrateProjectHomeStartedAt = performance.now()
try {
  migrateProjectHomeSegmentsSync(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__, process.env, ['.mock'])
} catch {}
setProfileDuration('MIGRATE_PROJECT_HOME', migrateProjectHomeStartedAt)

const resolveMockHomeStartedAt = performance.now()
process.env.HOME = resolveProjectMockHome(process.cwd(), process.env)
setProfileDuration('RESOLVE_MOCK_HOME', resolveMockHomeStartedAt)

const bridgeMockHomeStartedAt = performance.now()
if (process.env.__ONEWORKS_DISABLE_MOCK_HOME_BRIDGE !== '1') {
  bridgeRealHomeToMockHome()
}
setProfileDuration('BRIDGE_MOCK_HOME', bridgeMockHomeStartedAt)

const resolveEntrypointStartedAt = performance.now()
const sourceEntrypoint = path.resolve(__dirname, './src/entry.ts')
const distEntrypoint = path.resolve(__dirname, './dist/entry.js')
const shouldLoadSourceEntrypoint = existsSync(sourceEntrypoint)
setProfileDuration('RESOLVE_ENTRYPOINT', resolveEntrypointStartedAt)

if (shouldLoadSourceEntrypoint && !process.env.__IS_ONEWORKS_HOOK_LOADER__) {
  const child = spawn(
    process.execPath,
    [
      '--conditions=__oneworks__',
      '--require',
      require.resolve('@oneworks/register/preload'),
      ...process.argv.slice(1)
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        __IS_ONEWORKS_HOOK_LOADER__: 'true'
      }
    }
  )

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
  const entrypoint = shouldLoadSourceEntrypoint ? sourceEntrypoint : distEntrypoint
  const requireEntrypointStartedAt = performance.now()
  const { runManagedHookEntrypoint } = require(entrypoint)
  setProfileDuration('REQUIRE_ENTRYPOINT', requireEntrypointStartedAt)
  process.env.__ONEWORKS_HOOK_CHILD_BEFORE_MANAGED_ENTRY_EPOCH_MS__ = String(Date.now())
  void runManagedHookEntrypoint()
}
