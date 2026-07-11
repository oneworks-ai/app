import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import process from 'node:process'

import { componentLogPath, machineServiceDir, managerLogPath, repoRoot, sleep } from './paths'
import { readState, runSync, spawnDetachedLogged, waitForChildSpawn } from './process'
import { pidRunning, processFingerprint } from './process-identity'
import { printReady, stateReady } from './readiness'
import { writeDevServiceState } from './state'
import type { DevServiceOperation, DevStartTarget, TargetConfig } from './types'

const resolveDefaultDesktopDevRuntimeVersion = () => (
  `dev-${createHash('sha256').update(repoRoot).digest('hex').slice(0, 12)}`
)

export const resolveDesktopWorkspaceLaunchFolder = (root = repoRoot) => root

export const resolveElectronLaunchIdentity = (config: TargetConfig) => (
  config.desktopWorkspace === true ? `workspace:${repoRoot}` : `empty:${repoRoot}`
)

export const startElectron = async (
  target: DevStartTarget,
  config: TargetConfig,
  operation?: DevServiceOperation
) => {
  const siblingTarget = target === 'electron' ? 'electron-workspace' : 'electron'
  if (await stateReady(readState(siblingTarget))) {
    throw new Error(
      `${siblingTarget} is already running. Electron targets share one single-instance slot; stop it explicitly first.`
    )
  }
  writeFileSync(managerLogPath(target), '')

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (config.desktopWorkspace === true) {
    env.ONEWORKS_DESKTOP_WORKSPACE = resolveDesktopWorkspaceLaunchFolder()
    delete env.ONEWORKS_DESKTOP_LAUNCH_MODE
  } else {
    env.ONEWORKS_DESKTOP_LAUNCH_MODE = env.ONEWORKS_DESKTOP_LAUNCH_MODE?.trim() || 'empty'
  }
  const runtimePackageCacheVersion = env.ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION?.trim() ||
    env.ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION?.trim() ||
    resolveDefaultDesktopDevRuntimeVersion()
  env.ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION = runtimePackageCacheVersion
  env.ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION = runtimePackageCacheVersion

  const child = spawnDetachedLogged({
    args: ['apps/desktop/scripts/dev.cjs', ...(config.desktopWorkspace === true ? ['--workspace'] : [])],
    command: process.execPath,
    cwd: repoRoot,
    env,
    logPath: managerLogPath(target)
  })
  await waitForChildSpawn(child, `${target} desktop`)
  const fingerprint = processFingerprint(child.pid)
  if (fingerprint == null) {
    child.kill('SIGTERM')
    throw new Error(`Could not fingerprint ${target} desktop process.`)
  }

  let state
  try {
    state = writeDevServiceState(target, {
      components: [
        {
          id: 'electron',
          fingerprint,
          kind: 'process',
          logPath: managerLogPath(target),
          pid: child.pid
        }
      ],
      desktopPid: child.pid,
      generation: operation?.id,
      launchIdentity: resolveElectronLaunchIdentity(config),
      ownerRoot: repoRoot,
      managerLog: managerLogPath(target),
      operation,
      phase: 'ready',
      readiness: 'process',
      root: repoRoot,
      target
    })
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
  await sleep(1500)
  if (!pidRunning(child.pid) || processFingerprint(child.pid) !== fingerprint) {
    throw new Error(`${target} desktop process exited before readiness.`)
  }
  printReady(state)
}

export const startAndroidEmulator = (operation?: DevServiceOperation) => {
  const result = runSync(process.execPath, ['apps/android/scripts/launch-visible-emulator.mjs'], {
    allowFailure: true,
    env: {
      ...process.env,
      ONEWORKS_ANDROID_OWNER_ROOT: repoRoot,
      ONEWORKS_ANDROID_SERVICE_LOG_DIR: machineServiceDir,
      ONEWORKS_ANDROID_SERVICE_LOG_PATH: componentLogPath('android-emulator', 'device')
    },
    stdio: 'pipe'
  })
  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`
  if (process.env.ONEWORKS_DEV_SERVICE_JSON !== '1') process.stdout.write(output)
  if (result.status !== 0) {
    throw new Error(`Android emulator launcher exited with ${result.status ?? 'unknown status'}.`)
  }

  const processMatch = /\[android-emulator\] (?:launched|reusing) (\S+) pid=(\d+)/u.exec(output)
  const serialMatch = /\[android-emulator\] device=(\S+)/u.exec(output)
  if (processMatch == null || serialMatch == null) {
    throw new Error('Android emulator launcher did not report its process and device serial.')
  }

  const devicePid = Number(processMatch[2])
  const deviceSerial = serialMatch[1]!
  const managerLog = componentLogPath('android-emulator', 'device')
  const fingerprint = processFingerprint(devicePid)
  if (fingerprint == null) throw new Error('Could not fingerprint Android emulator process.')
  const state = writeDevServiceState('android-emulator', {
    components: [
      {
        id: 'android-emulator',
        fingerprint,
        kind: 'device',
        logPath: managerLog,
        metadata: {
          avd: process.env.ONEWORKS_ANDROID_AVD ?? 'OneWorksApi35Visible',
          serial: deviceSerial
        },
        pid: devicePid
      }
    ],
    devicePid,
    deviceSerial,
    generation: operation?.id,
    launchIdentity: `avd:${process.env.ONEWORKS_ANDROID_AVD ?? 'OneWorksApi35Visible'}`,
    managerLog,
    operation,
    ownerRoot: repoRoot,
    phase: 'ready',
    readiness: 'device',
    root: repoRoot,
    startedAt: new Date().toISOString(),
    target: 'android-emulator'
  })
  printReady(state)
}
