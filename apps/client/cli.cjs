#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const process = require('node:process')

const {
  migrateProjectHomeSegmentsSync,
  resolveProjectMockHome,
  resolveProjectWorkspaceFolder
} = require('@oneworks/register/dotenv')
const { bridgeRealHomeToMockHome } = require('@oneworks/register/mock-home-bridge')
const { startPreviewServer } = require('./preview-server.cjs')

const workspaceFolder = resolveProjectWorkspaceFolder(process.cwd(), process.env)
const inheritedWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
const inheritedWorkspaceMatches = typeof inheritedWorkspaceFolder === 'string' &&
  inheritedWorkspaceFolder.trim() !== '' &&
  resolve(inheritedWorkspaceFolder) === resolve(workspaceFolder)
process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = resolve(workspaceFolder)
process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = resolve(workspaceFolder)
if (!inheritedWorkspaceMatches) {
  delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
}
process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ = __dirname
process.env.__ONEWORKS_PROJECT_REAL_HOME__ = process.env.__ONEWORKS_PROJECT_REAL_HOME__ ?? process.env.HOME ?? ''
try {
  migrateProjectHomeSegmentsSync(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__, process.env, ['.mock'])
} catch {}
process.env.HOME = resolveProjectMockHome(process.cwd(), process.env)
bridgeRealHomeToMockHome()

const cwd = realpathSync(resolve(__dirname, './'))
const clientMode = (process.env.__ONEWORKS_PROJECT_CLIENT_MODE__ ?? '').trim().toLowerCase()
const clientDevServer = /^(?:1|true|yes|on)$/i.test(process.env.__ONEWORKS_PROJECT_CLIENT_DEV_SERVER__ ?? '')

const resolveViteBin = () => {
  try {
    const packageJson = require.resolve('vite/package.json', {
      paths: [cwd, process.cwd(), __dirname]
    })
    const packageMeta = require(packageJson)
    const packageDir = dirname(packageJson)
    const viteBin = resolve(packageDir, packageMeta.bin?.vite ?? 'bin/vite.js')
    return existsSync(viteBin) ? viteBin : null
  } catch {
    return null
  }
}

const runDevServer = () => {
  const viteBin = resolveViteBin()
  const hasDevSource = existsSync(resolve(cwd, './vite.config.ts'))

  if (viteBin == null || !hasDevSource) {
    console.error(
      '[client] dev mode requires a local One Works source checkout with workspace dependencies installed.'
    )
    process.exit(1)
  }

  const child = spawn(process.execPath, [viteBin], {
    cwd,
    env: process.env,
    stdio: 'inherit'
  })

  const forwardSignal = (signal) => {
    if (child.exitCode != null || child.signalCode != null) {
      return
    }
    child.kill(signal)
  }

  process.once('SIGINT', () => forwardSignal('SIGINT'))
  process.once('SIGTERM', () => forwardSignal('SIGTERM'))
  child.once('error', (error) => {
    console.error('[client] failed to start dev server:', error)
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      process.exit(0)
      return
    }
    process.exit(code ?? 1)
  })
}

const runPreviewServer = async () => {
  const preview = await startPreviewServer({
    base: process.env.__ONEWORKS_PROJECT_CLIENT_BASE__,
    distPath: resolve(cwd, './dist'),
    host: process.env.__ONEWORKS_PROJECT_CLIENT_HOST__ || '127.0.0.1',
    port: Number(process.env.__ONEWORKS_PROJECT_CLIENT_PORT__ ?? 4173),
    runtimeEnv: process.env
  })
  console.log(`[client]             ${preview.url}`)
}

if (clientMode === 'dev' || clientDevServer) {
  runDevServer()
} else {
  runPreviewServer().catch((error) => {
    console.error('[client] failed to start preview server:', error)
    process.exit(1)
  })
}
