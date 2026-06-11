#!/usr/bin/env node

const { existsSync } = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const process = require('node:process')

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

bootstrapNodePath()

const {
  migrateProjectHomeSegmentsSync,
  resolveProjectMockHome,
  resolveProjectWorkspaceFolder
} = require('@oneworks/register/dotenv')
const { bridgeRealHomeToMockHome } = require('@oneworks/register/mock-home-bridge')

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
process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? __dirname
process.env.__ONEWORKS_PROJECT_REAL_HOME__ = process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? ''
try {
  migrateProjectHomeSegmentsSync(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__, process.env, ['.mock'])
} catch {}
process.env.HOME = resolveProjectMockHome(process.cwd(), process.env)
bridgeRealHomeToMockHome()

const sourceEntrypoint = path.resolve(__dirname, './src/worker.ts')
const distEntrypoint = path.resolve(__dirname, './dist/worker.js')
const entrypoint = existsSync(sourceEntrypoint) ? sourceEntrypoint : distEntrypoint
const { runHookWorkerCli } = require(entrypoint)

void runHookWorkerCli()
