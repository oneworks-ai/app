import process from 'node:process'

import type { StartupProfiler } from '@oneworks/utils'

import type { HookInputs } from './type'

const toFinitePositiveNumber = (value: string | undefined) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined
}

export const markSyntheticDuration = (
  profiler: StartupProfiler,
  name: string,
  durationMs: number,
  details?: Record<string, unknown>
) => {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return
  }

  profiler.mark(name, profiler.now() - durationMs, details)
}

const markEpochRange = (
  profiler: StartupProfiler,
  name: string,
  startedAtEpochMs: number | undefined,
  endedAtEpochMs: number | undefined
) => {
  if (startedAtEpochMs == null || endedAtEpochMs == null) {
    return
  }

  markSyntheticDuration(profiler, name, endedAtEpochMs - startedAtEpochMs)
}

const markBootstrapDuration = (
  profiler: StartupProfiler,
  eventName: keyof HookInputs,
  name: string,
  envName: string
) => {
  const durationMs = toFinitePositiveNumber(process.env[envName])
  if (durationMs == null) {
    return
  }

  markSyntheticDuration(profiler, `hook.${eventName}.childBootstrap.${name}`, durationMs)
}

export const markHookRuntimeBootstrapProfile = (
  profiler: StartupProfiler,
  input: {
    eventName: keyof HookInputs
    inputBytes: number
    parseInputDurationMs: number
    readInputDurationMs: number
    readInputFinishedAtEpochMs: number
  }
) => {
  markSyntheticDuration(profiler, `hook.${input.eventName}.runtime.readInput`, input.readInputDurationMs, {
    bytes: input.inputBytes
  })
  markSyntheticDuration(profiler, `hook.${input.eventName}.runtime.parseInput`, input.parseInputDurationMs)

  const parentBeforeSpawnEpochMs = toFinitePositiveNumber(process.env.__ONEWORKS_HOOK_PARENT_BEFORE_SPAWN_EPOCH_MS__)
  const childScriptEntryEpochMs = toFinitePositiveNumber(process.env.__ONEWORKS_HOOK_CHILD_SCRIPT_ENTRY_EPOCH_MS__)
  const childBeforeManagedEntryEpochMs = toFinitePositiveNumber(
    process.env.__ONEWORKS_HOOK_CHILD_BEFORE_MANAGED_ENTRY_EPOCH_MS__
  )

  markEpochRange(
    profiler,
    `hook.${input.eventName}.runtime.parentBeforeSpawnToScriptEntry`,
    parentBeforeSpawnEpochMs,
    childScriptEntryEpochMs
  )
  markEpochRange(
    profiler,
    `hook.${input.eventName}.runtime.scriptEntryToManagedEntry`,
    childScriptEntryEpochMs,
    childBeforeManagedEntryEpochMs
  )
  markEpochRange(
    profiler,
    `hook.${input.eventName}.runtime.managedEntryToInputRead`,
    childBeforeManagedEntryEpochMs,
    input.readInputFinishedAtEpochMs
  )
  markEpochRange(
    profiler,
    `hook.${input.eventName}.runtime.parentBeforeSpawnToInputRead`,
    parentBeforeSpawnEpochMs,
    input.readInputFinishedAtEpochMs
  )

  markBootstrapDuration(profiler, input.eventName, 'nodePath', '__ONEWORKS_HOOK_BOOTSTRAP_NODE_PATH_MS__')
  markBootstrapDuration(
    profiler,
    input.eventName,
    'requireProjectEnv',
    '__ONEWORKS_HOOK_BOOTSTRAP_REQUIRE_PROJECT_ENV_MS__'
  )
  markBootstrapDuration(
    profiler,
    input.eventName,
    'resolveWorkspace',
    '__ONEWORKS_HOOK_BOOTSTRAP_RESOLVE_WORKSPACE_MS__'
  )
  markBootstrapDuration(
    profiler,
    input.eventName,
    'resolveMockHome',
    '__ONEWORKS_HOOK_BOOTSTRAP_RESOLVE_MOCK_HOME_MS__'
  )
  markBootstrapDuration(profiler, input.eventName, 'bridgeMockHome', '__ONEWORKS_HOOK_BOOTSTRAP_BRIDGE_MOCK_HOME_MS__')
  markBootstrapDuration(
    profiler,
    input.eventName,
    'resolveEntrypoint',
    '__ONEWORKS_HOOK_BOOTSTRAP_RESOLVE_ENTRYPOINT_MS__'
  )
  markBootstrapDuration(
    profiler,
    input.eventName,
    'requireEntrypoint',
    '__ONEWORKS_HOOK_BOOTSTRAP_REQUIRE_ENTRYPOINT_MS__'
  )
}
