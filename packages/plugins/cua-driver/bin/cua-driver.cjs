#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const process = require('node:process')

const {
  checkPermissions,
  ensureAgentCursor,
  resolveDriverBinary,
  run,
  startDaemonIfNeeded
} = require('./runtime.cjs')

const packageRoot = resolve(__dirname, '..')
const installerPath = join(packageRoot, 'resources', 'cua-driver', 'install.sh')
const uninstallerPath = join(packageRoot, 'resources', 'cua-driver', 'uninstall.sh')

function writeLine(message = '') {
  process.stdout.write(`${message}\n`)
}

function exitWith(result) {
  if (result.error) {
    console.error(`[cua-driver] ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status == null ? 1 : result.status)
}

function runLongLived(command, args) {
  const child = spawn(command, args, {
    env: process.env,
    stdio: 'inherit'
  })
  child.once('error', (error) => {
    console.error(`[cua-driver] ${error.message}`)
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    if (signal != null) process.exit(1)
    process.exit(code ?? 1)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal))
  }
}

function assertDarwinForInstall() {
  if (process.platform === 'darwin') return
  console.error('[cua-driver] The bundled CuaDriver.app installer is macOS-only.')
  console.error('[cua-driver] Install cua-driver-rs separately for non-macOS hosts.')
  process.exit(1)
}

function installDriver(args = [], options = {}) {
  assertDarwinForInstall()
  if (!existsSync(installerPath)) {
    console.error(`[cua-driver] Missing bundled installer at ${installerPath}`)
    process.exit(1)
  }
  return run('/bin/bash', [installerPath, ...args], options.stderrOnly === true
    ? { stdio: ['ignore', 2, 2] }
    : {})
}

function uninstallDriver(args = []) {
  if (!existsSync(uninstallerPath)) {
    console.error(`[cua-driver] Missing bundled uninstaller at ${uninstallerPath}`)
    process.exit(1)
  }
  return run('/bin/bash', [uninstallerPath, ...args])
}

function ensureInstalled(options = {}) {
  const existing = resolveDriverBinary()
  if (existing != null) return existing

  const installResult = installDriver(['--no-modify-path'], options)
  if (installResult.status !== 0) exitWith(installResult)

  const installed = resolveDriverBinary()
  if (installed != null) return installed
  console.error('[cua-driver] Installation completed, but no cua-driver binary was found.')
  process.exit(1)
}

function ensureCommand(args) {
  const shouldCheckPermissions = !args.includes('--no-permissions')
  const shouldStartDaemon = !args.includes('--no-daemon')
  const quiet = args.includes('--quiet')
  const driverBinary = ensureInstalled()
  const daemon = shouldStartDaemon
    ? startDaemonIfNeeded(driverBinary, { quiet })
    : { running: false, skipped: true, started: false }
  if (shouldStartDaemon && !daemon.skipped && !daemon.running) process.exit(1)

  if (shouldCheckPermissions && process.platform === 'darwin') {
    const permissions = checkPermissions(driverBinary, { prompt: true, quiet })
    if (!permissions.granted) process.exit(1)
  }
  if (shouldStartDaemon && !daemon.skipped && !ensureAgentCursor(driverBinary).ready) process.exit(1)
  if (quiet) return
  writeLine(`[cua-driver] ready: ${driverBinary}`)
  if (shouldStartDaemon && daemon.running) writeLine('[cua-driver] daemon: running')
}

function printDriverPath() {
  const driverBinary = resolveDriverBinary()
  if (driverBinary != null) return writeLine(driverBinary)
  console.error('[cua-driver] No driver binary found. Run `ow-cua-driver ensure` first.')
  process.exit(1)
}

function delegate(args) {
  const isMcp = args[0] === 'mcp'
  const driverBinary = ensureInstalled({ stderrOnly: isMcp })
  if (args[0] === 'call' || args[0] === 'mcp') {
    const daemon = startDaemonIfNeeded(driverBinary, { quiet: true })
    if (!daemon.skipped && !daemon.running) process.exit(1)
    const isPermissionCheck = args[0] === 'call' && args[1] === 'check_permissions'
    if (process.platform === 'darwin' && !isPermissionCheck) {
      const permissions = checkPermissions(driverBinary, {
        prompt: true,
        quiet: true,
        stderrOnly: isMcp
      })
      if (!permissions.granted) process.exit(1)
    }
    if (
      !isPermissionCheck &&
      !daemon.skipped &&
      !ensureAgentCursor(driverBinary, { stderrOnly: isMcp }).ready
    ) process.exit(1)
  }
  if (args[0] === 'mcp') return runLongLived(driverBinary, args)
  exitWith(run(driverBinary, args))
}

function printHelp() {
  writeLine(`OneWorks Cua Driver wrapper

Usage:
  ow-cua-driver ensure [--quiet] [--no-daemon] [--no-permissions]
  ow-cua-driver install [install.sh args...]
  ow-cua-driver uninstall [uninstall.sh args...]
  ow-cua-driver driver-path
  cua-driver <upstream cua-driver args...>

Normal cua-driver call/mcp commands automatically install the signed app,
start the daemon, verify macOS permissions, and prepare the visible Agent pointer
before delegation.`)
}

function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args
  if (command === 'ensure') ensureCommand(rest)
  else if (command === 'install') exitWith(installDriver(rest))
  else if (command === 'uninstall') exitWith(uninstallDriver(rest))
  else if (command === 'driver-path') printDriverPath()
  else if (command === 'wrapper-help') printHelp()
  else delegate(args)
}

module.exports = require('./runtime.cjs')

if (require.main === module) main()
