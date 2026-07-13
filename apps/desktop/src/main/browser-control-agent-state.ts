/* eslint-disable max-lines -- this module keeps the complete Agent tab-state lease lifecycle in one auditable boundary. */
import { randomBytes } from 'node:crypto'

import type { BrowserControlAgentAction, BrowserControlAgentActionState } from '@oneworks/types'

import type { BrowserControlPage } from './browser-control-pages'

const defaultActiveDwellMs = 240
const defaultRestoreDwellMs = 420
const releasedLeaseRetentionMs = 60_000
const restoreRetryDelayMs = 100

type AgentActionPhase = Extract<BrowserControlAgentActionState, { phase: 'acting' | 'moving' }>['phase']
type AgentActionOutcome = Extract<BrowserControlAgentActionState, { phase: 'settle' }>['outcome']

interface BrowserControlAgentStateOptions {
  activeDwellMs?: number
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  delay?: (ms: number) => Promise<void>
  now?: () => number
  restoreDwellMs?: number
  sendState: (
    workspaceFolder: string,
    page: BrowserControlPage,
    state: BrowserControlAgentActionState
  ) => Promise<unknown>
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  warn?: (message: string, error: unknown) => void
}

export interface BrowserControlAgentActionLease {
  action: BrowserControlAgentAction
  color: string
  driverInstanceId: string
  operationId: string
  page: BrowserControlPage
  phase: AgentActionPhase
  startedAt: number
  workspaceFolder: string
}

interface BrowserControlAgentActionEntry extends BrowserControlAgentActionLease {
  handleDestroyed: () => void
  handleInPageNavigation: (...args: unknown[]) => void
  handleNavigation: (...args: unknown[]) => void
  restoreTimer?: ReturnType<typeof setTimeout>
}

const wait = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms))

const statusError = (error: unknown) =>
  Object.assign(
    error instanceof Error ? error : new Error(String(error)),
    { code: 'AGENT_ACTION_STATUS_UNAVAILABLE', statusCode: 409 }
  )

const cancellationError = () =>
  Object.assign(
    new Error('The browser Agent action was cancelled before it could run.'),
    { code: 'BROWSER_CONTROL_CANCELLED', statusCode: 409 }
  )

export const createBrowserControlAgentState = (options: BrowserControlAgentStateOptions) => {
  const activeDwellMs = options.activeDwellMs ?? defaultActiveDwellMs
  const cancelTimer = options.clearTimer ?? clearTimeout
  const delay = options.delay ?? wait
  const entries = new Map<number, BrowserControlAgentActionEntry>()
  const releasedDrivers = new Map<string, number>()
  const releasedOperations = new Map<string, number>()
  const now = options.now ?? Date.now
  const restoreDwellMs = options.restoreDwellMs ?? defaultRestoreDwellMs
  const setTimer = options.setTimer ?? setTimeout
  const warn = options.warn ?? ((message: string, error: unknown) => console.warn(message, error))
  let accepting = true

  const driverKey = (workspaceFolder: string, driverInstanceId: string) => `${workspaceFolder}\0${driverInstanceId}`
  const operationKey = (workspaceFolder: string, driverInstanceId: string, operationId: string) =>
    `${driverKey(workspaceFolder, driverInstanceId)}\0${operationId}`
  const pruneReleasedLeases = () => {
    const timestamp = now()
    for (const [key, expiresAt] of releasedDrivers) {
      if (expiresAt <= timestamp) releasedDrivers.delete(key)
    }
    for (const [key, expiresAt] of releasedOperations) {
      if (expiresAt <= timestamp) releasedOperations.delete(key)
    }
  }
  const isReleased = (entry: BrowserControlAgentActionLease) => {
    pruneReleasedLeases()
    return releasedDrivers.has(driverKey(entry.workspaceFolder, entry.driverInstanceId)) ||
      releasedOperations.has(operationKey(
        entry.workspaceFolder,
        entry.driverInstanceId,
        entry.operationId
      ))
  }

  const isCurrent = (entry: BrowserControlAgentActionLease) =>
    entries.get(entry.page.webContents.id)?.operationId === entry.operationId

  const detach = (entry: BrowserControlAgentActionEntry) => {
    if (entry.restoreTimer != null) cancelTimer(entry.restoreTimer)
    entry.page.webContents.off('destroyed', entry.handleDestroyed)
    entry.page.webContents.off('did-navigate-in-page', entry.handleInPageNavigation)
    entry.page.webContents.off('did-start-navigation', entry.handleNavigation)
  }

  const sendIdle = async (entry: BrowserControlAgentActionLease) => {
    const state: BrowserControlAgentActionState = { operation_id: entry.operationId, phase: 'idle' }
    try {
      await options.sendState(entry.workspaceFolder, entry.page, state)
    } catch (error) {
      await delay(restoreRetryDelayMs)
      try {
        await options.sendState(entry.workspaceFolder, entry.page, state)
      } catch (retryError) {
        warn('[browser-control] failed to restore the Agent tab favicon state', retryError ?? error)
      }
    }
  }

  const restore = async (entry: BrowserControlAgentActionEntry) => {
    if (!isCurrent(entry)) return false
    entries.delete(entry.page.webContents.id)
    detach(entry)
    await sendIdle(entry)
    return true
  }

  const attach = (entry: BrowserControlAgentActionEntry) => {
    entry.page.webContents.once('destroyed', entry.handleDestroyed)
    entry.page.webContents.on('did-navigate-in-page', entry.handleInPageNavigation)
    entry.page.webContents.on('did-start-navigation', entry.handleNavigation)
  }

  const begin = async ({
    action,
    color,
    driverInstanceId,
    operationId: requestedOperationId,
    page,
    phase,
    workspaceFolder
  }: {
    action: BrowserControlAgentAction
    color: string
    driverInstanceId: string
    operationId?: string
    page: BrowserControlPage
    phase: AgentActionPhase
    workspaceFolder: string
  }): Promise<BrowserControlAgentActionLease> => {
    if (!accepting) throw cancellationError()
    pruneReleasedLeases()
    const operationId = requestedOperationId ?? randomBytes(12).toString('hex')
    if (
      releasedDrivers.has(driverKey(workspaceFolder, driverInstanceId)) ||
      releasedOperations.has(operationKey(workspaceFolder, driverInstanceId, operationId))
    ) {
      throw cancellationError()
    }
    const previous = entries.get(page.webContents.id)
    if (previous != null) detach(previous)

    const entry = {
      action,
      color,
      driverInstanceId,
      operationId,
      page,
      phase,
      startedAt: now(),
      workspaceFolder,
      handleDestroyed: () => {
        void restore(entry)
      },
      handleInPageNavigation: (...args: unknown[]) => {
        const isMainFrame = typeof args[2] === 'boolean' ? args[2] : true
        if (isMainFrame) void restore(entry)
      },
      handleNavigation: (...args: unknown[]) => {
        const isMainFrame = typeof args[3] === 'boolean' ? args[3] : true
        if (isMainFrame) void restore(entry)
      }
    } satisfies BrowserControlAgentActionEntry
    entries.set(page.webContents.id, entry)
    attach(entry)

    try {
      await options.sendState(workspaceFolder, page, {
        action,
        color,
        operation_id: operationId,
        phase
      })
    } catch (error) {
      if (isCurrent(entry)) {
        entries.delete(page.webContents.id)
        detach(entry)
      }
      await Promise.all([
        sendIdle(entry),
        ...(previous == null || previous.operationId === entry.operationId ? [] : [sendIdle(previous)])
      ])
      throw statusError(error)
    }
    if (!accepting || !isCurrent(entry) || isReleased(entry)) {
      if (isCurrent(entry)) await restore(entry)
      throw cancellationError()
    }
    return entry
  }

  const settle = async (lease: BrowserControlAgentActionLease, outcome: AgentActionOutcome) => {
    const remainingDwellMs = Math.max(0, activeDwellMs - (now() - lease.startedAt))
    if (remainingDwellMs > 0) await delay(remainingDwellMs)
    const entry = entries.get(lease.page.webContents.id)
    if (entry == null || entry.operationId !== lease.operationId) return false

    try {
      await options.sendState(entry.workspaceFolder, entry.page, {
        action: entry.action,
        color: entry.color,
        operation_id: entry.operationId,
        outcome,
        phase: 'settle'
      })
    } catch (error) {
      warn('[browser-control] failed to show the Agent tab favicon settle state', error)
    }
    if (!isCurrent(entry)) return false
    entry.restoreTimer = setTimer(() => void restore(entry), restoreDwellMs)
    return true
  }

  const clearMatching = async (predicate: (entry: BrowserControlAgentActionEntry) => boolean) => {
    const matching = [...entries.values()].filter(predicate)
    await Promise.all(matching.map(async entry => await restore(entry)))
    return matching.length
  }

  const releaseDriver = async (
    workspaceFolder: string,
    driverInstanceId: string,
    operationId?: string
  ) => {
    pruneReleasedLeases()
    const expiresAt = now() + releasedLeaseRetentionMs
    if (operationId == null) releasedDrivers.set(driverKey(workspaceFolder, driverInstanceId), expiresAt)
    else releasedOperations.set(operationKey(workspaceFolder, driverInstanceId, operationId), expiresAt)
    return {
      ok: true,
      restored_pages: await clearMatching(
        entry =>
          entry.workspaceFolder === workspaceFolder &&
          entry.driverInstanceId === driverInstanceId &&
          (operationId == null || entry.operationId === operationId)
      )
    }
  }

  const dispose = async () => {
    accepting = false
    await clearMatching(() => true)
  }

  const resume = () => {
    releasedDrivers.clear()
    releasedOperations.clear()
    accepting = true
  }

  return {
    begin,
    dispose,
    getActiveCount: () => entries.size,
    releaseDriver,
    resume,
    settle
  }
}

export type BrowserControlAgentState = ReturnType<typeof createBrowserControlAgentState>
