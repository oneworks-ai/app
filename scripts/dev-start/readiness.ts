/* eslint-disable max-lines -- health validation and identity-safe shutdown share one state contract. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import process from 'node:process'

import { fetchOk, urlReady } from './network'
import { isMachineScopedTarget, log, managerLogPath, repoRoot, sleep, statePath } from './paths'
import { isPositivePid, readJson, readState, runSync } from './process'
import {
  pidRunning,
  processCwd,
  processFingerprint,
  processFingerprintMatches,
  terminateTrackedPid
} from './process-identity'
import { redactDevServiceText } from './redaction'
import { updateDevServiceState, updateDevServiceStateIfCurrent, writeDevServiceState } from './state'
import type { DevServiceComponentState, DevServiceOperation, DevStartState, DevStartTarget } from './types'

export const printReady = (state: DevStartState) => {
  if (process.env.ONEWORKS_DEV_SERVICE_JSON === '1') return
  log('ready')
  if (state.clientUrl != null) console.log(`CLIENT_URL=${state.clientUrl}`)
  if (state.serverUrl != null) console.log(`SERVER_URL=${state.serverUrl}`)
  if (state.docsUrl != null) console.log(`DOCS_URL=${state.docsUrl}`)
  if (state.linkedHomepageUrl != null) console.log(`HOMEPAGE_URL=${state.linkedHomepageUrl}`)
  if (state.linkedDocsUrl != null) console.log(`LINKED_DOCS_URL=${state.linkedDocsUrl}`)
  if (state.controlUrl != null) console.log(`CONTROL_URL=${state.controlUrl}`)
  if (state.deviceSerial != null) console.log(`DEVICE_SERIAL=${state.deviceSerial}`)
  if (state.devicePid != null) console.log(`DEVICE_PID=${state.devicePid}`)
  if (state.desktopPid != null) console.log(`DESKTOP_PID=${state.desktopPid}`)
  if (state.servicePid != null) console.log(`SERVICE_PID=${state.servicePid}`)
  if (state.managerLog != null) console.log(`LOG_FILE=${state.managerLog}`)
}

const deviceReady = (component: DevServiceComponentState, state: DevStartState) => {
  const serial = component.metadata?.serial ?? state.deviceSerial
  if (serial == null) return false
  try {
    const result = runSync('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      allowFailure: true,
      stdio: 'pipe'
    })
    return result.status === 0 && result.stdout?.toString().trim() === '1'
  } catch {
    return false
  }
}

const componentReady = async (component: DevServiceComponentState, state: DevStartState) => {
  if (!isPositivePid(component.pid) || !pidRunning(component.pid)) return false
  if (!processFingerprintMatches(processFingerprint(component.pid), component.fingerprint)) return false
  if (component.kind === 'device' && !deviceReady(component, state)) return false
  if (component.healthUrl != null && !await fetchOk(component.healthUrl)) return false
  return component.pid != null || component.healthUrl != null || component.kind === 'device'
}

export const stateReady = async (state: DevStartState | undefined) => {
  if (state == null) return false
  if (state.schemaVersion !== 2) return false
  if (state.scope !== 'machine' && state.root !== repoRoot) return false
  if (state.phase !== 'ready') return false
  if (state.components == null || state.components.length === 0) return false
  const readiness = await Promise.all(state.components.map(async component => await componentReady(component, state)))
  if (!readiness.every(Boolean)) return false
  if (state.servicePid != null) {
    if (!isPositivePid(state.servicePid) || !pidRunning(state.servicePid)) return false
    if (
      !processFingerprintMatches(processFingerprint(state.servicePid), state.serviceFingerprint)
    ) return false
  }
  if (state.target === 'docs') {
    if (typeof state.linkedHomepageUrl !== 'string') return false
    if (!(await urlReady(state.linkedHomepageUrl))) return false
  }
  return true
}

export const stateHasLiveProcesses = (state: DevStartState | undefined) => (
  [
    state?.servicePid,
    state?.serverPid,
    state?.clientPid,
    state?.desktopPid,
    state?.devicePid,
    ...(state?.components ?? []).map(component => component.pid)
  ].some(pid => pidRunning(pid))
)

export const assertTargetStartable = (target: DevStartTarget) => {
  const state = readState(target)
  if (!stateHasLiveProcesses(state)) return
  throw new Error(
    `${target} still has a tracked process in phase ${state?.phase ?? 'unknown'}. ` +
      `An explicitly authorized dev-service stop ${target} is required before ensure can replace it.`
  )
}

export const reuseIfReady = async (target: DevStartTarget, launchIdentity?: string) => {
  const state = readState(target)
  if (
    (target === 'electron' || target === 'electron-workspace') &&
    state?.ownerRoot !== repoRoot
  ) return false
  if (launchIdentity != null && state?.launchIdentity !== launchIdentity) return false
  if (await stateReady(state)) {
    printReady(state as DevStartState)
    return true
  }
  return false
}

export const stopManagedState = async (
  target: DevStartTarget,
  operation?: DevServiceOperation,
  options: { error?: string; finalPhase?: 'failed' | 'stopped' } = {}
) => {
  const state = readState(target)
  if (state == null || (!isMachineScopedTarget(target) && state.root !== repoRoot)) return

  const tracked = new Map<number, { fingerprint?: string; label: string }>()
  const resolveFingerprint = (pid: number | undefined, fingerprint: string | undefined) => {
    if (fingerprint != null || state.schemaVersion === 2 || pid == null || state.root == null) return fingerprint
    const cwd = processCwd(pid)
    const legacyRoot = resolve(state.root)
    if (cwd == null || (resolve(cwd) !== legacyRoot && !resolve(cwd).startsWith(`${legacyRoot}${sep}`))) {
      return undefined
    }
    return processFingerprint(pid)
  }
  const addTracked = (pid: number | undefined, fingerprint: string | undefined, label: string) => {
    if (pid != null) tracked.set(pid, { fingerprint: resolveFingerprint(pid, fingerprint), label })
  }
  addTracked(state.servicePid, state.serviceFingerprint, `${target} manager`)
  addTracked(state.clientPid, state.clientFingerprint, `${target} client`)
  addTracked(state.serverPid, state.serverFingerprint, `${target} server`)
  addTracked(
    state.desktopPid,
    state.components?.find(component => component.pid === state.desktopPid)?.fingerprint,
    `${target} desktop`
  )
  addTracked(
    state.devicePid,
    state.components?.find(component => component.pid === state.devicePid)?.fingerprint,
    `${target} device`
  )
  for (const component of state.components ?? []) {
    addTracked(component.pid, component.fingerprint, `${target}:${component.id}`)
  }
  for (const [pid, identity] of tracked) {
    if (pidRunning(pid) && identity.fingerprint == null) {
      throw new Error(`Refusing to stop ${identity.label} pid=${pid}: legacy process ownership is not verifiable.`)
    }
  }

  const stoppingPatch: Partial<DevStartState> = {
    clientFingerprint: state.clientPid == null ? state.clientFingerprint : tracked.get(state.clientPid)?.fingerprint,
    components: state.components?.map(component => ({
      ...component,
      fingerprint: component.pid == null ? component.fingerprint : tracked.get(component.pid)?.fingerprint
    })),
    operation: operation ?? state.operation,
    phase: 'stopping',
    serverFingerprint: state.serverPid == null ? state.serverFingerprint : tracked.get(state.serverPid)?.fingerprint,
    serviceFingerprint: state.servicePid == null ? state.serviceFingerprint : tracked.get(state.servicePid)?.fingerprint
  }
  if (state.schemaVersion === 2) {
    updateDevServiceState(target, stoppingPatch)
  } else {
    writeDevServiceState(target, {
      ...state,
      ...stoppingPatch,
      ownerRoot: state.ownerRoot ?? state.root
    })
  }

  try {
    if (state.deviceSerial != null) {
      const deviceComponent = state.components?.find(component => component.kind === 'device')
      const avd = deviceComponent?.metadata?.avd
      if (
        deviceComponent?.pid == null ||
        deviceComponent.fingerprint == null ||
        !processFingerprintMatches(processFingerprint(deviceComponent.pid), deviceComponent.fingerprint)
      ) {
        throw new Error(`Refusing to stop ${target}: emulator process identity no longer matches shared state.`)
      }
      if (avd != null) {
        const avdResult = runSync('adb', ['-s', state.deviceSerial, 'emu', 'avd', 'name'], {
          allowFailure: true,
          stdio: 'pipe'
        })
        const reportedAvd = avdResult.stdout?.toString().split('\n').map(line => line.trim())
          .find(line => line !== '' && line !== 'OK')
        if (avdResult.status !== 0 || reportedAvd !== avd) {
          throw new Error(`Refusing to stop ${target}: ADB serial no longer belongs to AVD ${avd}.`)
        }
      }
      runSync('adb', ['-s', state.deviceSerial, 'emu', 'kill'], {
        allowFailure: true,
        stdio: 'pipe'
      })
    }
    for (const [pid, identity] of tracked) {
      await terminateTrackedPid({
        ...identity,
        pid,
        timeoutMs: target === 'desktop-control' ? 5_000 : 3_000
      })
    }
    for (const component of state.components ?? []) {
      if (component.healthUrl != null && await fetchOk(component.healthUrl)) {
        throw new Error(`${target}:${component.id} is still healthy after tracked processes stopped.`)
      }
    }
  } catch (error) {
    updateDevServiceState(target, {
      error: error instanceof Error ? error.message : String(error),
      operation: operation ?? state.operation,
      phase: 'failed'
    })
    throw error
  }
  updateDevServiceState(target, {
    clientPid: undefined,
    components: state.components?.map(component => ({ ...component, fingerprint: undefined, pid: undefined })),
    desktopPid: undefined,
    devicePid: undefined,
    deviceSerial: undefined,
    endedAt: new Date().toISOString(),
    error: options.error,
    generation: undefined,
    operation: operation ?? state.operation,
    phase: options.finalPhase ?? 'stopped',
    clientFingerprint: undefined,
    serverFingerprint: undefined,
    serviceFingerprint: undefined,
    serverPid: undefined,
    servicePid: undefined
  })
}

export const assertStateCanBeForgotten = async (
  target: DevStartTarget,
  state: DevStartState,
  dependencies: {
    fetchHealthy?: (url: string) => Promise<boolean>
    fingerprint?: (pid: number) => string | undefined
    isRunning?: (pid: number) => boolean
  } = {}
) => {
  if (isMachineScopedTarget(target)) {
    throw new Error(`Refusing to forget stale state for machine-scoped target ${target}.`)
  }
  if (state.schemaVersion !== 2 || !Number.isInteger(state.revision)) {
    throw new Error(`Refusing to forget stale state for ${target}: schema v2 with a concrete revision is required.`)
  }
  const fetchHealthy = dependencies.fetchHealthy ?? fetchOk
  const fingerprint = dependencies.fingerprint ?? processFingerprint
  const isRunning = dependencies.isRunning ?? pidRunning
  const healthUrls = [
    ...new Set(
      (state.components ?? [])
        .map(component => component.healthUrl)
        .filter((value): value is string => value != null)
    )
  ]
  if ((await Promise.all(healthUrls.map(async url => await fetchHealthy(url)))).some(Boolean)) {
    throw new Error(`Refusing to forget stale state for ${target}: a recorded health endpoint is still reachable.`)
  }

  const tracked = new Map<number, Set<string | undefined>>()
  const add = (pid: number | undefined, expected: string | undefined) => {
    if (pid == null) return
    const recorded = tracked.get(pid) ?? new Set<string | undefined>()
    recorded.add(expected)
    tracked.set(pid, recorded)
  }
  add(state.servicePid, state.serviceFingerprint)
  add(state.clientPid, state.clientFingerprint)
  add(state.serverPid, state.serverFingerprint)
  add(state.desktopPid, state.components?.find(component => component.pid === state.desktopPid)?.fingerprint)
  add(state.devicePid, state.components?.find(component => component.pid === state.devicePid)?.fingerprint)
  for (const component of state.components ?? []) add(component.pid, component.fingerprint)

  for (const [pid, expected] of tracked) {
    if (!isRunning(pid)) continue
    const actual = fingerprint(pid)
    if (
      actual == null ||
      expected.has(undefined) ||
      [...expected].some(recorded => processFingerprintMatches(actual, recorded))
    ) {
      throw new Error(
        `Refusing to forget stale state for ${target}: tracked pid=${pid} is still owned or cannot be disproven.`
      )
    }
  }
}

export const forgetStaleManagedState = async (
  target: DevStartTarget,
  operation?: DevServiceOperation
) => {
  if (isMachineScopedTarget(target)) {
    throw new Error(`Refusing to forget stale state for machine-scoped target ${target}.`)
  }
  const state = readState(target)
  if (state == null || state.root !== repoRoot) return
  await assertStateCanBeForgotten(target, state)
  // Recheck immediately before the CAS write so a recovering health endpoint
  // or a newly matching process identity cannot be forgotten mid-operation.
  await assertStateCanBeForgotten(target, state)
  const updated = updateDevServiceStateIfCurrent(target, {
    revision: state.revision
  }, {
    clientFingerprint: undefined,
    clientPid: undefined,
    components: state.components?.map(component => ({ ...component, fingerprint: undefined, pid: undefined })),
    desktopPid: undefined,
    devicePid: undefined,
    deviceSerial: undefined,
    endedAt: new Date().toISOString(),
    error: undefined,
    generation: undefined,
    operation: operation ?? state.operation,
    phase: 'stopped',
    serverFingerprint: undefined,
    serverPid: undefined,
    serviceFingerprint: undefined,
    servicePid: undefined
  })
  if (updated == null) {
    throw new Error(`Refusing to forget stale state for ${target}: shared state changed during recovery.`)
  }
}

export const waitForReady = async (target: DevStartTarget) => {
  const path = statePath(target)
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = readJson(path)
    if (state != null && typeof state === 'object' && await stateReady(state as DevStartState)) {
      printReady(state as DevStartState)
      return
    }
    if (
      state != null &&
      typeof state === 'object' &&
      (state as DevStartState).phase === 'failed'
    ) {
      const failed = state as DevStartState
      throw new Error(failed.error ?? `${target} reported a failed state.`)
    }
    await sleep(500)
  }

  const managerLog = managerLogPath(target)
  log(`failed to start ${target} within 60s`)
  if (existsSync(managerLog) && process.env.ONEWORKS_DEV_SERVICE_JSON !== '1') {
    console.error(
      readFileSync(managerLog, 'utf8').split('\n').slice(-80).map(redactDevServiceText).join('\n')
    )
  }
  throw new Error(`Failed to start ${target} within 60s. See ${managerLog}.`)
}
