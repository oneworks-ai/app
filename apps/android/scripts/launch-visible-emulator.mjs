#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname)
const logDir = resolve(repoRoot, '.logs')

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

function readPid(path) {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
    return Number.isInteger(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

function startDetachedEmulator({ emulator, args, env, name }) {
  mkdirSync(logDir, { recursive: true })
  const logPath = resolve(logDir, `${name}.log`)
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
  writeFileSync(pidPath, `${child.pid}\n`)
  return { logPath, pid: child.pid, pidPath }
}

function adbSerials() {
  const adbOutput = spawnSync('adb', ['devices'], { encoding: 'utf8', stdio: 'pipe' }).stdout ?? ''
  return adbOutput
    .split('\n')
    .map((line) => line.trim().match(/^(emulator-\d+)\s+device$/)?.[1])
    .filter(Boolean)
}

function waitForDevice(before, { requireNew }) {
  const deadline = Date.now() + 120_000
  let selected
  while (Date.now() < deadline) {
    const serials = adbSerials()
    selected = serials.find((serial) => !before.has(serial)) ?? (requireNew ? undefined : serials.at(-1))
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
const sdkRoot = getSdkRoot()
const emulator = resolve(sdkRoot, 'emulator/emulator')
const name = serviceName(args.avd)
const pidPath = resolve(logDir, `${name}.pid`)
const beforeSerials = new Set(adbSerials())
const emulatorArgs = ['-avd', args.avd, '-no-audio', '-no-boot-anim', '-gpu', args.gpu]
const previousPid = readPid(pidPath)
let launched = false

if (args.restart) {
  if (isRunning(previousPid)) process.kill(previousPid, 'SIGTERM')
}

if (!args.restart && isRunning(previousPid)) {
  console.log(`[android-emulator] reusing ${name} pid=${previousPid}`)
} else {
  const child = startDetachedEmulator({
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

const serial = waitForDevice(beforeSerials, { requireNew: launched })
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
