/* eslint-disable max-lines -- exact-value and key-aware persistence redaction stay in one security boundary. */
import { Buffer } from 'node:buffer'

const CREDENTIAL_ENV_PATTERN = /ACCESS_KEY|API_KEY|AUTH_TOKEN|CREDENTIAL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN/iu
const PRIVATE_ROOT_ENV_NAMES = new Set([
  'GOOSE_PATH_ROOT',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME'
])
const REDACTED = '[REDACTED]'
const PRIVATE_ROOT = '[GOOSE_SESSION_ROOT]'
const SENSITIVE_CONTAINER_KEYS = new Set(['auth', 'authentication', 'authorization', 'credential', 'credentials'])
const NON_SECRET_CREDENTIAL_KEYS = new Set([
  'apikeyenv',
  'authmethod',
  'authmode',
  'authscheme',
  'authtype',
  'authorizationurl',
  'credentialportability',
  'credentialrevision',
  'credentialsource',
  'credentialtype',
  'credentialupdatedat',
  'inputtokens',
  'maxoutputtokens',
  'maxtokens',
  'outputtokens',
  'passwordenv',
  'requiresauth',
  'secretenv',
  'tokenbudget',
  'tokencount',
  'tokenendpoint',
  'tokenendpointurl',
  'tokenenv',
  'tokenizer',
  'tokenlimit',
  'tokensource',
  'tokentype',
  'totaltokens'
])
const SENSITIVE_CONTAINER_METADATA_KEYS = new Set([
  ...NON_SECRET_CREDENTIAL_KEYS,
  'id',
  'method',
  'mode',
  'name',
  'prefix',
  'provider',
  'scheme',
  'source',
  'type'
])

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const encodedVariants = (value: string) => {
  const variants = new Set([value])
  try {
    variants.add(encodeURIComponent(value))
  } catch {
    // The exact value remains covered.
  }
  const base64 = Buffer.from(value).toString('base64')
  variants.add(base64)
  variants.add(base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''))
  return [...variants].filter(candidate => candidate.length >= 4)
}

const replaceVariants = (input: string, values: string[], replacement: string) => (
  values
    .sort((left, right) => right.length - left.length)
    .reduce((value, candidate) => value.replace(new RegExp(escapeRegExp(candidate), 'gu'), replacement), input)
)

export interface GooseRedactor {
  redactArtifactValue: <T>(value: T) => T
  redactString: (value: string) => string
  redactValue: <T>(value: T) => T
}

export interface GooseStartupError extends Error {
  code?: number | string
  context: string
}

const gooseStartupErrors = new WeakSet<Error>()

export const createGooseStartupError = (params: {
  context: string
  error: unknown
  redactString: (value: string) => string
}): GooseStartupError => {
  if (params.error instanceof Error && gooseStartupErrors.has(params.error)) {
    return params.error as GooseStartupError
  }
  const source = params.error != null && typeof params.error === 'object'
    ? params.error as { code?: unknown; message?: unknown }
    : undefined
  const rawMessage = params.error instanceof Error
    ? params.error.message
    : typeof source?.message === 'string'
    ? source.message
    : String(params.error)
  const rawCode = source?.code
  const code = typeof rawCode === 'number'
    ? rawCode
    : typeof rawCode === 'string'
    ? params.redactString(rawCode)
    : undefined
  const codeLabel = code == null ? '' : ` [${code}]`
  const result = new Error(
    `Goose ACP ${params.context} failed${codeLabel}: ${params.redactString(rawMessage)}`
  ) as GooseStartupError
  result.name = 'GooseAcpStartupError'
  result.context = params.context
  if (code != null) result.code = code
  gooseStartupErrors.add(result)
  return result
}

const normalizeKey = (value: string) => value.replaceAll(/[^a-z0-9]/giu, '').toLowerCase()

const isSensitiveKey = (key: string) => {
  const normalized = normalizeKey(key)
  if (NON_SECRET_CREDENTIAL_KEYS.has(normalized)) return false
  if (SENSITIVE_CONTAINER_KEYS.has(normalized)) return true
  return normalized.startsWith('auth') || normalized.endsWith('auth') ||
    /(?:api|access|refresh|session|bearer|client|private|service|account|auth)?token$/u.test(normalized) ||
    /(?:api|access|private|secret|client|service|account|auth)key(?:id|value)?$/u.test(normalized) ||
    /password|passwd|secret|authorization|credential/u.test(normalized)
}

const isSensitiveContainerKey = (key: string) => SENSITIVE_CONTAINER_KEYS.has(normalizeKey(key))

const collectStringLeaves = (value: unknown, values: Set<string>, seen: WeakSet<object>) => {
  if (typeof value === 'string') {
    if (value.length >= 4) values.add(value)
    return
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof Map) {
    for (const entry of value.values()) collectStringLeaves(entry, values, seen)
    return
  }
  if (value instanceof Set || Array.isArray(value)) {
    for (const entry of value) collectStringLeaves(entry, values, seen)
    return
  }
  for (const entry of Object.values(value)) collectStringLeaves(entry, values, seen)
}

const collectArtifactSecrets = (
  value: unknown,
  values: Set<string>,
  seen: WeakSet<object>,
  sensitiveContainer = false
) => {
  if (value == null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof Map) {
    for (const [key, entry] of value.entries()) {
      if (typeof key === 'string' && isSensitiveKey(key)) {
        if (isSensitiveContainerKey(key) && entry != null && typeof entry === 'object') {
          collectArtifactSecrets(entry, values, seen, true)
        } else {
          collectStringLeaves(entry, values, new WeakSet())
        }
      } else if (
        sensitiveContainer &&
        (typeof key !== 'string' || !SENSITIVE_CONTAINER_METADATA_KEYS.has(normalizeKey(key)))
      ) {
        collectStringLeaves(entry, values, new WeakSet())
      } else {
        collectArtifactSecrets(entry, values, seen, sensitiveContainer)
      }
    }
    return
  }
  if (value instanceof Set || Array.isArray(value)) {
    for (const entry of value) collectArtifactSecrets(entry, values, seen, sensitiveContainer)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      if (isSensitiveContainerKey(key) && entry != null && typeof entry === 'object') {
        collectArtifactSecrets(entry, values, seen, true)
      } else {
        collectStringLeaves(entry, values, new WeakSet())
      }
    } else if (sensitiveContainer && !SENSITIVE_CONTAINER_METADATA_KEYS.has(normalizeKey(key))) {
      collectStringLeaves(entry, values, new WeakSet())
    } else {
      collectArtifactSecrets(entry, values, seen, sensitiveContainer)
    }
  }
}

export const createGooseRedactor = (
  env: NodeJS.ProcessEnv,
  artifactCredentialSources: readonly unknown[] = []
): GooseRedactor => {
  const configuredArtifactSecrets = new Set<string>()
  for (const source of artifactCredentialSources) {
    collectArtifactSecrets(source, configuredArtifactSecrets, new WeakSet())
  }
  const secretValues = Object.entries(env)
    .filter(([name, value]) => CREDENTIAL_ENV_PATTERN.test(name) && typeof value === 'string' && value.length >= 4)
    .flatMap(([, value]) => encodedVariants(value!))
    .concat([...configuredArtifactSecrets].flatMap(encodedVariants))
  const privateRoots = Object.entries(env)
    .filter(([name, value]) => PRIVATE_ROOT_ENV_NAMES.has(name) && typeof value === 'string' && value.length >= 4)
    .flatMap(([, value]) => encodedVariants(value!))

  const redactString = (input: string) => {
    let value = replaceVariants(input, secretValues, REDACTED)
    value = replaceVariants(value, privateRoots, PRIVATE_ROOT)
    value = value
      .replace(/\b(?:sk|pk)-[\w-]{8,}\b/gu, REDACTED)
      .replace(/\bgh[pousr]_\w{8,}\b/gu, REDACTED)
      .replace(/\bAIza[\w-]{12,}\b/gu, REDACTED)
      .replace(/\bBearer\s+[\w.~+/-]{8,}=*/giu, `Bearer ${REDACTED}`)
      .replace(
        /\b(api[_-]?key|auth[_-]?token|access[_-]?token|password|private[_-]?key|secret|token)(\s*[:=]\s*)([^\s,;"']+)/giu,
        `$1$2${REDACTED}`
      )
    return value
  }

  const redactValue = <T>(input: T): T => {
    if (typeof input === 'string') return redactString(input) as T
    if (Array.isArray(input)) return input.map(item => redactValue(item)) as T
    if (input == null || typeof input !== 'object') return input
    if (input instanceof Error) return new Error(redactString(input.message)) as T
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, redactValue(value)])
    ) as T
  }

  const redactArtifactValue = <T>(input: T): T => {
    const artifactSecrets = new Set(configuredArtifactSecrets)
    collectArtifactSecrets(input, artifactSecrets, new WeakSet())
    const artifactSecretVariants = [...artifactSecrets].flatMap(encodedVariants)
    const redactArtifactString = (value: string) =>
      replaceVariants(
        redactString(value),
        artifactSecretVariants,
        REDACTED
      )
    const seen = new WeakMap<object, unknown>()
    const visit = (value: unknown, sensitiveContainer = false): unknown => {
      if (typeof value === 'string') return redactArtifactString(value)
      if (value == null || typeof value !== 'object') return value
      const previous = seen.get(value)
      if (previous != null) return previous
      if (value instanceof Date) return new Date(value)
      if (value instanceof Map) {
        const result = new Map<unknown, unknown>()
        seen.set(value, result)
        for (const [key, entry] of value.entries()) {
          const sensitive = typeof key === 'string' && isSensitiveKey(key)
          const safeInContainer = typeof key === 'string' && SENSITIVE_CONTAINER_METADATA_KEYS.has(normalizeKey(key))
          result.set(
            key,
            sensitive && !(isSensitiveContainerKey(key) && entry != null && typeof entry === 'object')
              ? REDACTED
              : sensitiveContainer && !safeInContainer
              ? entry != null && typeof entry === 'object' ? visit(entry, true) : REDACTED
              : visit(entry, sensitive || sensitiveContainer)
          )
        }
        return result
      }
      if (value instanceof Set) {
        const result = new Set<unknown>()
        seen.set(value, result)
        for (const entry of value) result.add(visit(entry, sensitiveContainer))
        return result
      }
      if (Array.isArray(value)) {
        const result: unknown[] = []
        seen.set(value, result)
        for (const entry of value) result.push(visit(entry, sensitiveContainer))
        return result
      }
      if (value instanceof Error) {
        const result = new Error(redactArtifactString(value.message))
        seen.set(value, result)
        result.name = value.name
        if (value.cause != null) result.cause = visit(value.cause)
        if (value.stack != null) result.stack = redactArtifactString(value.stack)
        for (const [key, entry] of Object.entries(value)) {
          Object.assign(result, { [key]: isSensitiveKey(key) ? REDACTED : visit(entry) })
        }
        return result
      }
      const result: Record<string, unknown> = {}
      seen.set(value, result)
      for (const [key, entry] of Object.entries(value)) {
        const sensitive = isSensitiveKey(key)
        const safeInContainer = SENSITIVE_CONTAINER_METADATA_KEYS.has(normalizeKey(key))
        result[key] = sensitive && !(isSensitiveContainerKey(key) && entry != null && typeof entry === 'object')
          ? REDACTED
          : sensitiveContainer && !safeInContainer
          ? entry != null && typeof entry === 'object' ? visit(entry, true) : REDACTED
          : visit(entry, sensitive || sensitiveContainer)
      }
      return result
    }
    return visit(input) as T
  }

  return { redactArtifactValue, redactString, redactValue }
}
