/* eslint-disable max-lines -- command dispatch and its bounded machine-output serializers share one contract. */
import { readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
import process from 'node:process'

import { readDevServiceEvents, readDevServiceLease, withDevServiceOperation } from './coordination'
import { runMain } from './manager'
import { eventsPath, leasePath, managerLogPath, repoRoot, resourceKey, statePath, targetStateDir } from './paths'
import { withDevStartLifecycleLock } from './port-lock'
import { readState } from './process'
import { stateReady, stopManagedState } from './readiness'
import { redactDevServiceText } from './redaction'
import { updateDevServiceStateIfCurrent } from './state'
import { devStartTargets } from './types'
import type { DevServiceOperation, DevServiceStatus, DevServiceStatusDocument, DevStartTarget } from './types'

export type DevServiceCommandAction = 'ensure' | 'events' | 'logs' | 'restart' | 'status' | 'stop'

export interface DevServiceCommandInput {
  action: DevServiceCommandAction
  json?: boolean
  limit?: number
  target?: DevStartTarget
  workspace?: boolean
}

const assertReady = async (target: DevStartTarget, operation: DevServiceOperation) => {
  const state = readState(target)
  if (!await stateReady(state)) {
    throw new Error(`${target} did not produce a ready shared state.`)
  }
  const updated = updateDevServiceStateIfCurrent(target, {
    generation: state?.generation,
    phase: 'ready',
    revision: state?.revision,
    servicePid: state?.servicePid
  }, {
    error: undefined,
    operation,
    phase: 'ready'
  })
  if (updated == null) throw new Error(`${target} changed generation while readiness was confirmed.`)
}

export const ensureDevService = async (
  target: DevStartTarget,
  options: { restart?: boolean; workspace?: boolean } = {}
) => {
  const action = options.restart === true ? 'restart' : 'ensure'
  await withDevStartLifecycleLock(async () => {
    await withDevServiceOperation(target, action, async (operation) => {
      try {
        if (options.restart === true) {
          await stopManagedState(target, operation)
        }
        await runMain(target, {
          operation,
          workspace: options.workspace ?? false
        })
        await assertReady(target, operation)
      } catch (error) {
        const state = readState(target)
        if (state?.generation === operation.id) {
          await stopManagedState(target, operation, {
            error: error instanceof Error ? error.message : String(error),
            finalPhase: 'failed'
          })
        }
        throw error
      }
    })
  })
}

export const stopDevService = async (target: DevStartTarget) => {
  await withDevStartLifecycleLock(async () => {
    await withDevServiceOperation(target, 'stop', async (operation) => {
      await stopManagedState(target, operation)
      if (process.env.ONEWORKS_DEV_SERVICE_JSON !== '1') console.log(`[dev-service] stopped ${target}`)
    })
  })
}

const getStatus = async (target: DevStartTarget): Promise<DevServiceStatus> => {
  const state = readState(target)
  return {
    eventsPath: eventsPath(target),
    lease: readDevServiceLease(target),
    leasePath: leasePath(target),
    ready: await stateReady(state),
    resourceKey: resourceKey(target),
    state,
    statePath: statePath(target),
    target
  }
}

export const getDevServiceStatus = async (
  target?: DevStartTarget
): Promise<DevServiceStatusDocument> => ({
  generatedAt: new Date().toISOString(),
  protocol: 'oneworks.dev-service',
  root: repoRoot,
  services: await Promise.all((target == null ? devStartTargets : [target]).map(getStatus)),
  version: 1
})

const printStatus = (document: DevServiceStatusDocument) => {
  for (const service of document.services) {
    const phase = service.lease == null
      ? service.ready
        ? 'ready'
        : service.state?.phase === 'ready'
        ? 'unhealthy'
        : service.state?.phase ?? 'not-started'
      : `${service.lease.action}:${service.lease.actor}`
    const url = service.state?.controlUrl ?? service.state?.clientUrl ?? service.state?.serverUrl ??
      service.state?.docsUrl
    console.log(`${service.target}\t${phase}${url == null ? '' : `\t${url}`}`)
  }
}

const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export const redactDevServiceLogLine = redactDevServiceText

export const isDevServiceLogPathAllowed = (target: DevStartTarget, path: string) => {
  const name = basename(path)
  if (name !== basename(managerLogPath(target)) && !name.startsWith(`dev-start-${target}.`)) return false
  try {
    const directory = realpathSync(targetStateDir(target))
    const resolved = realpathSync(path)
    const childPath = relative(directory, resolved)
    return childPath !== '' && !childPath.startsWith('..') && !isAbsolute(childPath)
  } catch {
    return false
  }
}

const readLogTail = (target: DevStartTarget, limit: number) => {
  const state = readState(target)
  const paths = [
    ...new Set([
      state?.managerLog ?? managerLogPath(target),
      ...(state?.components ?? [])
        .map(component => component.logPath)
        .filter((path): path is string => path != null)
    ])
  ].filter(path => isDevServiceLogPathAllowed(target, path))
  return {
    logs: paths.map((path) => {
      let lines: string[] = []
      try {
        lines = readFileSync(path, 'utf8')
          .split('\n')
          .slice(-Math.max(0, limit))
          .map(redactDevServiceLogLine)
      } catch {}
      return { lines, path }
    }),
    target
  }
}

export const runDevServiceCommand = async (input: DevServiceCommandInput) => {
  const previousJsonMode = process.env.ONEWORKS_DEV_SERVICE_JSON
  if (input.json === true) process.env.ONEWORKS_DEV_SERVICE_JSON = '1'
  try {
    if (input.action === 'ensure' || input.action === 'restart') {
      const target = input.target ?? 'web'
      await ensureDevService(target, {
        restart: input.action === 'restart',
        workspace: input.workspace
      })
      const document = await getDevServiceStatus(target)
      if (input.json === true) printJson(document)
      return document
    }

    if (input.action === 'stop') {
      await stopDevService(input.target ?? 'web')
      const document = await getDevServiceStatus(input.target ?? 'web')
      if (input.json === true) printJson(document)
      return document
    }

    if (input.action === 'status') {
      const document = await getDevServiceStatus(input.target)
      if (input.json === true) printJson(document)
      else printStatus(document)
      return document
    }

    const target = input.target
    if (target == null) throw new Error(`${input.action} requires a target.`)
    const limit = input.limit ?? 80
    if (input.action === 'events') {
      const value = {
        events: readDevServiceEvents(target, limit),
        path: eventsPath(target),
        target
      }
      printJson(value)
      return value
    }
    const value = readLogTail(target, limit)
    if (input.json === true) printJson(value)
    else {
      for (const log of value.logs) {
        process.stdout.write(`==> ${log.path} <==\n${log.lines.join('\n')}\n`)
      }
    }
    return value
  } catch (error) {
    const message = redactDevServiceText(error instanceof Error ? error.message : String(error))
    if (input.json === true) {
      const target = input.target ?? (input.action === 'status' ? undefined : 'web')
      let status: DevServiceStatusDocument | undefined
      try {
        status = target == null ? undefined : await getDevServiceStatus(target)
      } catch {}
      printJson({
        error: {
          message
        },
        ok: false,
        protocol: 'oneworks.dev-service-error',
        ...(status == null ? {} : { status }),
        version: 1
      })
      throw new Error(message)
    }
    throw error
  } finally {
    if (previousJsonMode == null) delete process.env.ONEWORKS_DEV_SERVICE_JSON
    else process.env.ONEWORKS_DEV_SERVICE_JSON = previousJsonMode
  }
}
