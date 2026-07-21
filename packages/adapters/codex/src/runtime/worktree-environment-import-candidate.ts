import { Buffer } from 'node:buffer'
import { basename } from 'node:path'

import type { AdapterWorktreeEnvironmentImportCandidate, WorktreeEnvironmentScriptKey } from '@oneworks/types'

const MAX_SCRIPT_BYTES = 512 * 1024
const ENVIRONMENT_ID_PATTERN = /^\w[\w.-]{0,127}$/

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const normalizeEnvironmentId = (value: string, fallback: string) => {
  const normalize = (input: string) =>
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9_]+/, '')
      .replace(/[-.]+$/g, '')
      .slice(0, 128)

  const avoidReservedLocalSuffix = (input: string) => (
    input.endsWith('.local') ? `${input.slice(0, -'.local'.length)}-local` : input
  )

  const preferred = avoidReservedLocalSuffix(normalize(value))
  if (ENVIRONMENT_ID_PATTERN.test(preferred)) return preferred
  const fallbackId = avoidReservedLocalSuffix(normalize(fallback))
  return ENVIRONMENT_ID_PATTERN.test(fallbackId) ? fallbackId : 'codex-environment'
}

type ScriptReadResult =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'valid'; script: string }

const readScript = (value: unknown): ScriptReadResult => {
  if (value == null) return { kind: 'absent' }
  if (!isRecord(value)) return { kind: 'invalid' }
  if (!Object.prototype.hasOwnProperty.call(value, 'script')) return { kind: 'absent' }
  if (typeof value.script !== 'string') return { kind: 'invalid' }
  if (value.script.trim() === '') return { kind: 'absent' }
  const script = value.script
  if (script.includes('\0') || Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES) {
    return { kind: 'invalid' }
  }
  return { kind: 'valid', script }
}

const addLifecycleScripts = (
  scripts: Partial<Record<WorktreeEnvironmentScriptKey, string>>,
  value: unknown,
  operation: 'create' | 'destroy'
) => {
  if (value == null) return true
  if (!isRecord(value)) return false
  const mappings = [
    [value, operation],
    [value.darwin, `${operation}.macos`],
    [value.linux, `${operation}.linux`],
    [value.win32, `${operation}.windows`]
  ] as const

  for (const [section, key] of mappings) {
    const result = readScript(section)
    if (result.kind === 'invalid') return false
    if (result.kind === 'valid') scripts[key] = result.script
  }
  return true
}

export interface CodexWorktreeEnvironmentCandidateBuildResult {
  candidate?: AdapterWorktreeEnvironmentImportCandidate
  skippedActionCount: number
}

export const buildCodexWorktreeEnvironmentCandidate = (
  fileName: string,
  parsed: unknown
): CodexWorktreeEnvironmentCandidateBuildResult | undefined => {
  if (!isRecord(parsed) || (parsed.version != null && parsed.version !== 1)) return undefined
  if (parsed.actions != null && !Array.isArray(parsed.actions)) return undefined
  const name = readNonEmptyString(parsed.name) ?? basename(fileName, '.toml')
  const scripts: Partial<Record<WorktreeEnvironmentScriptKey, string>> = {}
  const skippedActionCount = Array.isArray(parsed.actions) ? parsed.actions.length : 0
  if (
    !addLifecycleScripts(scripts, parsed.setup, 'create') ||
    !addLifecycleScripts(scripts, parsed.cleanup, 'destroy') ||
    Object.keys(scripts).length === 0
  ) {
    return { skippedActionCount }
  }

  return {
    candidate: {
      displayName: name.trim(),
      scripts,
      sourceId: fileName,
      suggestedId: normalizeEnvironmentId(name, basename(fileName, '.toml')),
      warnings: ['shell_compatibility_unverified']
    },
    skippedActionCount
  }
}

export const resolveUniqueSuggestedIds = (candidates: AdapterWorktreeEnvironmentImportCandidate[]) => {
  const usedIds = new Set<string>()
  return candidates.map((candidate) => {
    if (!usedIds.has(candidate.suggestedId)) {
      usedIds.add(candidate.suggestedId)
      return candidate
    }
    for (let index = 2; index < 1000; index += 1) {
      const suffix = `-${index}`
      const nextId = `${candidate.suggestedId.slice(0, 128 - suffix.length)}${suffix}`
      if (usedIds.has(nextId)) continue
      usedIds.add(nextId)
      return { ...candidate, suggestedId: nextId }
    }
    return candidate
  })
}
