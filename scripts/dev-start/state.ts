import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { runWithCrossProcessLockSync } from './file-lock'
import { isMachineScopedTarget, legacyStatePath, normalizeText, repoRoot, statePath } from './paths'
import { redactDevServiceText } from './redaction'
import type { DevServiceOperation, DevStartState, DevStartTarget } from './types'

const operationEnvName = 'ONEWORKS_DEV_SERVICE_OPERATION'

interface StateGenerationExpectation {
  generation?: string
  operationId?: string
  phase?: DevStartState['phase']
  revision?: number
  servicePid?: number
}

const mutateDevServiceState = (
  target: DevStartTarget,
  mode: 'merge' | 'replace',
  value: Partial<DevStartState>,
  expected?: StateGenerationExpectation,
  ownerRoot = repoRoot
) => {
  const path = statePath(target, ownerRoot)
  const mirrorPath = isMachineScopedTarget(target) ? undefined : legacyStatePath(target, ownerRoot)
  const clear = Object.entries(value).filter(([, entry]) => entry === undefined).map(([key]) => key)
  const sanitizedValue = {
    ...value,
    ...(value.error == null ? {} : { error: redactDevServiceText(value.error) })
  }
  const output = runWithCrossProcessLockSync({
    args: [join(__dirname, 'state-mutation-helper.mjs')],
    command: process.execPath,
    input: JSON.stringify({
      expected,
      clear,
      fallbackPath: mirrorPath,
      mirrorPath,
      mirrorRoot: ownerRoot,
      mode,
      path,
      root: ownerRoot,
      scope: isMachineScopedTarget(target) ? 'machine' : 'worktree',
      target,
      value: sanitizedValue
    }),
    path: `${path}.mutation`
  })
  const result = JSON.parse(output) as { matched: boolean; state?: DevStartState }
  return result.matched ? result.state : undefined
}

export const registerLegacyDevServiceState = (target: DevStartTarget, ownerRoot = repoRoot) => {
  if (isMachineScopedTarget(target) || existsSync(statePath(target, ownerRoot))) return false
  let legacyState: DevStartState
  try {
    legacyState = JSON.parse(readFileSync(legacyStatePath(target, ownerRoot), 'utf8')) as DevStartState
  } catch {
    return false
  }
  if (
    legacyState.root !== ownerRoot ||
    legacyState.schemaVersion !== 2 ||
    legacyState.scope !== 'worktree' ||
    legacyState.target !== target
  ) return false
  return mutateDevServiceState(target, 'merge', {}, undefined, ownerRoot) != null
}

export const writeDevServiceState = (target: DevStartTarget, state: DevStartState, ownerRoot = repoRoot) => (
  mutateDevServiceState(target, 'replace', state, undefined, ownerRoot) as DevStartState
)

export const updateDevServiceState = (target: DevStartTarget, patch: Partial<DevStartState>, ownerRoot = repoRoot) => (
  mutateDevServiceState(target, 'merge', patch, undefined, ownerRoot) as DevStartState
)

export const updateDevServiceStateIfCurrent = (
  target: DevStartTarget,
  expected: StateGenerationExpectation,
  patch: Partial<DevStartState>,
  ownerRoot = repoRoot
) => {
  return mutateDevServiceState(target, 'merge', patch, expected, ownerRoot)
}

export const replaceDevServiceStateIfCurrent = (
  target: DevStartTarget,
  expected: StateGenerationExpectation,
  next: DevStartState,
  ownerRoot = repoRoot
) => {
  return mutateDevServiceState(target, 'replace', next, expected, ownerRoot)
}

export const operationEnv = (operation: DevServiceOperation | undefined) => (
  operation == null ? {} : { [operationEnvName]: JSON.stringify(operation) }
)

export const readOperationFromEnv = () => {
  const value = normalizeText(process.env[operationEnvName])
  if (value == null) return undefined
  try {
    const operation = JSON.parse(value) as Partial<DevServiceOperation>
    if (
      (operation.action !== 'ensure' && operation.action !== 'restart' && operation.action !== 'stop') ||
      typeof operation.actor !== 'string' ||
      typeof operation.id !== 'string' ||
      typeof operation.startedAt !== 'string'
    ) return undefined
    return operation as DevServiceOperation
  } catch {
    return undefined
  }
}
