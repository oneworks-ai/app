#!/usr/bin/env node
/* eslint-disable max-lines -- launcher keeps AVD identity, registry, ADB readiness, and optional APK actions together. */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname)
const logDir = resolve(process.env.ONEWORKS_ANDROID_SERVICE_LOG_DIR || resolve(repoRoot, '.logs'))
const coordinationOwnerRoot = process.env.ONEWORKS_ANDROID_OWNER_ROOT?.trim() || null
const directLockHeld = process.env.ONEWORKS_ANDROID_DIRECT_LOCK_HELD === '1'

function fail(message) {
  console.error(`[android-emulator] ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {
    avd: process.env.ONEWORKS_ANDROID_AVD || 'OneWorksApi35Visible',
    gpu: process.env.ONEWORKS_ANDROID_EMULATOR_GPU || 'swiftshader_indirect',
    installApk: undefined,
    startApp: false,
    restart: false,
    wait: true
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--avd') {
      args.avd = argv[++index]
    } else if (arg === '--gpu') {
      args.gpu = argv[++index]
    } else if (arg === '--install-apk') {
      args.installApk = argv[++index]
    } else if (arg === '--start-app') {
      args.startApp = true
    } else if (arg === '--restart') {
      args.restart = true
    } else if (arg === '--no-wait') {
      args.wait = false
    } else {
      fail(`unknown argument: ${arg}`)
    }
  }
  if (!args.avd) fail('missing --avd value')
  return args
}

function enterDirectMachineLease() {
  if (coordinationOwnerRoot != null || directLockHeld) return
  const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__ || process.env.HOME || homedir()
  const serviceDir = resolve(realHome, '.oneworks/dev-service')
  const lockPath = resolve(serviceDir, 'dev-start-android-emulator.operation.lock.guard')
  mkdirSync(serviceDir, { recursive: true })
  const command = process.platform === 'darwin' ? '/usr/bin/lockf' : process.platform === 'linux' ? 'flock' : null
  if (command == null) fail('direct launcher diagnostics require dev-service on this platform')
  const lockArgs = process.platform === 'darwin'
    ? ['-k', '-t', '120', lockPath]
    : ['-w', '120', lockPath]
  const result = spawnSync(command, [...lockArgs, process.execPath, ...process.argv.slice(1)], {
    env: {
      ...process.env,
      ONEWORKS_ANDROID_DIRECT_LOCK_HELD: '1'
    },
    stdio: 'inherit'
  })
  if (result.error) fail(`could not acquire Android machine lease: ${result.error.message}`)
  process.exit(result.status ?? 1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options
  })
  if (result.error) {
    fail(`${command} failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    fail(`${command} exited with ${result.status}${detail ? `\n${detail}` : ''}`)
  }
  return result.stdout ?? ''
}

function getSdkRoot() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || resolve(homedir(), '.codex/android-sdk')
  const emulator = resolve(sdkRoot, 'emulator/emulator')
  if (!existsSync(emulator)) {
    fail(`Android emulator binary not found at ${emulator}`)
  }
  return sdkRoot
}

function serviceName(avd) {
  return `ai.oneworks.android.emulator.${avd.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processFingerprint(pid) {
  const result = spawnSync('ps', ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  return result.status === 0 && result.stdout?.trim() ? result.stdout.trim() : undefined
}

function processMatchesAvd(pid, avd, sdkRoot) {
  if (!isRunning(pid)) return false
  const fingerprint = processFingerprint(pid)
  if (!fingerprint) return false
  const escapedAvd = avd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return fingerprint.includes(resolve(sdkRoot, 'emulator')) &&
    new RegExp(`(?:^|\\s)-avd(?:=|\\s+)${escapedAvd}(?:\\s|$)`).test(fingerprint)
}

function readOwnedPid(path, avd, sdkRoot) {
  try {
    const raw = readFileSync(path, 'utf8').trim()
    let pid
    let recordedFingerprint
    try {
      const record = JSON.parse(raw)
      if (record?.avd !== avd || record?.schemaVersion !== 1) return undefined
      pid = record.pid
      recordedFingerprint = record.fingerprint
    } catch {
      pid = Number.parseInt(raw, 10)
    }
    const fingerprint = processFingerprint(pid)
    if (!processMatchesAvd(pid, avd, sdkRoot)) return undefined
    if (recordedFingerprint != null && recordedFingerprint !== fingerprint) return undefined
    return pid
  } catch {
    return undefined
  }
}

function writeOwnedPid(path, avd, pid) {
  const fingerprint = processFingerprint(pid)
  if (!fingerprint) fail(`could not fingerprint emulator pid=${pid}`)
  if (coordinationOwnerRoot == null) {
    try {
      const existing = JSON.parse(readFileSync(path, 'utf8'))
      if (
        existing?.avd === avd &&
        existing?.coordination === 'dev-service' &&
        existing?.fingerprint === fingerprint &&
        existing?.pid === pid &&
        typeof existing?.ownerRoot === 'string'
      ) return
    } catch {}
  }
  writeFileSync(
    path,
    `${
      JSON.stringify(
        {
          avd,
          coordination: coordinationOwnerRoot == null ? 'uncoordinated' : 'dev-service',
          fingerprint,
          ownerRoot: coordinationOwnerRoot,
          pid,
          schemaVersion: 1
        },
        null,
        2
      )
    }\n`
  )
}

function findOwnedPid(avd, sdkRoot) {
  const result = spawnSync('ps', ['-axo', 'pid=', '-o', 'command='], { encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) return undefined
  for (const line of result.stdout?.split('\n') ?? []) {
    const match = /^\s*(\d+)\s+/.exec(line)
    const pid = match == null ? undefined : Number(match[1])
    if (processMatchesAvd(pid, avd, sdkRoot)) return pid
  }
  return undefined
}

function startDetachedEmulator({ avd, emulator, args, env, name }) {
  mkdirSync(logDir, { recursive: true })
  const logPath = resolve(process.env.ONEWORKS_ANDROID_SERVICE_LOG_PATH || resolve(logDir, `${name}.log`))
  const pidPath = resolve(logDir, `${name}.pid`)
  const logFd = openSync(logPath, 'a')
  const child = spawn(emulator, args, {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      ...env
    },
    stdio: ['ignore', logFd, logFd]
  })
  closeSync(logFd)
  if (!isRunning(child.pid)) fail(`emulator process did not start; see ${logPath}`)
  child.unref()
  writeOwnedPid(pidPath, avd, child.pid)
  return { logPath, pid: child.pid, pidPath }
}

function adbSerials() {
  const adbOutput = spawnSync('adb', ['devices'], { encoding: 'utf8', stdio: 'pipe' }).stdout ?? ''
  return adbOutput
    .split('\n')
    .map((line) => line.trim().match(/^(emulator-\d+)\s+device$/)?.[1])
    .filter(Boolean)
}

function findSerialForAvd(serials, avd) {
  return serials.find((serial) => {
    const result = spawnSync('adb', ['-s', serial, 'emu', 'avd', 'name'], {
      encoding: 'utf8',
      stdio: 'pipe'
    })
    return result.status === 0 && result.stdout?.split('\n').some((line) => line.trim() === avd)
  })
}

function waitForDevice(avd, before, { requireNew }) {
  const deadline = Date.now() + 120_000
  let selected
  while (Date.now() < deadline) {
    const serials = adbSerials()
    const candidates = requireNew ? serials.filter((serial) => !before.has(serial)) : serials
    selected = findSerialForAvd(candidates, avd)
    if (selected) {
      const booted = spawnSync('adb', ['-s', selected, 'shell', 'getprop', 'sys.boot_completed'], {
        encoding: 'utf8',
        stdio: 'pipe'
      }).stdout?.trim()
      if (booted === '1') return selected
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
  }
  fail('timed out waiting for emulator to boot')
}

const args = parseArgs(process.argv.slice(2))
enterDirectMachineLease()
const sdkRoot = getSdkRoot()
const emulator = resolve(sdkRoot, 'emulator/emulator')
const name = serviceName(args.avd)
const pidPath = resolve(logDir, `${name}.pid`)
const beforeSerials = new Set(adbSerials())
const emulatorArgs = ['-avd', args.avd, '-no-audio', '-no-boot-anim', '-gpu', args.gpu]
const previousPid = readOwnedPid(pidPath, args.avd, sdkRoot) ?? findOwnedPid(args.avd, sdkRoot)
let launched = false
if (args.restart) {
  if (coordinationOwnerRoot == null) {
    fail('--restart requires the machine-level dev-service lease; use dev-service restart with explicit authorization')
  }
  if (previousPid != null) process.kill(previousPid, 'SIGTERM')
}

if (!args.restart && previousPid != null) {
  writeOwnedPid(pidPath, args.avd, previousPid)
  console.log(`[android-emulator] reusing ${name} pid=${previousPid}`)
} else {
  const child = startDetachedEmulator({
    avd: args.avd,
    args: emulatorArgs,
    emulator,
    env: {
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot
    },
    name
  })
  launched = true
  console.log(`[android-emulator] launched ${name} pid=${child.pid}`)
}
if (!args.wait) {
  console.log(`[android-emulator] log: ${resolve(logDir, `${name}.log`)}`)
  process.exit(0)
}

const serial = waitForDevice(args.avd, beforeSerials, { requireNew: launched })
console.log(`[android-emulator] device=${serial}`)

if (args.installApk) {
  run('adb', ['-s', serial, 'install', '-r', args.installApk], { stdio: 'inherit' })
}

if (args.startApp) {
  run('adb', ['-s', serial, 'shell', 'appops', 'set', 'ai.oneworks.android', 'MANAGE_EXTERNAL_STORAGE', 'allow'], {
    stdio: 'ignore'
  })
  run('adb', ['-s', serial, 'shell', 'am', 'start', '-n', 'ai.oneworks.android/.MainActivity'], { stdio: 'inherit' })
}
