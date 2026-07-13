/* eslint-disable max-lines -- The bridge keeps the HTTP request/ack state machine and audit invariants together. */
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const PROTOCOL_VERSION = 1
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
export const CHROME_EXTENSION_ID = 'eiikbhfmjohfcldcmgjikafpmpbfipbi'
const MAX_AUDIT_ENTRIES = 500
const COMMAND_TIMEOUT_MS = 35_000
const POLL_TIMEOUT_MS = 25_000
const CONNECTION_STALE_MS = 45_000
const PAIRING_TICKET_TTL_MS = 2 * 60_000
const CONFIRMATION_TTL_MS = 5 * 60_000

type JsonRecord = Record<string, unknown>

interface BridgeErrorShape {
  advanced_access_key?: string
  code: string
  message: string
  recoverable: boolean
  audit_id?: string
  confirmation_id?: string
  missing_permissions?: string[]
  user_action?: string
}

interface BridgeCommand {
  args: JsonRecord
  command_id: string
  created_at: string
  op: string
  risk_tier: number
  target_key: string
}

interface CommandWaiter {
  sensitiveResultMode: 'cookie' | 'raw' | 'snapshot' | undefined
  op: string
  reject: (error: Error & { details?: BridgeErrorShape }) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface PollWaiter {
  resolve: (command: BridgeCommand | null) => void
  timer: ReturnType<typeof setTimeout>
}

interface PairingState {
  clientTokenHash: string
  extensionId: string
  trustedOrigin: string
}

interface ActiveConnection {
  browserSessionId: string
  capabilities: unknown
  chromeVersion?: string
  connectionId: string
  extensionId: string
  extensionSessionId?: string
  extensionVersion?: string
  lastSeenAt: number
  oneWorksTabId?: number
  permissions: unknown
  sessionToken: string
  trustedOrigin: string
}

interface Confirmation {
  audit_summary: string
  browser_session_id: string
  confirmation_id: string
  created_at: string
  digest: string
  expires_at: string
  op: string
  connection_id: string
  risk_tier: number
  status: 'pending' | 'approved' | 'denied'
  summary: string
  target_key: string
}

interface ArtifactUpload {
  chunks: string[]
  createdAt: number
  receivedBytes: number
  size: number
}

interface AuditEntry {
  audit_id: string
  at: string
  code?: string
  connection_id?: string
  op: string
  outcome: 'approved' | 'denied' | 'failed' | 'requested' | 'succeeded'
  risk_tier: number
  summary: string
  target_key: string
}

interface ChromeBridgeOptions {
  logger: {
    error: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
  }
  projectHome: string
  runtimeRole?: 'manager' | 'workspace'
  workspaceFolder: string
}

interface CredentialFile {
  baseUrl?: string
  controlToken?: string
  leaseUntil?: number
  pid?: number
  protocolVersion?: number
  runtimeRole?: 'manager' | 'workspace'
  workspaceFolder?: string
}

const isRecord = (value: unknown): value is JsonRecord => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const bridgeError = (details: BridgeErrorShape) => {
  const error = Object.assign(new Error(details.message), { code: details.code, details })
  return error
}

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const commandDigest = (op: string, args: JsonRecord, targetKey: string, connection: ActiveConnection) => (
  tokenHash(
    stableJson({
      args,
      browserSessionId: connection.browserSessionId,
      connectionId: connection.connectionId,
      op,
      targetKey
    })
  )
)

const readActions = new Set([
  'check_url',
  'children',
  'devices',
  'events',
  'get',
  'get_active',
  'get_zoom',
  'list',
  'list_metadata',
  'performance',
  'preview_removal',
  'recent',
  'search',
  'snapshot',
  'status',
  'tree',
  'visits',
  'wait'
])
const destructiveHistoryActions = new Set(['clear_all', 'remove_range', 'remove_url'])
const destructiveDownloadActions = new Set(['erase_record', 'open', 'remove_file'])
const sensitiveResultModeFor = (op: string): CommandWaiter['sensitiveResultMode'] => (
  op.startsWith('raw.')
    ? 'raw'
    : op === 'cookies.list_with_values'
    ? 'cookie'
    : op === 'page.snapshot_sensitive'
    ? 'snapshot'
    : undefined
)

export const minimumRiskFor = (op: string, args: JsonRecord = {}) => {
  const [module, action] = op.split('.')
  if (module === 'audit' || module === 'capabilities') return 0
  if (module === 'raw') return 4
  if (module === 'security') return action === 'get_policy' ? 1 : 4
  if (module === 'debug') return action === 'status' ? 1 : 3
  if (module === 'cookies') return action === 'list_metadata' ? 3 : 4
  if (['contentSettings', 'browsingData', 'proxy', 'privacy'].includes(module)) {
    return ['get', 'preview_removal'].includes(action) ? 3 : 4
  }
  if (module === 'history' && destructiveHistoryActions.has(action)) return action === 'clear_all' ? 4 : 3
  if (module === 'downloads' && destructiveDownloadActions.has(action)) return 3
  if (module === 'downloads' && action === 'start' && args.conflict_action === 'overwrite') return 3
  if (module === 'bookmarks' && action === 'remove') return 3
  if (module === 'readingList' && action === 'remove') return 3
  if ((module === 'tabs' || module === 'windows') && action === 'close') return 3
  if (module === 'management' && ['set_enabled', 'uninstall'].includes(action)) return 4
  if (module === 'page') {
    if (['snapshot_sensitive', 'type_sensitive'].includes(action)) return 4
    return ['snapshot', 'wait'].includes(action) ? 1 : ['print', 'print_to_pdf', 'save_mhtml'].includes(action) ? 3 : 2
  }
  return readActions.has(action) || ['devices', 'frames'].includes(module) ? 1 : 2
}

const redactUrl = (value: unknown) => {
  if (typeof value !== 'string') return value
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.length > 160 ? `${value.slice(0, 160)}…` : value
  }
}

const redactSecretText = (value: string) =>
  value
    .replace(/\bbearer\s+[\w.~+/=-]+/giu, 'Bearer [redacted]')
    .replace(
      /("(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passcode|secret|authorization)"\s*:\s*")([^"]*)(")/giu,
      '$1[redacted]$3'
    )
    .replace(
      /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passcode|secret|authorization)\s*[:=]\s*)[^\s,;]+/giu,
      '$1[redacted]'
    )

const normalizeAuditText = (value: string) =>
  redactSecretText(value)
    .split('')
    .map(character => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || code === 127 ? ' ' : character
    })
    .join('')
    .replaceAll(/\s+/gu, ' ')
    .trim()

const safeIdentifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[\w.:/-]{1,160}$/u.test(value)) return '[invalid]'
  return normalizeAuditText(value)
}

const sanitizeBridgeResult = (value: unknown, key = ''): unknown => {
  if (Array.isArray(value)) return value.map(item => sanitizeBridgeResult(item, key))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !(key === 'pacScript' && childKey === 'data'))
        .map(([childKey, childValue]) => [childKey, sanitizeBridgeResult(childValue, childKey)])
    )
  }
  if (typeof value !== 'string' || key === 'data_base64') return value
  return redactSecretText(/(?:url|uri)$/iu.test(key) || key === 'href' ? String(redactUrl(value)) : value)
}

const sanitizeSensitiveSnapshotResult = (value: unknown) => {
  const sanitized = sanitizeBridgeResult(value)
  if (
    !isRecord(value) || !isRecord(sanitized) || !Array.isArray(value.elements) || !Array.isArray(sanitized.elements)
  ) return sanitized
  for (let index = 0; index < value.elements.length; index += 1) {
    const source = value.elements[index]
    const target = sanitized.elements[index]
    if (isRecord(source) && source.sensitive === true && typeof source.value === 'string' && isRecord(target)) {
      target.value = source.value
    }
  }
  return sanitized
}

const canonicalTargetKey = (op: string, args: JsonRecord) => {
  const [module] = op.split('.')
  if (module === 'raw') return 'browser:raw'
  if (Number.isInteger(args.tab_id)) return `tab:${String(args.tab_id)}`
  if (Array.isArray(args.tab_ids)) {
    const tabIds = [...new Set(args.tab_ids.filter(Number.isInteger).map(String))].sort()
    if (tabIds.length > 0) return `tabs:${tabIds.join(',')}`
  }
  if (Number.isInteger(args.window_id)) return `window:${String(args.window_id)}`
  if (Number.isInteger(args.group_id)) return `group:${String(args.group_id)}`
  if (Number.isInteger(args.download_id)) return `download:${String(args.download_id)}`
  if (typeof args.bookmark_id === 'string') return `bookmark:${tokenHash(args.bookmark_id).slice(0, 12)}`
  if (typeof args.url === 'string') {
    try {
      return `origin:${new URL(args.url).origin}`
    } catch {}
  }
  return /^[A-Za-z][\w-]{0,63}$/u.test(module) ? module : 'browser'
}

const summarizeField = (key: string, value: unknown) => {
  if (['tab_id', 'window_id', 'frame_id', 'port', 'max_results'].includes(key)) {
    return Number.isInteger(value)
      ? String(value)
      : '[invalid]'
  }
  if (['enabled', 'protected_web', 'extension_origins', 'incognito', 'secure', 'http_only'].includes(key)) {
    return typeof value === 'boolean' ? String(value) : '[invalid]'
  }
  if (['url', 'expected_origin', 'pac_url', 'primary_url', 'secondary_url'].includes(key)) {
    return normalizeAuditText(String(redactUrl(value)))
  }
  if (key === 'origins') {
    if (!Array.isArray(value)) return '[invalid]'
    return value.map(origin => {
      try {
        return new URL(String(origin)).origin
      } catch {
        return '[invalid]'
      }
    }).join('|')
  }
  if (key === 'domain' || key === 'host') {
    return typeof value === 'string' && /^[A-Za-z0-9.:[\]-]{1,253}$/u.test(value)
      ? value
      : '[invalid]'
  }
  if (key === 'types') return Array.isArray(value) ? value.map(safeIdentifier).join('|') : '[invalid]'
  if (key === 'document_id') return typeof value === 'string' ? `sha256:${tokenHash(value).slice(0, 12)}` : '[invalid]'
  if (key === 'extension_id') {
    return typeof value === 'string' && /^[a-z]{32}$/u.test(value)
      ? value
      : safeIdentifier(value)
  }
  if (key === 'name') return typeof value === 'string' ? `sha256:${tokenHash(value).slice(0, 12)}` : '[invalid]'
  if (key === 'path') return typeof value === 'string' ? normalizeAuditText(value).slice(0, 80) : '[invalid]'
  if (key === 'primary_pattern' || key === 'secondary_pattern') {
    return typeof value === 'string' && /^[\w*.:/[\]<>-]{1,240}$/u.test(value) ? value : '[invalid]'
  }
  if (key === 'since') return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '[invalid]'
  if (key === 'value') {
    return `type=${Array.isArray(value) ? 'array' : typeof value};sha256=${tokenHash(stableJson(value)).slice(0, 12)}`
  }
  if (key === 'text') {
    return typeof value === 'string'
      ? `characters=${value.length};sha256=${tokenHash(value).slice(0, 12)}`
      : '[invalid]'
  }
  if (key === 'bypass_list') {
    return Array.isArray(value)
      ? `items=${value.length};sha256=${tokenHash(stableJson(value)).slice(0, 12)}`
      : '[invalid]'
  }
  return safeIdentifier(value)
}

const summarizeCommand = (op: string, args: JsonRecord, targetKey: string) => {
  const fields = [
    'action',
    'tab_id',
    'window_id',
    'frame_id',
    'document_id',
    'domain',
    'url',
    'types',
    'origins',
    'since',
    'protected_web',
    'extension_origins',
    'expected_origin',
    'method',
    'key',
    'enabled',
    'setting',
    'primary_url',
    'secondary_url',
    'primary_pattern',
    'secondary_pattern',
    'value',
    'scope',
    'mode',
    'host',
    'port',
    'pac_url',
    'bypass_list',
    'extension_id',
    'name',
    'path',
    'store_id',
    'max_results',
    'text'
  ]
    .flatMap(key => key in args ? [`${key}=${summarizeField(key, args[key])}`] : [])
  return normalizeAuditText(`${op} on ${targetKey}${fields.length === 0 ? '' : ` (${fields.join(', ')})`}`).slice(
    0,
    500
  )
}

const summarizeRawReview = (op: string, args: JsonRecord, targetKey: string, digest: string) => {
  const base = summarizeCommand(op, args, targetKey)
  const rawValue = op === 'raw.evaluate' ? text(args.expression) : stableJson(args.params ?? {})
  const preview = normalizeAuditText(rawValue).slice(0, 240)
  const kind = op === 'raw.evaluate' ? 'expression' : 'params'
  return `${base}; browser-wide raw access; ${kind}_preview=${preview || '[empty]'}; args_sha256=${digest.slice(0, 16)}`
    .slice(0, 900)
}

const summarizeAuditCommand = (op: string, args: JsonRecord, targetKey: string, digest: string) => {
  if (!op.startsWith('raw.')) return summarizeCommand(op, args, targetKey)
  const paramKeys = isRecord(args.params)
    ? Object.keys(args.params).filter(key => /^[A-Za-z]\w{0,63}$/u.test(key)).sort()
    : []
  return normalizeAuditText(
    `${summarizeCommand(op, args, targetKey)}; browser-wide raw access; param_keys=${
      paramKeys.join('|') || 'none'
    }; args_sha256=${digest.slice(0, 16)}`
  ).slice(0, 500)
}

const resourceKeysFor = (args: JsonRecord, targetKey: string) => {
  const keys = new Set<string>()
  if (Number.isInteger(args.tab_id)) keys.add(`tab:${String(args.tab_id)}`)
  if (Array.isArray(args.tab_ids)) {
    for (const tabId of args.tab_ids) if (Number.isInteger(tabId)) keys.add(`tab:${String(tabId)}`)
  }
  if (Number.isInteger(args.window_id)) keys.add(`window:${String(args.window_id)}`)
  const tabMatch = /^tab:(\d+)/u.exec(targetKey)
  if (tabMatch != null) keys.add(`tab:${tabMatch[1]}`)
  const tabsMatch = /^tabs:([\d,]+)/u.exec(targetKey)
  if (tabsMatch != null) { for (const tabId of tabsMatch[1].split(',')) keys.add(`tab:${tabId}`) }
  if (keys.size === 0) keys.add(targetKey)
  return [...keys].sort()
}

const jsonResponse = (response: ServerResponse, status: number, body: unknown, origin?: string) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  if (origin === `chrome-extension://${CHROME_EXTENSION_ID}` || origin?.startsWith('http://127.0.0.1')) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('vary', 'origin')
  }
  response.end(JSON.stringify(body))
}

const readJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_REQUEST_BYTES) {
      throw bridgeError({
        code: 'REQUEST_TOO_LARGE',
        message: 'Chrome bridge request exceeded the size limit.',
        recoverable: false
      })
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!isRecord(value)) throw new Error('body must be an object')
    return value
  } catch {
    throw bridgeError({ code: 'INVALID_ARGUMENT', message: 'Expected a JSON object body.', recoverable: true })
  }
}

const bearerToken = (request: IncomingMessage) => {
  const header = request.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

const credentialPathFor = (workspaceFolder: string) => {
  const key = tokenHash(resolve(workspaceFolder)).slice(0, 24)
  return join(tmpdir(), 'oneworks-chrome-control', `${key}.protocol-1.json`)
}

const processIsAlive = (pid: unknown) => {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

const trustedOneWorksOrigin = (value: string) => {
  const origin = new URL(value).origin
  const url = new URL(origin)
  const configured = new Set(
    (process.env.ONEWORKS_CHROME_TRUSTED_ORIGINS ?? '')
      .split(',').map(item => item.trim()).filter(Boolean).map(item => new URL(item).origin)
  )
  if (configured.has(origin)) return origin
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return origin
  throw bridgeError({
    code: 'UNTRUSTED_ONEWORKS_ORIGIN',
    message: 'Chrome pairing is limited to loopback OneWorks or ONEWORKS_CHROME_TRUSTED_ORIGINS.',
    recoverable: true
  })
}

export class ChromeExtensionBridge {
  readonly controlToken = randomBytes(32).toString('base64url')
  readonly credentialPath: string
  readonly persistentStatePath: string

  #activeConnection?: ActiveConnection
  #artifactUploads = new Map<string, ArtifactUpload>()
  #completedArtifacts = new Map<string, { data: string; expiresAt: number }>()
  #ackLedger = new Map<string, { expiresAt: number }>()
  #audit: AuditEntry[] = []
  #commandQueue: BridgeCommand[] = []
  #commandWaiters = new Map<string, CommandWaiter>()
  #confirmations = new Map<string, Confirmation>()
  #credentialClaimUntil = 0
  #credentialTimer?: ReturnType<typeof setInterval>
  #grants = new Map<string, number>()
  #pairingState?: PairingState
  #pairingTickets = new Map<
    string,
    { expectedExtensionId: string; expiresAt: number; pairingNonce: string; trustedOrigin: string }
  >()
  #pollWaiters: PollWaiter[] = []
  #server?: Server
  #globalTail = Promise.resolve()
  #targetTails = new Map<string, Promise<void>>()
  #url?: string

  constructor(readonly options: ChromeBridgeOptions) {
    this.credentialPath = credentialPathFor(options.workspaceFolder)
    this.persistentStatePath = join(options.projectHome, 'chrome-driver', 'connection.json')
  }

  get url() {
    return this.#url
  }

  async start() {
    await this.#loadPairingState()
    this.#server = createServer((request, response) => {
      void this.#handleRequest(request, response)
    })
    await new Promise<void>((resolveStart, rejectStart) => {
      this.#server?.once('error', rejectStart)
      this.#server?.listen(0, '127.0.0.1', () => resolveStart())
    })
    const address = this.#server.address()
    if (address == null || typeof address === 'string') throw new Error('Chrome bridge did not bind a TCP port.')
    this.#url = `http://127.0.0.1:${address.port}`
    await this.#writeCredential()
    this.#credentialTimer = setInterval(() => {
      void this.#writeCredential().catch(error =>
        this.options.logger.warn({ error }, '[chrome-driver] failed to refresh bridge credentials')
      )
    }, 2_000)
    this.#credentialTimer.unref?.()
    this.options.logger.info({ url: this.#url }, '[chrome-driver] bridge ready')
    return { url: this.#url }
  }

  async dispose() {
    if (this.#credentialTimer != null) {
      clearInterval(this.#credentialTimer)
      this.#credentialTimer = undefined
    }
    this.#rejectAll('DISCONNECTED', 'Chrome bridge stopped.')
    this.#artifactUploads.clear()
    this.#completedArtifacts.clear()
    await this.#removeOwnedCredential()
    if (this.#server != null) {
      const server = this.#server
      this.#server = undefined
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    }
  }

  async createPairingOffer(trustedOrigin: string, extensionId = CHROME_EXTENSION_ID, pairingNonce = '') {
    if (this.#url == null) throw new Error('Chrome bridge is not ready.')
    const normalizedOrigin = trustedOneWorksOrigin(trustedOrigin)
    if (extensionId !== CHROME_EXTENSION_ID || pairingNonce.length < 16) {
      throw bridgeError({
        code: 'EXTENSION_IDENTITY_MISMATCH',
        message: 'The installed extension identity or page challenge did not match OneWorks.',
        recoverable: true,
        user_action: 'Install the OneWorks-provided extension build and reconnect from its popup.'
      })
    }
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + PAIRING_TICKET_TTL_MS
    this.#pairingTickets.set(ticket, {
      expectedExtensionId: extensionId,
      expiresAt,
      pairingNonce,
      trustedOrigin: normalizedOrigin
    })
    this.#credentialClaimUntil = expiresAt
    await this.#writeCredential('pairing')
    return {
      bridge_url: this.#url,
      expected_extension_id: extensionId,
      expires_at: new Date(expiresAt).toISOString(),
      pairing_nonce: pairingNonce,
      protocol_version: PROTOCOL_VERSION,
      ticket,
      trusted_origin: normalizedOrigin
    }
  }

  approveConfirmation(confirmationId: string) {
    this.#expireSecurityState()
    const confirmation = this.#confirmations.get(confirmationId)
    if (confirmation == null || confirmation.status !== 'pending') {
      throw bridgeError({
        code: 'CONFIRMATION_NOT_FOUND',
        message: 'Confirmation is no longer pending.',
        recoverable: true
      })
    }
    confirmation.status = 'approved'
    this.#grants.set(confirmation.digest, Date.now() + CONFIRMATION_TTL_MS)
    this.#recordAudit({
      op: confirmation.op,
      outcome: 'approved',
      riskTier: confirmation.risk_tier,
      summary: confirmation.audit_summary,
      targetKey: confirmation.target_key
    })
    return confirmation
  }

  denyConfirmation(confirmationId: string) {
    this.#expireSecurityState()
    const confirmation = this.#confirmations.get(confirmationId)
    if (confirmation == null || confirmation.status !== 'pending') {
      throw bridgeError({
        code: 'CONFIRMATION_NOT_FOUND',
        message: 'Confirmation is no longer pending.',
        recoverable: true
      })
    }
    confirmation.status = 'denied'
    this.#recordAudit({
      op: confirmation.op,
      outcome: 'denied',
      riskTier: confirmation.risk_tier,
      summary: confirmation.audit_summary,
      targetKey: confirmation.target_key
    })
    return confirmation
  }

  status() {
    const now = Date.now()
    this.#expireSecurityState(now)
    const connection = this.#activeConnection
    const connected = connection != null && now - connection.lastSeenAt < CONNECTION_STALE_MS
    return {
      protocol_version: PROTOCOL_VERSION,
      connected,
      connection: connection == null
        ? null
        : {
          browser_session_id: connection.browserSessionId,
          capabilities: connection.capabilities,
          chrome_version: connection.chromeVersion,
          connection_id: connection.connectionId,
          extension_id: connection.extensionId,
          extension_version: connection.extensionVersion,
          last_seen_at: new Date(connection.lastSeenAt).toISOString(),
          oneworks_tab_id: connection.oneWorksTabId,
          permissions: connection.permissions,
          trusted_origin: connection.trustedOrigin
        },
      pending_confirmations: [...this.#confirmations.values()].filter(item => item.status === 'pending'),
      recent_audit: this.#audit.slice(-50).reverse()
    }
  }

  executeFromUi(op: string, args: JsonRecord, targetKey: string) {
    if (!new Set(['frames.list', 'capabilities.discover', 'security.get_policy', 'security.set_policy']).has(op)) {
      throw bridgeError({
        code: 'OPERATION_NOT_ALLOWED',
        message: 'UI bridge operation is not allowed.',
        recoverable: false
      })
    }
    return this.execute({ args, op, riskTier: op === 'security.set_policy' ? 2 : 1, targetKey })
  }

  async execute(input: { args: JsonRecord; op: string; riskTier: number; targetKey: string }) {
    const op = text(input.op)
    if (op === '') throw bridgeError({ code: 'INVALID_ARGUMENT', message: 'Operation is required.', recoverable: true })
    if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z]\w*$/u.test(op)) {
      throw bridgeError({
        code: 'INVALID_ARGUMENT',
        message: 'Operation must use a named module.action identifier.',
        recoverable: true
      })
    }
    const targetKey = canonicalTargetKey(op, input.args)
    if (!this.status().connected) {
      throw bridgeError({
        code: 'DISCONNECTED',
        message: 'External Browser is not connected.',
        recoverable: true,
        user_action: 'Open External Browser in OneWorks Settings or open the extension and reconnect.'
      })
    }
    const connection = this.#activeConnection
    if (connection == null) {
      throw bridgeError({ code: 'DISCONNECTED', message: 'External Browser is not connected.', recoverable: true })
    }
    const riskTier = Number.isInteger(input.riskTier) ? Math.max(0, Math.min(4, input.riskTier)) : 2
    this.#expireSecurityState()
    const digest = commandDigest(op, input.args, targetKey, connection)
    const auditSummary = summarizeAuditCommand(op, input.args, targetKey, digest)
    const reviewSummary = op.startsWith('raw.')
      ? summarizeRawReview(op, input.args, targetKey, digest)
      : auditSummary
    if (riskTier >= 3 && (this.#grants.get(digest) ?? 0) <= Date.now()) {
      const existing = [...this.#confirmations.values()].find(item =>
        item.digest === digest && item.status === 'pending'
      )
      const confirmation = existing ?? {
        audit_summary: auditSummary,
        browser_session_id: connection.browserSessionId,
        confirmation_id: `confirm_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
        connection_id: connection.connectionId,
        created_at: new Date().toISOString(),
        digest,
        expires_at: new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString(),
        op,
        risk_tier: riskTier,
        status: 'pending' as const,
        summary: reviewSummary,
        target_key: targetKey
      }
      this.#confirmations.set(confirmation.confirmation_id, confirmation)
      const auditId = this.#recordAudit({ op, outcome: 'requested', riskTier, summary: auditSummary, targetKey })
      throw bridgeError({
        audit_id: auditId,
        code: 'CONFIRMATION_REQUIRED',
        confirmation_id: confirmation.confirmation_id,
        message: 'This Chrome operation requires an explicit user confirmation.',
        recoverable: true,
        user_action: 'Approve the pending action in External Browser under OneWorks Settings, then retry.'
      })
    }
    this.#grants.delete(digest)
    return await this.#enqueueTargets(resourceKeysFor(input.args, targetKey), async () => {
      const command: BridgeCommand = {
        args: input.args,
        command_id: `command_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
        created_at: new Date().toISOString(),
        op,
        risk_tier: riskTier,
        target_key: targetKey
      }
      const auditId = this.#recordAudit({ op, outcome: 'requested', riskTier, summary: auditSummary, targetKey })
      try {
        const result = await this.#dispatch(command)
        this.#recordAudit({ op, outcome: 'succeeded', riskTier, summary: auditSummary, targetKey })
        return { audit_id: auditId, result }
      } catch (error) {
        this.#recordAudit({
          code: isRecord(error) && typeof error.code === 'string' ? error.code : undefined,
          op,
          outcome: 'failed',
          riskTier,
          summary: auditSummary,
          targetKey
        })
        throw error
      }
    }, op.startsWith('raw.'))
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse) {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      if (origin === `chrome-extension://${CHROME_EXTENSION_ID}`) {
        response.setHeader('access-control-allow-origin', origin)
        response.setHeader('access-control-allow-headers', 'authorization, content-type')
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
        response.setHeader('access-control-max-age', '600')
      }
      response.end()
      return
    }
    try {
      const url = new URL(request.url ?? '/', this.#url ?? 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') {
        jsonResponse(response, 200, { ok: true, protocol_version: PROTOCOL_VERSION }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/connect') {
        const body = await readJsonBody(request)
        jsonResponse(response, 200, { ok: true, result: await this.#connect(body, origin) }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/poll') {
        const connection = this.#authenticateExtension(request)
        connection.lastSeenAt = Date.now()
        jsonResponse(response, 200, { ok: true, result: { command: await this.#nextCommand() } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/capabilities') {
        const connection = this.#authenticateExtension(request)
        const body = await readJsonBody(request)
        if (!isRecord(body.capabilities) || !isRecord(body.permissions)) {
          throw bridgeError({
            code: 'INVALID_ARGUMENT',
            message: 'Capability updates require typed capabilities and permissions.',
            recoverable: true
          })
        }
        connection.capabilities = body.capabilities
        connection.permissions = body.permissions
        connection.lastSeenAt = Date.now()
        jsonResponse(response, 200, { ok: true, result: { accepted: true } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/ack') {
        const connection = this.#authenticateExtension(request)
        connection.lastSeenAt = Date.now()
        const body = await readJsonBody(request)
        this.#acknowledge(body)
        jsonResponse(response, 200, { ok: true, result: { accepted: true } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/artifacts/start') {
        const connection = this.#authenticateExtension(request)
        connection.lastSeenAt = Date.now()
        this.#expireSecurityState()
        const body = await readJsonBody(request)
        const size = Number(body.size)
        if (!Number.isInteger(size) || size < 1 || size > MAX_ARTIFACT_BYTES) {
          throw bridgeError({
            code: 'ARTIFACT_TOO_LARGE',
            message: 'Artifact size is outside the bounded upload limit.',
            recoverable: false
          })
        }
        if (this.#artifactUploads.size >= 4) {
          throw bridgeError({
            code: 'ARTIFACT_QUOTA_EXCEEDED',
            message: 'Too many concurrent artifact uploads.',
            recoverable: true
          })
        }
        const reservedBytes = [...this.#artifactUploads.values()].reduce((total, upload) => total + upload.size, 0) +
          [...this.#completedArtifacts.values()].reduce((total, artifact) => total + artifact.data.length, 0)
        if (reservedBytes + size > MAX_ARTIFACT_BYTES) {
          throw bridgeError({
            code: 'ARTIFACT_QUOTA_EXCEEDED',
            message: 'Concurrent artifact uploads exceed the per-session byte quota.',
            recoverable: true
          })
        }
        const artifactId = `artifact_${randomUUID().replaceAll('-', '').slice(0, 16)}`
        this.#artifactUploads.set(artifactId, { chunks: [], createdAt: Date.now(), receivedBytes: 0, size })
        jsonResponse(response, 200, { ok: true, result: { artifact_id: artifactId } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/artifacts/chunk') {
        const connection = this.#authenticateExtension(request)
        connection.lastSeenAt = Date.now()
        this.#expireSecurityState()
        const body = await readJsonBody(request)
        const artifactId = text(body.artifact_id)
        const upload = this.#artifactUploads.get(artifactId)
        const chunk = typeof body.data === 'string' ? body.data : ''
        const index = Number(body.index)
        if (upload == null || index !== upload.chunks.length || chunk.length > 1024 * 1024) {
          throw bridgeError({
            code: 'INVALID_ARTIFACT_CHUNK',
            message: 'Artifact chunk was missing or out of sequence.',
            recoverable: true
          })
        }
        if (
          upload.receivedBytes + chunk.length > upload.size || upload.receivedBytes + chunk.length > MAX_ARTIFACT_BYTES
        ) {
          this.#artifactUploads.delete(artifactId)
          throw bridgeError({
            code: 'ARTIFACT_SIZE_MISMATCH',
            message: 'Artifact chunks exceeded the declared upload size.',
            recoverable: false
          })
        }
        upload.chunks.push(chunk)
        upload.receivedBytes += chunk.length
        jsonResponse(response, 200, { ok: true, result: { accepted: true, next_index: upload.chunks.length } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/extensions/artifacts/finish') {
        const connection = this.#authenticateExtension(request)
        connection.lastSeenAt = Date.now()
        this.#expireSecurityState()
        const body = await readJsonBody(request)
        const artifactId = text(body.artifact_id)
        const upload = this.#artifactUploads.get(artifactId)
        if (upload == null) {
          throw bridgeError({
            code: 'ARTIFACT_NOT_FOUND',
            message: 'Artifact upload was not found.',
            recoverable: true
          })
        }
        const data = upload.chunks.join('')
        if (data.length !== upload.size) {
          throw bridgeError({
            code: 'ARTIFACT_SIZE_MISMATCH',
            message: 'Artifact upload size did not match.',
            recoverable: true
          })
        }
        this.#artifactUploads.delete(artifactId)
        this.#completedArtifacts.set(artifactId, { data, expiresAt: Date.now() + COMMAND_TIMEOUT_MS })
        jsonResponse(response, 200, { ok: true, result: { artifact_id: artifactId, completed: true } }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/control') {
        if (!safeEqual(bearerToken(request), this.controlToken)) {
          throw bridgeError({
            code: 'UNAUTHORIZED',
            message: 'Invalid Chrome bridge control token.',
            recoverable: false
          })
        }
        const body = await readJsonBody(request)
        const args = isRecord(body.args) ? body.args : {}
        const requestedRiskTier = typeof body.risk_tier === 'number' ? body.risk_tier : 0
        const result = await this.execute({
          args,
          op: text(body.op),
          riskTier: Math.max(minimumRiskFor(text(body.op), args), requestedRiskTier),
          targetKey: text(body.target_key) || 'browser'
        })
        jsonResponse(response, 200, { ok: true, result }, origin)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/pairing-offer') {
        if (!safeEqual(bearerToken(request), this.controlToken)) {
          throw bridgeError({
            code: 'UNAUTHORIZED',
            message: 'Invalid Chrome bridge control token.',
            recoverable: false
          })
        }
        const body = await readJsonBody(request)
        const trustedOrigin = text(body.trusted_origin)
        if (trustedOrigin === '') {
          throw bridgeError({ code: 'INVALID_ARGUMENT', message: 'Trusted origin is required.', recoverable: true })
        }
        jsonResponse(response, 200, {
          ok: true,
          result: await this.createPairingOffer(trustedOrigin, text(body.extension_id), text(body.pairing_nonce))
        }, origin)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        if (!safeEqual(bearerToken(request), this.controlToken)) {
          throw bridgeError({
            code: 'UNAUTHORIZED',
            message: 'Invalid Chrome bridge control token.',
            recoverable: false
          })
        }
        jsonResponse(response, 200, { ok: true, result: this.status() }, origin)
        return
      }
      jsonResponse(
        response,
        404,
        { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown bridge endpoint.' } },
        origin
      )
    } catch (error) {
      const details = error instanceof Error && 'details' in error
        ? (error as Error & { details: BridgeErrorShape }).details
        : {
          code: error instanceof Error && 'code' in error ? String(error.code) : 'BRIDGE_FAILED',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false
        }
      const status = details.code === 'UNAUTHORIZED' ? 401 : details.code === 'CONFIRMATION_REQUIRED' ? 409 : 400
      jsonResponse(response, status, { ok: false, error: details }, origin)
    }
  }

  async #connect(body: JsonRecord, origin?: string) {
    const protocolVersion = Number(body.protocol_version)
    if (protocolVersion !== PROTOCOL_VERSION) {
      throw bridgeError({
        code: 'VERSION_MISMATCH',
        message: `External Browser protocol ${PROTOCOL_VERSION} is required; extension sent ${
          protocolVersion || 'unknown'
        }.`,
        recoverable: true,
        user_action: 'Update the OneWorks Chrome extension and reconnect.'
      })
    }
    const extensionId = text(body.extension_id)
    const trustedOrigin = text(body.trusted_origin)
    if (extensionId === '' || trustedOrigin === '') {
      throw bridgeError({
        code: 'INVALID_ARGUMENT',
        message: 'Extension id and trusted origin are required.',
        recoverable: true
      })
    }
    if (origin == null || origin !== `chrome-extension://${extensionId}` || extensionId !== CHROME_EXTENSION_ID) {
      throw bridgeError({
        code: 'ORIGIN_MISMATCH',
        message: 'Extension origin did not match its id.',
        recoverable: false
      })
    }
    const normalizedTrustedOrigin = trustedOneWorksOrigin(trustedOrigin)
    const reconnectToken = text(body.client_token)
    const extensionSessionId = text(body.extension_session_id)
    let clientToken = reconnectToken
    const reconnectAllowed = this.#pairingState != null &&
      this.#pairingState.extensionId === extensionId &&
      this.#pairingState.trustedOrigin === normalizedTrustedOrigin &&
      safeEqual(this.#pairingState.clientTokenHash, tokenHash(reconnectToken))
    if (!reconnectAllowed) {
      const ticket = text(body.ticket)
      const offer = this.#pairingTickets.get(ticket)
      if (
        offer == null || offer.expiresAt <= Date.now() || offer.trustedOrigin !== normalizedTrustedOrigin ||
        offer.expectedExtensionId !== extensionId || offer.pairingNonce !== text(body.pairing_nonce)
      ) {
        throw bridgeError({
          code: 'PAIRING_REQUIRED',
          message: 'A fresh OneWorks pairing offer is required.',
          recoverable: true,
          user_action: 'Click Connect browser in External Browser under OneWorks Settings.'
        })
      }
      this.#pairingTickets.delete(ticket)
      clientToken = randomBytes(32).toString('base64url')
      this.#pairingState = {
        clientTokenHash: tokenHash(clientToken),
        extensionId,
        trustedOrigin: normalizedTrustedOrigin
      }
      await this.#savePairingState()
    }
    const existingConnection = this.#activeConnection
    if (
      reconnectAllowed &&
      extensionSessionId !== '' &&
      existingConnection?.extensionSessionId === extensionSessionId &&
      existingConnection.extensionId === extensionId &&
      existingConnection.trustedOrigin === normalizedTrustedOrigin
    ) {
      existingConnection.capabilities = body.capabilities
      existingConnection.chromeVersion = text(body.chrome_version) || undefined
      existingConnection.extensionVersion = text(body.extension_version) || undefined
      existingConnection.lastSeenAt = Date.now()
      existingConnection.oneWorksTabId = Number.isInteger(body.oneworks_tab_id)
        ? Number(body.oneworks_tab_id)
        : existingConnection.oneWorksTabId
      existingConnection.permissions = body.permissions
      return {
        browser_session_id: existingConnection.browserSessionId,
        client_token: clientToken,
        connection_id: existingConnection.connectionId,
        poll_workers: 4,
        protocol_version: PROTOCOL_VERSION,
        reused: true,
        session_token: existingConnection.sessionToken
      }
    }
    this.#rejectAll('DISCONNECTED', 'Chrome extension connection was replaced.')
    this.#clearSessionSecurityState()
    const connection: ActiveConnection = {
      browserSessionId: `chrome_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      capabilities: body.capabilities,
      chromeVersion: text(body.chrome_version) || undefined,
      connectionId: `connection_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      extensionId,
      ...(extensionSessionId === '' ? {} : { extensionSessionId }),
      extensionVersion: text(body.extension_version) || undefined,
      lastSeenAt: Date.now(),
      oneWorksTabId: Number.isInteger(body.oneworks_tab_id) ? Number(body.oneworks_tab_id) : undefined,
      permissions: body.permissions,
      sessionToken: randomBytes(32).toString('base64url'),
      trustedOrigin: normalizedTrustedOrigin
    }
    this.#activeConnection = connection
    return {
      browser_session_id: connection.browserSessionId,
      client_token: clientToken,
      connection_id: connection.connectionId,
      poll_workers: 4,
      protocol_version: PROTOCOL_VERSION,
      reused: false,
      session_token: connection.sessionToken
    }
  }

  #authenticateExtension(request: IncomingMessage) {
    const connection = this.#activeConnection
    const token = bearerToken(request)
    if (connection == null || token === '' || !safeEqual(connection.sessionToken, token)) {
      throw bridgeError({
        code: 'DISCONNECTED',
        message: 'Chrome extension session is not connected.',
        recoverable: true
      })
    }
    return connection
  }

  async #nextCommand() {
    const immediate = this.#commandQueue.shift()
    if (immediate != null) return immediate
    return await new Promise<BridgeCommand | null>(resolveNext => {
      const waiter: PollWaiter = {
        resolve: resolveNext,
        timer: setTimeout(() => {
          const index = this.#pollWaiters.indexOf(waiter)
          if (index >= 0) this.#pollWaiters.splice(index, 1)
          resolveNext(null)
        }, POLL_TIMEOUT_MS)
      }
      this.#pollWaiters.push(waiter)
    })
  }

  #dispatch(command: BridgeCommand) {
    return new Promise<unknown>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.#commandWaiters.delete(command.command_id)
        rejectCommand(
          bridgeError({ code: 'TIMEOUT', message: 'Chrome extension command timed out.', recoverable: true })
        )
      }, COMMAND_TIMEOUT_MS)
      this.#commandWaiters.set(command.command_id, {
        sensitiveResultMode: sensitiveResultModeFor(command.op),
        op: command.op,
        reject: rejectCommand,
        resolve: resolveCommand,
        timer
      })
      const pollWaiter = this.#pollWaiters.shift()
      if (pollWaiter != null) {
        clearTimeout(pollWaiter.timer)
        pollWaiter.resolve(command)
      } else {
        this.#commandQueue.push(command)
      }
    })
  }

  #acknowledge(body: JsonRecord) {
    const commandId = text(body.command_id)
    const waiter = this.#commandWaiters.get(commandId)
    if (waiter == null) {
      if ((this.#ackLedger.get(commandId)?.expiresAt ?? 0) > Date.now()) return
      throw bridgeError({ code: 'COMMAND_NOT_FOUND', message: 'Command is no longer pending.', recoverable: true })
    }
    clearTimeout(waiter.timer)
    this.#commandWaiters.delete(commandId)
    this.#ackLedger.set(commandId, { expiresAt: Date.now() + COMMAND_TIMEOUT_MS })
    if (body.ok === true) {
      const result = isRecord(body.result) ? body.result : body.result
      if (this.#activeConnection != null && isRecord(result)) {
        if (waiter.op === 'capabilities.discover') {
          this.#activeConnection.capabilities = result
        } else if (waiter.op === 'security.get_policy' || waiter.op === 'security.set_policy') {
          const capabilities = isRecord(this.#activeConnection.capabilities)
            ? this.#activeConnection.capabilities
            : {}
          this.#activeConnection.capabilities = { ...capabilities, advanced_access: result }
        }
      }
      if (isRecord(result) && typeof result.artifact_id === 'string') {
        const artifact = this.#completedArtifacts.get(result.artifact_id)
        if (artifact == null) {
          waiter.reject(
            bridgeError({
              code: 'ARTIFACT_NOT_FOUND',
              message: 'Completed Chrome artifact was not found.',
              recoverable: true
            })
          )
          return
        }
        this.#completedArtifacts.delete(result.artifact_id)
        const resolved = { ...result, artifact_id: undefined, data_base64: artifact.data }
        waiter.resolve(
          waiter.sensitiveResultMode === 'raw' || waiter.sensitiveResultMode === 'cookie'
            ? resolved
            : waiter.sensitiveResultMode === 'snapshot'
            ? sanitizeSensitiveSnapshotResult(resolved)
            : sanitizeBridgeResult(resolved)
        )
        return
      }
      waiter.resolve(
        waiter.sensitiveResultMode === 'raw' || waiter.sensitiveResultMode === 'cookie'
          ? result
          : waiter.sensitiveResultMode === 'snapshot'
          ? sanitizeSensitiveSnapshotResult(result)
          : sanitizeBridgeResult(result)
      )
      return
    }
    const errorValue = isRecord(body.error) ? body.error : {}
    const details: BridgeErrorShape = {
      code: text(errorValue.code) || 'CHROME_OPERATION_FAILED',
      message: text(errorValue.message) || 'Chrome operation failed.',
      recoverable: errorValue.recoverable !== false,
      ...(typeof errorValue.advanced_access_key === 'string'
        ? { advanced_access_key: errorValue.advanced_access_key }
        : {}),
      ...(Array.isArray(errorValue.missing_permissions)
        ? { missing_permissions: errorValue.missing_permissions.filter(item => typeof item === 'string') }
        : {}),
      ...(typeof errorValue.user_action === 'string' ? { user_action: errorValue.user_action } : {})
    }
    waiter.reject(bridgeError(details))
  }

  #enqueueTargets<T>(targetKeys: string[], task: () => Promise<T>, globallyExclusive = false) {
    const previous = globallyExclusive
      ? [this.#globalTail, ...this.#targetTails.values()]
      : [this.#globalTail, ...targetKeys.map(targetKey => this.#targetTails.get(targetKey) ?? Promise.resolve())]
    const result = Promise.all(previous).then(task, task)
    const tail = result.then(() => undefined, () => undefined)
    if (globallyExclusive) this.#globalTail = tail
    else for (const targetKey of targetKeys) this.#targetTails.set(targetKey, tail)
    void tail.then(() => {
      if (globallyExclusive && this.#globalTail === tail) this.#globalTail = Promise.resolve()
      for (const targetKey of targetKeys) {
        if (this.#targetTails.get(targetKey) === tail) this.#targetTails.delete(targetKey)
      }
    })
    return result
  }

  #rejectAll(code: string, message: string) {
    for (const waiter of this.#commandWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(bridgeError({ code, message, recoverable: true }))
    }
    this.#commandWaiters.clear()
    this.#commandQueue = []
    for (const waiter of this.#pollWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(null)
    }
    this.#pollWaiters = []
  }

  #expireSecurityState(now = Date.now()) {
    for (const [digest, expiresAt] of this.#grants) if (expiresAt <= now) this.#grants.delete(digest)
    for (const confirmation of this.#confirmations.values()) {
      if (confirmation.status === 'pending' && Date.parse(confirmation.expires_at) <= now) {
        confirmation.status = 'denied'
        this.#recordAudit({
          code: 'CONFIRMATION_EXPIRED',
          op: confirmation.op,
          outcome: 'denied',
          riskTier: confirmation.risk_tier,
          summary: confirmation.audit_summary,
          targetKey: confirmation.target_key
        })
      }
    }
    for (const [commandId, entry] of this.#ackLedger) if (entry.expiresAt <= now) this.#ackLedger.delete(commandId)
    for (const [artifactId, entry] of this.#completedArtifacts) {
      if (entry.expiresAt <= now) this.#completedArtifacts.delete(artifactId)
    }
    for (const [artifactId, entry] of this.#artifactUploads) {
      if (entry.createdAt + COMMAND_TIMEOUT_MS <= now) this.#artifactUploads.delete(artifactId)
    }
  }

  #clearSessionSecurityState() {
    this.#grants.clear()
    this.#artifactUploads.clear()
    this.#completedArtifacts.clear()
    for (const confirmation of this.#confirmations.values()) {
      if (confirmation.status === 'pending') confirmation.status = 'denied'
    }
  }

  #recordAudit(input: {
    code?: string
    op: string
    outcome: AuditEntry['outcome']
    riskTier: number
    summary: string
    targetKey: string
  }) {
    const entry: AuditEntry = {
      audit_id: `audit_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      at: new Date().toISOString(),
      ...(input.code == null ? {} : { code: input.code }),
      ...(this.#activeConnection == null ? {} : { connection_id: this.#activeConnection.connectionId }),
      op: input.op,
      outcome: input.outcome,
      risk_tier: input.riskTier,
      summary: input.summary,
      target_key: input.targetKey
    }
    this.#audit.push(entry)
    if (this.#audit.length > MAX_AUDIT_ENTRIES) this.#audit.splice(0, this.#audit.length - MAX_AUDIT_ENTRIES)
    void this.#appendAudit(entry)
    return entry.audit_id
  }

  async #appendAudit(entry: AuditEntry) {
    try {
      const path = join(this.options.projectHome, 'chrome-driver', 'audit.jsonl')
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const { appendFile } = await import('node:fs/promises')
      await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      this.options.logger.warn({ error }, '[chrome-driver] failed to append audit')
    }
  }

  async #loadPairingState() {
    try {
      const value = JSON.parse(await readFile(this.persistentStatePath, 'utf8')) as unknown
      if (
        isRecord(value) && text(value.clientTokenHash) !== '' && text(value.extensionId) !== '' &&
        text(value.trustedOrigin) !== ''
      ) {
        this.#pairingState = {
          clientTokenHash: text(value.clientTokenHash),
          extensionId: text(value.extensionId),
          trustedOrigin: text(value.trustedOrigin)
        }
      }
    } catch {}
  }

  async #savePairingState() {
    if (this.#pairingState == null) return
    await mkdir(dirname(this.persistentStatePath), { recursive: true, mode: 0o700 })
    await writeFile(this.persistentStatePath, `${JSON.stringify(this.#pairingState, null, 2)}\n`, { mode: 0o600 })
    await chmod(this.persistentStatePath, 0o600)
  }

  async #writeCredential(reason: 'pairing' | 'refresh' = 'refresh') {
    if (this.#url == null) return
    await mkdir(dirname(this.credentialPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.credentialPath), 0o700)
    try {
      const current = JSON.parse(await readFile(this.credentialPath, 'utf8')) as CredentialFile
      if (current.controlToken !== this.controlToken && processIsAlive(current.pid)) {
        const sameProcessPairingRollover = current.pid === process.pid &&
          current.runtimeRole === (this.options.runtimeRole ?? 'workspace') && reason === 'pairing'
        if (!sameProcessPairingRollover && Number(current.leaseUntil) > Date.now()) return
        if (
          !sameProcessPairingRollover &&
          (this.options.runtimeRole ?? 'workspace') === 'manager' &&
          current.runtimeRole === 'workspace' &&
          reason !== 'pairing' &&
          this.#credentialClaimUntil <= Date.now()
        ) return
      }
    } catch {}
    const activeLease =
      this.#activeConnection != null && Date.now() - this.#activeConnection.lastSeenAt < CONNECTION_STALE_MS
        ? Date.now() + 5_000
        : 0
    const leaseUntil = Math.max(this.#credentialClaimUntil, activeLease)
    const temporaryPath = `${this.credentialPath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(
      temporaryPath,
      `${
        JSON.stringify({
          baseUrl: this.#url,
          controlToken: this.controlToken,
          ...(leaseUntil > Date.now() ? { leaseUntil } : {}),
          pid: process.pid,
          protocolVersion: PROTOCOL_VERSION,
          runtimeRole: this.options.runtimeRole ?? 'workspace',
          workspaceFolder: resolve(this.options.workspaceFolder)
        })
      }\n`,
      { mode: 0o600 }
    )
    await rename(temporaryPath, this.credentialPath)
    await chmod(this.credentialPath, 0o600)
  }

  async #removeOwnedCredential() {
    try {
      const current = JSON.parse(await readFile(this.credentialPath, 'utf8')) as CredentialFile
      if (current.controlToken !== this.controlToken) return
      await rm(this.credentialPath, { force: true })
    } catch {}
  }
}
