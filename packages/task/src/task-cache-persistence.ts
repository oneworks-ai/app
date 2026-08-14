import { Buffer } from 'node:buffer'

import type { AdapterCtx, Config } from '@oneworks/types'
import { CODEX_SHARED_MODEL_SERVICE_KEY, CODEX_SHARED_MODEL_TOKEN_ENV } from '@oneworks/utils'

import {
  addSecretVariants,
  collectConfigContentSecrets,
  createKnownSecretRedactor,
  isCredentialKey,
  uniqueSanitizedKey
} from './task-cache-secret-redaction'

const FACTORY_AUTH_ENV_KEYS = new Set(['factoryapikey', 'factorytoken'])
const normalizeSecretKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')

const collectDroidConfigContentSecrets = (
  value: unknown,
  secrets: Set<string>,
  rawSecrets: Set<string>,
  seen = new WeakSet<object>()
) => {
  if (value == null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectDroidConfigContentSecrets(item, secrets, rawSecrets, seen)
    return
  }
  const record = value as Record<string, unknown>
  const adapters = record.adapters
  if (adapters != null && typeof adapters === 'object' && !Array.isArray(adapters)) {
    for (const [adapterKey, adapterValue] of Object.entries(adapters)) {
      if (adapterValue == null || typeof adapterValue !== 'object' || Array.isArray(adapterValue)) continue
      const adapter = adapterValue as Record<string, unknown>
      if (adapterKey !== 'droid' && adapter.packageId !== '@oneworks/adapter-droid') continue
      collectConfigContentSecrets({ configContent: adapter.configContent }, secrets, rawSecrets)
    }
  }
  for (const item of Object.values(record)) {
    collectDroidConfigContentSecrets(item, secrets, rawSecrets, seen)
  }
}

const sanitizePersistedGraph = (
  value: unknown,
  redactor: ReturnType<typeof createKnownSecretRedactor>,
  insideConfigContent = false,
  seenOutside = new WeakMap<object, unknown>(),
  seenInside = new WeakMap<object, unknown>()
): unknown => {
  if (typeof value === 'string') return redactor.redactText(value)
  if (value == null || typeof value !== 'object') return value
  const seen = insideConfigContent ? seenInside : seenOutside
  const cached = seen.get(value)
  if (cached !== undefined) return cached
  if (value instanceof Date) return new Date(value.getTime())
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8')
    const redacted = redactor.redactText(text)
    return redacted === text ? Buffer.from(value) : Buffer.from(redacted)
  }
  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    seen.set(value, sanitized)
    for (const item of value) {
      sanitized.push(sanitizePersistedGraph(
        item,
        redactor,
        insideConfigContent,
        seenOutside,
        seenInside
      ))
    }
    return sanitized
  }
  if (value instanceof Set) {
    const sanitized = new Set<unknown>()
    seen.set(value, sanitized)
    for (const item of value) {
      sanitized.add(sanitizePersistedGraph(item, redactor, insideConfigContent, seenOutside, seenInside))
    }
    return sanitized
  }
  if (value instanceof Map) {
    const sanitized = new Map<unknown, unknown>()
    seen.set(value, sanitized)
    for (const [key, item] of value) {
      if (insideConfigContent && typeof key === 'string' && isCredentialKey(key)) continue
      const sanitizedKey = typeof key === 'string' ? redactor.redactKey(key) : key
      sanitized.set(
        sanitizedKey,
        sanitizePersistedGraph(item, redactor, insideConfigContent, seenOutside, seenInside)
      )
    }
    return sanitized
  }
  if (value instanceof Error) {
    const sanitized: Record<string, unknown> = {
      message: redactor.redactText(value.message),
      name: value.name,
      ...(value.stack == null ? {} : { stack: redactor.redactText(value.stack) })
    }
    seen.set(value, sanitized)
    for (const [key, item] of Object.entries(value)) {
      if (insideConfigContent && isCredentialKey(key)) continue
      sanitized[redactor.redactKey(key)] = sanitizePersistedGraph(
        item,
        redactor,
        insideConfigContent,
        seenOutside,
        seenInside
      )
    }
    return sanitized
  }

  const sanitized: Record<string, unknown> = {}
  seen.set(value, sanitized)
  const usedKeys = new Set<string>()
  const unchangedKeys = new Set(
    Object.keys(value).filter(key => redactor.redactKey(key) === key)
  )
  for (const [key, item] of Object.entries(value)) {
    const nextInsideConfigContent = insideConfigContent || key === 'configContent'
    if (nextInsideConfigContent && isCredentialKey(key)) continue
    const redactedKey = redactor.redactKey(key)
    const nextKey = redactedKey === key
      ? key
      : uniqueSanitizedKey(redactedKey, new Set([...unchangedKeys, ...usedKeys]))
    usedKeys.add(nextKey)
    sanitized[nextKey] = sanitizePersistedGraph(
      item,
      redactor,
      nextInsideConfigContent,
      seenOutside,
      seenInside
    )
  }
  return sanitized
}

const sanitizeConfig = (config: Config | undefined) => {
  if (config == null) return config
  const service = config.modelServices?.[CODEX_SHARED_MODEL_SERVICE_KEY]
  if (service == null) return config
  return {
    ...config,
    modelServices: {
      ...config.modelServices,
      [CODEX_SHARED_MODEL_SERVICE_KEY]: {
        ...service,
        apiKey: undefined,
        apiBaseUrl: undefined
      }
    }
  }
}

export const sanitizeTaskBaseForPersistence = (
  base: Omit<AdapterCtx, 'logger' | 'cache'>,
  credentialSource: Omit<AdapterCtx, 'logger' | 'cache'> = base
) => {
  const secretSet = new Set<string>()
  const rawSecretSet = new Set<string>()
  for (const [key, value] of Object.entries(credentialSource.env)) {
    if (!FACTORY_AUTH_ENV_KEYS.has(normalizeSecretKey(key)) || typeof value !== 'string') continue
    addSecretVariants(secretSet, value, rawSecretSet)
  }
  // Credential fields must be collected before they are removed. Scan the whole
  // persistence graph so configState, source/extend copies, and adapter aliases
  // receive the same treatment as the two top-level configs.
  collectDroidConfigContentSecrets(credentialSource, secretSet, rawSecretSet)

  const env = { ...base.env }
  for (const key of Object.keys(env)) {
    if (FACTORY_AUTH_ENV_KEYS.has(normalizeSecretKey(key))) delete env[key]
  }
  delete env[CODEX_SHARED_MODEL_TOKEN_ENV]

  const sanitized = {
    ...base,
    env,
    configs: [sanitizeConfig(base.configs[0]), sanitizeConfig(base.configs[1])] as AdapterCtx['configs'],
    ...(base.configState == null
      ? {}
      : {
        configState: {
          ...base.configState,
          effectiveProjectConfig: sanitizeConfig(base.configState.effectiveProjectConfig),
          projectConfig: sanitizeConfig(base.configState.projectConfig),
          userConfig: sanitizeConfig(base.configState.userConfig),
          mergedConfig: sanitizeConfig(base.configState.mergedConfig)!
        }
      })
  }
  return sanitizePersistedGraph(
    sanitized,
    createKnownSecretRedactor(secretSet, rawSecretSet)
  ) as typeof sanitized
}
