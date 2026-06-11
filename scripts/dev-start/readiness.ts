import { existsSync, readFileSync, rmSync } from 'node:fs'
import process from 'node:process'

import { serverReady, urlReady } from './network'
import { log, managerLogPath, repoRoot, sleep, statePath } from './paths'
import { isPositivePid, killPid, readJson, readState } from './process'
import type { DevStartState, DevStartTarget } from './types'

export const printReady = (state: DevStartState) => {
  log('ready')
  if (state.clientUrl != null) console.log(`CLIENT_URL=${state.clientUrl}`)
  if (state.serverUrl != null) console.log(`SERVER_URL=${state.serverUrl}`)
  if (state.docsUrl != null) console.log(`DOCS_URL=${state.docsUrl}`)
  if (state.linkedHomepageUrl != null) console.log(`HOMEPAGE_URL=${state.linkedHomepageUrl}`)
  if (state.linkedDocsUrl != null) console.log(`LINKED_DOCS_URL=${state.linkedDocsUrl}`)
  if (state.desktopPid != null) console.log(`DESKTOP_PID=${state.desktopPid}`)
  if (state.servicePid != null) console.log(`SERVICE_PID=${state.servicePid}`)
  if (state.managerLog != null) console.log(`LOG_FILE=${state.managerLog}`)
}

export const stateReady = async (state: DevStartState | undefined) => {
  if (state?.root !== repoRoot) return false
  if (typeof state.serverUrl === 'string' && !(await serverReady(state.serverUrl))) return false
  if (typeof state.clientUrl === 'string' && !(await urlReady(state.clientUrl))) return false
  if (typeof state.docsUrl === 'string' && !(await urlReady(state.docsUrl))) return false
  if (state.target === 'docs') {
    if (typeof state.linkedHomepageUrl !== 'string') return false
    if (!(await urlReady(state.linkedHomepageUrl))) return false
  }
  if (state.target === 'homepage') {
    if (!isPositivePid(state.clientPid) || !isPositivePid(state.serverPid)) return false
    try {
      process.kill(state.clientPid, 0)
      process.kill(state.serverPid, 0)
      return true
    } catch {
      return false
    }
  }
  if (state.readiness === 'process' && isPositivePid(state.desktopPid)) {
    try {
      process.kill(state.desktopPid, 0)
      return true
    } catch {
      return false
    }
  }
  return typeof state.clientUrl === 'string' || typeof state.serverUrl === 'string' || typeof state.docsUrl === 'string'
}

export const reuseIfReady = async (target: DevStartTarget) => {
  const state = readState(target)
  if (await stateReady(state)) {
    printReady(state as DevStartState)
    return true
  }
  return false
}

export const stopStaleState = async (target: DevStartTarget) => {
  const state = readState(target)
  if (state?.root !== repoRoot) return

  for (const pid of [state.clientPid, state.serverPid, state.desktopPid, state.servicePid]) {
    killPid(pid)
  }
  await sleep(500)
  rmSync(statePath(target), { force: true })
}

export const waitForReady = async (target: DevStartTarget) => {
  const path = statePath(target)
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = readJson(path)
    if (state != null && typeof state === 'object' && await stateReady(state as DevStartState)) {
      printReady(state as DevStartState)
      return
    }
    await sleep(500)
  }

  const managerLog = managerLogPath(target)
  log(`failed to start ${target} within 60s`)
  if (existsSync(managerLog)) {
    console.error(readFileSync(managerLog, 'utf8').split('\n').slice(-80).join('\n'))
  }
  process.exit(1)
}
