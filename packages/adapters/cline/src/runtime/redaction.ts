import { Buffer } from 'node:buffer'

import { isClineSensitiveEnvKey, omitClineSensitiveEnv } from './credentials'

const REDACTED = '[REDACTED]'

const CREDENTIAL_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'AZURE_STORAGE_ACCOUNT_KEY',
  'CLINE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY'
])

const TOKEN_PATTERNS = [
  /\b(?:sk|rk|pk)-[\w-]{8,}\b/gu,
  /\bgh[pousr]_\w{20,}\b/gu,
  /\bAKIA[A-Z0-9]{16}\b/gu,
  /\b(?:Bearer|Basic)\s+[\w.~+/=-]{8,}\b/giu,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/gu
]

export const isClineCredentialEnvKey = (key: string) => (
  CREDENTIAL_KEYS.has(key.toUpperCase()) || isClineSensitiveEnvKey(key)
)

export const omitClineCredentialEnv = (
  env: Record<string, string | null | undefined>
): Record<string, string | null | undefined> => omitClineSensitiveEnv(env)

const collectEncodedForms = (value: string) => {
  const forms = new Set([value])
  try {
    forms.add(encodeURIComponent(value))
  } catch {}
  forms.add(JSON.stringify(value).slice(1, -1))
  forms.add(Buffer.from(value).toString('base64'))
  forms.add(Buffer.from(value).toString('base64url'))
  return [...forms].filter(form => form.length >= 4).sort((left, right) => right.length - left.length)
}

const redactString = (value: string, secrets: ReadonlySet<string>) => {
  let redacted = value
  const forms = new Set<string>()
  for (const secret of secrets) {
    for (const form of collectEncodedForms(secret)) forms.add(form)
  }
  for (const form of [...forms].sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(form, REDACTED)
  }
  for (const pattern of TOKEN_PATTERNS) redacted = redacted.replace(pattern, REDACTED)
  return redacted
}

const redactUnknown = (value: unknown, secrets: ReadonlySet<string>, seen: WeakSet<object>): unknown => {
  if (typeof value === 'string') return redactString(value, secrets)
  if (Array.isArray(value)) return value.map(item => redactUnknown(item, secrets, seen))
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return REDACTED
  seen.add(value)
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isClineCredentialEnvKey(key)
        ? REDACTED
        : redactUnknown(entry, secrets, seen)
    ])
  )
}

export class ClineRedactor {
  private readonly diagnosticValues = new Set<string>()
  private readonly secretValues = new Set<string>()

  constructor(env: Record<string, string | null | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (isClineCredentialEnvKey(key) && typeof value === 'string' && value !== '') {
        this.secretValues.add(value)
      }
    }
  }

  addDiagnosticValue(value: string | undefined) {
    if (value != null && value.length >= 4) this.diagnosticValues.add(value)
  }

  redactEvent<T>(event: T): T {
    const secrets = new Set(this.secretValues)
    if (
      event != null && typeof event === 'object' &&
      'type' in event && (event.type === 'error' || event.type === 'exit')
    ) {
      for (const value of this.diagnosticValues) secrets.add(value)
    }
    return redactUnknown(event, secrets, new WeakSet()) as T
  }

  redactDiagnostic(value: string) {
    return redactString(value.slice(-65_536), new Set([...this.secretValues, ...this.diagnosticValues])).trim()
  }
}
