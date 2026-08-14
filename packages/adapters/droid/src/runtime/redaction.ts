import { Buffer } from 'node:buffer'

const REDACTED = '[REDACTED]'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const secretVariants = (secret: string) => {
  const variants = new Set<string>([
    secret,
    encodeURIComponent(secret),
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64url'),
    JSON.stringify(secret).slice(1, -1)
  ])
  return [...variants].filter(value => value !== '')
}

const credentialPatterns: Array<[RegExp, string]> = [
  [
    /(\bFACTORY_(?:API_KEY|TOKEN)\s*[:=]\s*["']?)([^\s,"'}]+)/giu,
    `$1${REDACTED}`
  ],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token)["']?\s*[:=]\s*["'])([^"']+)(["'])/giu,
    `$1${REDACTED}$3`
  ],
  [/(\bAuthorization\s*[:=]\s*["']?(?:Bearer\s+)?)([^\s,"'}]+)/giu, `$1${REDACTED}`],
  [/\bBearer\s+[\w.~+/=-]{12,}(?=$|[\s,"'}])/giu, `Bearer ${REDACTED}`],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}(?=$|[^\w-])/gu, REDACTED],
  [
    /\b(?:factory|fac|fct)[_-](?:(?:live|test)[_-]|(?:api[_-]?key|token)[_-])[\w-]{16,}(?=$|[^\w-])/giu,
    REDACTED
  ]
]

const redactUnknown = (value: unknown, redact: (text: string) => string): unknown => {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactUnknown(item, redact))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUnknown(item, redact)])
    )
  }
  return value
}

export class DroidDiagnosticRedactor {
  private readonly exactPatterns: RegExp[]

  constructor(secrets: Array<string | null | undefined>) {
    this.exactPatterns = secrets
      .filter((secret): secret is string => typeof secret === 'string' && secret !== '')
      .flatMap(secretVariants)
      .sort((left, right) => right.length - left.length)
      .map(secret => new RegExp(escapeRegExp(secret), 'gu'))
  }

  redact = (value: string) => {
    let result = value
    for (const pattern of this.exactPatterns) result = result.replace(pattern, REDACTED)
    for (const [pattern, replacement] of credentialPatterns) result = result.replace(pattern, replacement)
    return result
  }

  error = (value: unknown) => {
    const source = value instanceof Error ? value : new Error(String(value))
    const safe = new Error(this.redact(source.message))
    safe.name = source.name
    if (source.stack != null) safe.stack = this.redact(source.stack)
    return safe
  }

  value = <T>(value: T): T => redactUnknown(value, this.redact) as T
}
