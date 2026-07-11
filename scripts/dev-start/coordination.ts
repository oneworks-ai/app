import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { withCrossProcessLock } from './file-lock'
import { eventsPath, leasePath, normalizeText, resourceKey } from './paths'
import { readJson } from './process'
import { pidRunning, processFingerprint } from './process-identity'
import { redactDevServiceText } from './redaction'
import { devStartTargets } from './types'
import type { DevServiceAction, DevServiceEvent, DevServiceLease, DevServiceOperation, DevStartTarget } from './types'

const parseLease = (value: unknown): DevServiceLease | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const lease = value as Partial<DevServiceLease>
  if (
    (lease.action !== 'ensure' && lease.action !== 'restart' && lease.action !== 'stop') ||
    typeof lease.actor !== 'string' ||
    typeof lease.fingerprint !== 'string' ||
    typeof lease.id !== 'string' ||
    typeof lease.pid !== 'number' ||
    typeof lease.resourceKey !== 'string' ||
    !devStartTargets.includes(lease.target as DevStartTarget) ||
    typeof lease.startedAt !== 'string'
  ) return undefined
  return lease as DevServiceLease
}

export const resolveDevServiceActor = () => (
  normalizeText(process.env.ONEWORKS_DEV_SERVICE_ACTOR) ??
    normalizeText(process.env.CODEX_THREAD_ID)?.replace(/^/, 'codex:') ??
    `pid:${process.pid}`
)

export const readDevServiceLease = (
  target: DevStartTarget,
  path = leasePath(target)
) => {
  const value = readJson(join(path, 'owner.json'))
  const lease = parseLease(value)
  if (lease == null || lease.resourceKey !== resourceKey(target)) return undefined
  if (!pidRunning(lease.pid) || processFingerprint(lease.pid) !== lease.fingerprint) return undefined
  return lease
}

const appendEvent = (
  target: DevStartTarget,
  operation: DevServiceOperation,
  phase: DevServiceEvent['phase'],
  error?: unknown,
  path = eventsPath(target)
) => {
  mkdirSync(dirname(path), { recursive: true })
  const event: DevServiceEvent = {
    action: operation.action,
    actor: operation.actor,
    ...(error == null
      ? {}
      : { error: redactDevServiceText(error instanceof Error ? error.message : String(error)).slice(0, 500) }),
    id: randomUUID(),
    operationId: operation.id,
    phase,
    pid: process.pid,
    protocol: 'oneworks.dev-service-event',
    target,
    timestamp: new Date().toISOString(),
    version: 1
  }
  appendFileSync(path, `${JSON.stringify(event)}\n`)
}

export const withDevServiceOperation = async <T>(
  target: DevStartTarget,
  action: DevServiceAction,
  run: (operation: DevServiceOperation) => Promise<T>,
  paths: { events?: string; lease?: string } = {}
) => {
  const resolvedEventsPath = paths.events ?? eventsPath(target)
  const resolvedLeasePath = paths.lease ?? leasePath(target)
  return await withCrossProcessLock(`${resolvedLeasePath}.guard`, async () => {
    const fingerprint = processFingerprint(process.pid)
    if (fingerprint == null) throw new Error('Could not fingerprint the dev-service operation owner.')
    const lease: DevServiceLease = {
      action,
      actor: resolveDevServiceActor(),
      fingerprint,
      id: randomUUID(),
      pid: process.pid,
      resourceKey: resourceKey(target),
      target,
      startedAt: new Date().toISOString()
    }
    mkdirSync(resolvedLeasePath, { recursive: true })
    writeFileSync(join(resolvedLeasePath, 'owner.json'), `${JSON.stringify(lease, null, 2)}\n`)
    const operation: DevServiceOperation = {
      action: lease.action,
      actor: lease.actor,
      id: lease.id,
      startedAt: lease.startedAt
    }
    appendEvent(target, operation, 'started', undefined, resolvedEventsPath)
    try {
      const result = await run(operation)
      appendEvent(target, operation, 'completed', undefined, resolvedEventsPath)
      return result
    } catch (error) {
      appendEvent(target, operation, 'failed', error, resolvedEventsPath)
      throw error
    } finally {
      const current = readDevServiceLease(target, resolvedLeasePath)
      if (current?.id === operation.id) rmSync(resolvedLeasePath, { recursive: true, force: true })
    }
  })
}

export const readDevServiceEvents = (
  target: DevStartTarget,
  limit: number,
  path = eventsPath(target)
) => {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DevServiceEvent]
        } catch {
          return []
        }
      })
      .slice(-Math.max(0, limit))
  } catch {
    return []
  }
}
