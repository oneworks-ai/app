const { spawn, spawnSync } = require('node:child_process')
const { accessSync, constants, readFileSync, realpathSync, unlinkSync } = require('node:fs')
const { homedir } = require('node:os')
const { delimiter, join, resolve } = require('node:path')
const process = require('node:process')

const appBinaryPath = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
const userBinaryPath = join(homedir(), '.local', 'bin', 'cua-driver')
const wrapperRealPath = safeRealpath(process.argv[1])
const daemonPollIntervalSeconds = '0.25'
const agentCursorMotion = Object.freeze({
  dwell_after_click_ms: 125,
  glide_duration_ms: 350,
  idle_hide_ms: 1500
})

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function cleanupStaleDaemonState(options = {}) {
  const cacheDir = options.cacheDir ?? join(homedir(), 'Library', 'Caches', 'cua-driver')
  let pid
  try {
    pid = Number.parseInt(readFileSync(join(cacheDir, 'cua-driver.pid'), 'utf8').trim(), 10)
  } catch {
    return false
  }
  if (!Number.isSafeInteger(pid) || pid <= 0 || (options.isProcessAlive ?? isProcessAlive)(pid)) return false

  let removed = false
  for (const fileName of ['cua-driver.sock', 'cua-driver.pid', 'cua-driver.lock']) {
    try {
      unlinkSync(join(cacheDir, fileName))
      removed = true
    } catch (error) {
      if (error?.code !== 'ENOENT') return false
    }
  }
  return removed
}

function safeRealpath(filePath) {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options })
}

function runQuiet(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' })
}

function runCaptured(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function commandOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function printCapturedResult(result, options = {}) {
  if (result.stdout) (options.stderrOnly === true ? process.stderr : process.stdout).write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function findOnPath(name, options = {}) {
  const pathValue = options.pathValue ?? process.env.PATH ?? ''
  const cwd = options.cwd ?? process.cwd()
  const currentWrapperRealPath = options.wrapperRealPath ?? wrapperRealPath
  for (const entry of pathValue.split(delimiter)) {
    if (entry.trim() === '') continue
    const candidate = resolve(cwd, entry, name)
    if (!isExecutable(candidate)) continue
    if (candidate.replaceAll('\\', '/').includes('/node_modules/.bin/')) continue
    if (safeRealpath(candidate) === currentWrapperRealPath) continue
    return candidate
  }
  return undefined
}

function resolveDriverBinary(options = {}) {
  const appPath = options.appBinaryPath ?? appBinaryPath
  const userPath = options.userBinaryPath ?? userBinaryPath
  const pathCandidate = findOnPath('cua-driver', options)
  return [appPath, userPath, pathCandidate]
    .find(candidate => candidate != null && isExecutable(candidate))
}

function daemonIsRunning(driverBinary) {
  return runQuiet(driverBinary, ['status']).status === 0
}

function waitForDaemon(driverBinary, attempts) {
  for (let index = 0; index < attempts; index++) {
    if (daemonIsRunning(driverBinary)) return true
    spawnSync('/bin/sleep', [daemonPollIntervalSeconds])
  }
  return daemonIsRunning(driverBinary)
}

function startDetachedDaemon(driverBinary) {
  try {
    const child = spawn(driverBinary, ['serve'], {
      detached: true,
      env: process.env,
      stdio: 'ignore'
    })
    child.once('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

function startDaemonIfNeeded(driverBinary, options = {}) {
  const quiet = options.quiet === true
  if (process.platform !== 'darwin') return { running: false, skipped: true, started: false }
  if (
    process.env.ONEWORKS_CUA_DRIVER_NO_AUTO_DAEMON === '1' ||
    process.env.CUA_DRIVER_NO_AUTO_DAEMON === '1'
  ) return { running: false, skipped: true, started: false }
  if (daemonIsRunning(driverBinary)) return { running: true, skipped: false, started: false }
  cleanupStaleDaemonState()

  if (!quiet) process.stdout.write('[cua-driver] starting daemon through CuaDriver.app...\n')
  const opened = runQuiet('/usr/bin/open', ['-n', '-g', '-a', 'CuaDriver', '--args', 'serve'])
  if (opened.status === 0 && waitForDaemon(driverBinary, 20)) {
    if (!quiet) process.stdout.write('[cua-driver] daemon ready.\n')
    return { running: true, skipped: false, started: true }
  }

  if (!quiet) process.stdout.write('[cua-driver] app launch did not become ready; trying a detached daemon...\n')
  if (startDetachedDaemon(driverBinary) && waitForDaemon(driverBinary, 40)) {
    if (!quiet) process.stdout.write('[cua-driver] daemon ready (detached fallback).\n')
    return { running: true, skipped: false, started: true }
  }
  console.error('[cua-driver] Could not start the daemon.')
  console.error(`[cua-driver] Try: ${driverBinary} serve`)
  return { running: false, skipped: false, started: false }
}

function permissionOutputIsGranted(output) {
  return output.includes('Accessibility: granted') && output.includes('Screen Recording: granted')
}

function permissionStateFromOutput(output) {
  const readState = (label) => {
    const line = output.split(/\r?\n/).find(value => value.includes(`${label}:`))
    if (line == null) return 'unknown'
    if (/\bgranted\b/i.test(line) && !/\b(?:not granted|denied|required)\b/i.test(line)) return 'granted'
    if (/\b(?:not granted|denied|required)\b/i.test(line)) return 'required'
    return 'unknown'
  }
  return {
    accessibility: readState('Accessibility'),
    screenRecording: readState('Screen Recording')
  }
}

function checkPermissions(driverBinary, options = {}) {
  const result = (options.runCaptured ?? runCaptured)(driverBinary, [
    'call',
    'check_permissions',
    JSON.stringify({ prompt: options.prompt !== false })
  ])
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const output = `${stdout}\n${stderr}`
  const permissions = permissionStateFromOutput(output)
  const granted = result.status === 0 && permissionOutputIsGranted(output)
  if (options.quiet !== true || !granted) {
    if (stdout !== '') (options.stderrOnly === true ? process.stderr : process.stdout).write(stdout)
    if (stderr !== '') process.stderr.write(stderr)
  }
  if (!granted) {
    const hasUnknownState = Object.values(permissions).includes('unknown')
    if (hasUnknownState) {
      console.error('[cua-driver] permission-check-failed: CuaDriver could not determine the current macOS permission state.')
      console.error('[cua-driver] The computer-control service will be restarted automatically on the next retry.')
    } else {
      const missing = [
        permissions.accessibility === 'granted' ? undefined : 'Accessibility',
        permissions.screenRecording === 'granted' ? undefined : 'Screen & System Audio Recording'
      ].filter(Boolean)
      console.error(`[cua-driver] permission-required: ${missing.join(', ')}`)
      console.error('[cua-driver] Open System Settings → Privacy & Security, enable CuaDriver for the permissions above, then retry the original task.')
    }
  }
  return {
    failureKind: granted
      ? undefined
      : Object.values(permissions).includes('unknown') ? 'runtime' : 'permissions',
    granted,
    permissions,
    result
  }
}

function readCursorNumber(output, key) {
  const match = output.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`))
  return match == null ? undefined : Number.parseFloat(match[1])
}

function agentCursorOutputIsReady(output) {
  if (!output.includes('enabled=true')) return false
  return Object.entries(agentCursorMotion).every(([key, expected]) => {
    const outputKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    return readCursorNumber(output, outputKey) === expected
  })
}

function ensureAgentCursor(driverBinary, options = {}) {
  const runner = options.runCaptured ?? runCaptured
  const runCursorCall = (tool, payload = {}) => runner(driverBinary, [
    'call',
    tool,
    JSON.stringify(payload)
  ])
  const initialState = runCursorCall('get_agent_cursor_state')
  const initialOutput = commandOutput(initialState)
  if (initialState.status === 0 && agentCursorOutputIsReady(initialOutput)) {
    return { ready: true, changed: false, result: initialState }
  }

  if (!initialOutput.includes('enabled=true')) {
    const enabled = runCursorCall('set_agent_cursor_enabled', { enabled: true })
    if (enabled.status !== 0) {
      printCapturedResult(enabled, options)
      console.error('[cua-driver] The Agent pointer could not be enabled. Retry the original task.')
      return { ready: false, changed: false, result: enabled }
    }
  }

  const motion = runCursorCall('set_agent_cursor_motion', agentCursorMotion)
  if (motion.status !== 0) {
    printCapturedResult(motion, options)
    console.error('[cua-driver] The Agent pointer motion could not be configured. Retry the original task.')
    return { ready: false, changed: false, result: motion }
  }

  const verified = runCursorCall('get_agent_cursor_state')
  if (verified.status !== 0 || !agentCursorOutputIsReady(commandOutput(verified))) {
    printCapturedResult(verified, options)
    console.error('[cua-driver] The Agent pointer did not become ready. Retry the original task.')
    return { ready: false, changed: true, result: verified }
  }
  return { ready: true, changed: true, result: verified }
}

module.exports = {
  agentCursorOutputIsReady,
  checkPermissions,
  cleanupStaleDaemonState,
  ensureAgentCursor,
  findOnPath,
  permissionOutputIsGranted,
  permissionStateFromOutput,
  resolveDriverBinary,
  run,
  startDaemonIfNeeded
}
