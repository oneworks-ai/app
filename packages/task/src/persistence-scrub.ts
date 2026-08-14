import { Buffer } from 'node:buffer'

import type { AdapterCtx, Config } from '@oneworks/types'
import {
  CODEX_SHARED_MODEL_SERVICE_KEY,
  CODEX_SHARED_MODEL_TOKEN_ENV,
  REDACTED_CREDENTIAL_VALUE,
  collectCredentialRedactionContext,
  createCredentialVariants,
  isCredentialBearingKey,
  isCredentialGraphSensitiveEntry,
  redactContextualCredentialAssignmentsInString,
  redactCredentialAssignmentsInString,
  redactCredentialVariantsInString,
  resolveCredentialGraphChildContext
} from '@oneworks/utils'
import type { CredentialGraphContext, CredentialTextAssignment } from '@oneworks/utils'

type PersistedTaskBase = Omit<AdapterCtx, 'logger' | 'cache'>

export const isPersistenceCredentialKey = isCredentialBearingKey

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const shouldPreserveCredentialContainer = (value: unknown) => isPlainRecord(value)

const redactString = (
  value: string,
  variants: readonly string[],
  textAssignments: readonly CredentialTextAssignment[]
) => (
  redactContextualCredentialAssignmentsInString(
    redactCredentialAssignmentsInString(redactCredentialVariantsInString(value, variants)),
    textAssignments
  )
)

type GraphClones = Record<CredentialGraphContext, WeakMap<object, unknown>>

const createGraphClones = (): GraphClones => ({
  credential: new WeakMap<object, unknown>(),
  headers: new WeakMap<object, unknown>(),
  normal: new WeakMap<object, unknown>()
})

const scrubGraph = (
  value: unknown,
  variants: readonly string[],
  textAssignments: readonly CredentialTextAssignment[],
  clones = createGraphClones(),
  context: CredentialGraphContext = 'normal'
): unknown => {
  if (typeof value === 'string') return redactString(value, variants, textAssignments)
  if (value == null || typeof value !== 'object') return value
  const contextClones = clones[context]
  const existing = contextClones.get(value)
  if (existing != null) return existing
  if (value instanceof Date) return new Date(value.getTime())
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8')
    const redacted = redactString(text, variants, textAssignments)
    return redacted === text ? Buffer.from(value) : Buffer.from(redacted)
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = []
    contextClones.set(value, clone)
    clone.push(...value.map(item => scrubGraph(item, variants, textAssignments, clones, context)))
    return clone
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>()
    contextClones.set(value, clone)
    for (const item of value) clone.add(scrubGraph(item, variants, textAssignments, clones, context))
    return clone
  }
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>()
    contextClones.set(value, clone)
    for (const [key, child] of value) {
      if (typeof key === 'string' && context === 'headers') {
        clone.set(scrubGraph(key, variants, textAssignments, clones), REDACTED_CREDENTIAL_VALUE)
        continue
      }
      const sensitiveKey = typeof key === 'string' && isCredentialGraphSensitiveEntry(key, context)
      if (sensitiveKey && !shouldPreserveCredentialContainer(child)) continue
      clone.set(
        scrubGraph(key, variants, textAssignments, clones),
        scrubGraph(
          child,
          variants,
          textAssignments,
          clones,
          typeof key === 'string' ? resolveCredentialGraphChildContext(key, context) : context
        )
      )
    }
    return clone
  }
  if (value instanceof Error) {
    const clone: Record<string, unknown> = {
      message: redactString(value.message, variants, textAssignments),
      name: value.name,
      ...(value.stack == null ? {} : { stack: redactString(value.stack, variants, textAssignments) })
    }
    contextClones.set(value, clone)
    for (const [key, child] of Object.entries(value)) {
      if (context === 'headers') {
        clone[key] = REDACTED_CREDENTIAL_VALUE
        continue
      }
      const sensitiveKey = isCredentialGraphSensitiveEntry(key, context)
      if (sensitiveKey && !shouldPreserveCredentialContainer(child)) continue
      clone[key] = scrubGraph(
        child,
        variants,
        textAssignments,
        clones,
        resolveCredentialGraphChildContext(key, context)
      )
    }
    return clone
  }

  const clone: Record<string, unknown> = {}
  contextClones.set(value, clone)
  for (const [key, child] of Object.entries(value)) {
    if (context === 'headers') {
      clone[key] = REDACTED_CREDENTIAL_VALUE
      continue
    }
    const sensitiveKey = isCredentialGraphSensitiveEntry(key, context)
    if (sensitiveKey && !shouldPreserveCredentialContainer(child)) continue
    clone[key] = scrubGraph(
      child,
      variants,
      textAssignments,
      clones,
      resolveCredentialGraphChildContext(key, context)
    )
  }
  return clone
}

const stripCodexSharedServiceUrl = (config: Config | undefined) => {
  const service = config?.modelServices?.[CODEX_SHARED_MODEL_SERVICE_KEY]
  if (service != null) service.apiBaseUrl = undefined
}

const stripRuntimeOnlyCodexCapability = (base: PersistedTaskBase) => {
  for (
    const config of [
      ...base.configs,
      base.configState?.effectiveProjectConfig,
      base.configState?.projectConfig,
      base.configState?.userConfig,
      base.configState?.mergedConfig,
      ...base.assets?.configs ?? []
    ]
  ) stripCodexSharedServiceUrl(config)
  delete base.env[CODEX_SHARED_MODEL_TOKEN_ENV]
}

export const scrubTaskBaseForPersistence = (
  base: PersistedTaskBase,
  credentialSource: PersistedTaskBase = base
): PersistedTaskBase => {
  const persisted = scrubCredentialGraphForPersistence(base, credentialSource)
  stripRuntimeOnlyCodexCapability(persisted)
  return persisted
}

export const scrubCredentialGraphForPersistence = <Value>(value: Value, credentialSource: unknown = value): Value => {
  const context = collectCredentialRedactionContext(credentialSource)
  return scrubGraph(
    value,
    createCredentialVariants(context.values),
    context.textAssignments
  ) as Value
}
