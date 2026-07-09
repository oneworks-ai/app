/* eslint-disable max-lines -- document sync keeps path policy, encryption, filesystem IO, and fixture entries together. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { readOneWorksAuthStore } from '@oneworks/utils/auth-store'

import type { ResolvedRelayServer } from './options.js'
import {
  RELAY_PERSONAL_DOCUMENT_SYNC_KINDS,
  readRelayPersonalDocumentSyncPreferences,
  relayPersonalDocumentSyncEnabled
} from './personal-document-sync-preferences.js'
import type { RelayPersonalDocumentSyncPreferences } from './personal-document-sync-preferences.js'
import type {
  RelayPersonalDocumentEntry,
  RelayPersonalDocumentSyncCounts,
  RelayPersonalDocumentSyncStatus,
  RelayStoredServer
} from './types.js'
import { isRecord, normalizeRemoteBaseUrl, toString } from './utils.js'

type RelayPersonalDocumentKind = keyof RelayPersonalDocumentSyncPreferences

interface RelayPersonalDocumentFile {
  content: string
  hash: string
  kind: RelayPersonalDocumentKind
  mtimeMs: number
  path: string
  sizeBytes: number
}

interface RelayPersonalDocumentPayload {
  documents: RelayPersonalDocumentFile[]
  version: 1
}

interface RelayPersonalDocumentEncryptedPayload {
  algorithm: 'aes-256-gcm'
  ciphertext: string
  iv: string
  tag: string
  version: 1
}

interface RelayPersonalDocumentSnapshotPayload {
  countsByKind: RelayPersonalDocumentSyncCounts
  documentCount: number
  encryptedPayload: RelayPersonalDocumentEncryptedPayload
  hash?: string
  totalSizeBytes: number
  updatedAt?: string
  version: 1
}

interface RelayPersonalConfigSnapshotPayload {
  documents?: RelayPersonalDocumentSnapshotPayload
  hash?: string
  updatedAt?: string
  userId?: string
}

interface RelayTeamDocumentSnapshotPayload extends RelayPersonalDocumentSnapshotPayload {
  teamId?: string
  updatedByUserId?: string
}

interface ApplyRemoteDocumentsResult {
  conflictBackups: number
}

export type RelayDocumentScope =
  | { id: string; type: 'account' }
  | { id: string; type: 'team' }

type RelayDocumentOpenMode = 'open' | 'reveal'

const PERSONAL_DOCUMENT_KINDS: RelayPersonalDocumentKind[] = [...RELAY_PERSONAL_DOCUMENT_SYNC_KINDS]

const emptyCounts = (): RelayPersonalDocumentSyncCounts => ({
  agents: 0,
  ooAgents: 0,
  ooRules: 0
})

const countFromCounts = (counts: RelayPersonalDocumentSyncCounts) => counts.agents + counts.ooAgents + counts.ooRules

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`
  }
  if (!isRecord(value)) {
    return JSON.stringify(value)
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(',')}}`
}

const hashText = (value: string) => (
  `sha256:${createHash('sha256').update(value).digest('hex')}`
)

const hashDocumentPayload = (payload: RelayPersonalDocumentPayload) => (
  `sha256:${
    createHash('sha256')
      .update(stableJsonStringify({
        documents: payload.documents
          .map(document => ({
            content: document.content,
            kind: document.kind,
            path: document.path
          }))
          .sort((left, right) => left.path.localeCompare(right.path)),
        version: payload.version
      }))
      .digest('hex')
  }`
)

const normalizeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
)

const normalizeCounts = (value: unknown): RelayPersonalDocumentSyncCounts => {
  const input = isRecord(value) ? value : {}
  return {
    agents: normalizeNumber(input.agents) ?? 0,
    ooAgents: normalizeNumber(input.ooAgents) ?? 0,
    ooRules: normalizeNumber(input.ooRules) ?? 0
  }
}

const countDocuments = (documents: RelayPersonalDocumentFile[]): RelayPersonalDocumentSyncCounts => {
  const counts = emptyCounts()
  for (const document of documents) {
    counts[document.kind] += 1
  }
  return counts
}

const totalSizeBytes = (documents: RelayPersonalDocumentFile[]) => (
  documents.reduce((total, document) => total + document.sizeBytes, 0)
)

const enabledKindSet = (preferences: RelayPersonalDocumentSyncPreferences) => (
  new Set(PERSONAL_DOCUMENT_KINDS.filter(kind => preferences[kind]))
)

const filterDocumentsByPreferences = (
  documents: RelayPersonalDocumentFile[],
  preferences: RelayPersonalDocumentSyncPreferences
) => {
  const enabledKinds = enabledKindSet(preferences)
  return documents.filter(document => enabledKinds.has(document.kind))
}

const readResponseJson = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

const normalizeEncryptedPayload = (value: unknown): RelayPersonalDocumentEncryptedPayload | undefined => {
  if (!isRecord(value)) return undefined
  const algorithm = toString(value.algorithm)
  const ciphertext = toString(value.ciphertext)
  const iv = toString(value.iv)
  const tag = toString(value.tag)
  if (
    algorithm !== 'aes-256-gcm' ||
    ciphertext === '' ||
    iv === '' ||
    tag === '' ||
    (value.version !== 1 && value.version !== '1')
  ) {
    return undefined
  }
  return {
    algorithm,
    ciphertext,
    iv,
    tag,
    version: 1
  }
}

const normalizeDocumentSnapshot = (value: unknown): RelayPersonalDocumentSnapshotPayload | undefined => {
  if (!isRecord(value)) return undefined
  const encryptedPayload = normalizeEncryptedPayload(value.encryptedPayload)
  if (encryptedPayload == null || (value.version !== 1 && value.version !== '1')) return undefined
  const countsByKind = normalizeCounts(value.countsByKind)
  return {
    countsByKind,
    documentCount: normalizeNumber(value.documentCount) ?? countFromCounts(countsByKind),
    encryptedPayload,
    hash: toString(value.hash) || undefined,
    totalSizeBytes: normalizeNumber(value.totalSizeBytes) ?? 0,
    updatedAt: toString(value.updatedAt) || undefined,
    version: 1
  }
}

const readPersonalConfigPayload = (body: Record<string, unknown>): RelayPersonalConfigSnapshotPayload | undefined => {
  const payload = isRecord(body.personalConfigSnapshot)
    ? body.personalConfigSnapshot
    : isRecord(body.personalConfig)
    ? body.personalConfig
    : undefined
  if (payload == null) return undefined
  return {
    documents: normalizeDocumentSnapshot(payload.documents),
    hash: toString(payload.hash) || undefined,
    updatedAt: toString(payload.updatedAt) || undefined,
    userId: toString(payload.userId) || undefined
  }
}

const readTeamDocumentSnapshotPayload = (
  body: Record<string, unknown>
): RelayTeamDocumentSnapshotPayload | undefined => {
  const payload = isRecord(body.teamDocumentSnapshot) ? body.teamDocumentSnapshot : undefined
  const documents = normalizeDocumentSnapshot(payload)
  if (documents == null) return undefined
  return {
    ...documents,
    teamId: toString(payload?.teamId) || undefined,
    updatedByUserId: toString(payload?.updatedByUserId) || undefined
  }
}

const resolveUserHomeDir = () =>
  resolve(
    process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() ||
      process.env.HOME?.trim() ||
      homedir()
  )

const normalizeDocumentActionPayloadPath = (path: string) => {
  const trimmed = path.trim()
  const payloadPath = trimmed.startsWith('~/') ? trimmed.slice(2) : trimmed
  if (
    payloadPath === '' ||
    payloadPath.startsWith('/') ||
    payloadPath.includes('\0') ||
    (
      payloadPath !== 'AGENTS.md' &&
      payloadPath !== '.oo/AGENTS.md' &&
      !payloadPath.startsWith('.oo/rules/') &&
      !payloadPath.startsWith('.oo/accounts/') &&
      !payloadPath.startsWith('.oo/teams/')
    )
  ) {
    return undefined
  }
  return payloadPath.split(/[\\/]+/u).join('/')
}

const resolveDocumentActionPath = (payloadPath: string) => {
  const normalized = normalizeDocumentActionPayloadPath(payloadPath)
  if (normalized == null) return undefined
  const homeDir = resolveUserHomeDir()
  const target = resolve(homeDir, normalized)
  return target === homeDir || !target.startsWith(`${homeDir}${sep}`)
    ? undefined
    : { displayPath: `~/${normalized}`, payloadPath: normalized, target }
}

const spawnDesktopOpen = async (
  command: string,
  args: string[]
) =>
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', rejectPromise)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })

export const openRelayDocumentPath = async (
  payloadPath: string,
  mode: RelayDocumentOpenMode
) => {
  const resolved = resolveDocumentActionPath(payloadPath)
  if (resolved == null) {
    throw new Error('文档路径不在允许的同步命名空间内。')
  }
  const fileStat = await stat(resolved.target).catch(() => undefined)
  if (fileStat == null || !fileStat.isFile()) {
    throw new Error(`文件不存在：${resolved.displayPath}`)
  }

  const currentPlatform = platform()
  if (currentPlatform === 'darwin') {
    await spawnDesktopOpen('open', mode === 'reveal' ? ['-R', resolved.target] : [resolved.target])
  } else if (currentPlatform === 'win32') {
    await spawnDesktopOpen(
      mode === 'reveal' ? 'explorer.exe' : 'cmd',
      mode === 'reveal' ? [`/select,${resolved.target}`] : ['/c', 'start', '', resolved.target]
    )
  } else {
    await spawnDesktopOpen('xdg-open', [mode === 'reveal' ? dirname(resolved.target) : resolved.target])
  }

  return {
    mode,
    path: resolved.payloadPath
  }
}

export const readRelayDocumentContent = async (
  payloadPath: string
) => {
  const resolved = resolveDocumentActionPath(payloadPath)
  if (resolved == null) {
    throw new Error('文档路径不在允许的同步命名空间内。')
  }
  const fileStat = await stat(resolved.target).catch(() => undefined)
  if (fileStat == null || !fileStat.isFile()) {
    throw new Error(`文件不存在：${resolved.displayPath}`)
  }
  const content = await readFile(resolved.target, 'utf8')

  return {
    content,
    displayPath: resolved.displayPath,
    path: resolved.payloadPath,
    sizeBytes: fileStat.size,
    updatedAt: new Date(fileStat.mtimeMs).toISOString()
  }
}

const isLocalOnlyMarkdownPath = (path: string) => basename(path).endsWith('.local.md')

const normalizePayloadPath = (homeDir: string, path: string) => (
  relative(homeDir, path).split(sep).join('/')
)

const scopeSegment = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('Relay document scope id is required.')
  return trimmed.replace(/[\\/]/gu, '_')
}

const agentsPayloadPath = (scope: RelayDocumentScope) => (
  scope.type === 'account'
    ? 'AGENTS.md'
    : `${documentBasePayloadPath(scope)}/AGENTS.md`
)

const documentBasePayloadPath = (scope: RelayDocumentScope) => (
  scope.type === 'account'
    ? ''
    : `.oo/teams/${scopeSegment(scope.id)}`
)

const ooAgentsPayloadPath = (scope: RelayDocumentScope) => (
  scope.type === 'account'
    ? '.oo/AGENTS.md'
    : agentsPayloadPath(scope)
)

const rulesPayloadRoot = (scope: RelayDocumentScope) => (
  scope.type === 'account'
    ? '.oo/rules'
    : `${documentBasePayloadPath(scope)}/rules`
)

const fixtureDocumentTitle = (scope: RelayDocumentScope) => (
  scope.type === 'account' ? 'Owner Local' : 'Team Workspace'
)

const fixtureDocumentFiles = (scope: RelayDocumentScope) => {
  const title = fixtureDocumentTitle(scope)
  return [
    {
      content:
        `---\ntitle: ${title} Agent Guide\nname: ${scope.type}-agents\n---\n\n# ${title} Agent Guide\n\nShared guidance fixture for Relay document sync visual testing.\n`,
      path: agentsPayloadPath(scope)
    },
    ...(scope.type === 'account'
      ? [{
        content:
          `---\ntitle: OneWorks User Agent Guide\nname: user-agents\n---\n\n# OneWorks User Agent Guide\n\nUser-level guidance shared across local OneWorks workspaces.\n`,
        path: ooAgentsPayloadPath(scope)
      }]
      : []),
    {
      content:
        `---\ntitle: Backend API Contracts\nname: backend-api-contracts\n---\n\n# Backend API Contracts\n\nDocument request and response compatibility for Relay services.\n`,
      path: `${rulesPayloadRoot(scope)}/backend/api/contracts.md`
    },
    {
      content:
        `---\ntitle: Coding Standards\nname: coding-standards\n---\n\n# Coding Standards\n\nUse small focused changes, keep sync paths deterministic, and prefer typed contracts.\n`,
      path: `${rulesPayloadRoot(scope)}/coding.md`
    },
    {
      content:
        `---\ntitle: Visual Regression Review\nname: visual-regression-review\n---\n\n# Visual Regression Review\n\nCheck list density, hover actions, query persistence, and preview editor layout.\n`,
      path: `${rulesPayloadRoot(scope)}/frontend/review/visual-regression.md`
    },
    {
      content:
        `---\ntitle: Local Model Routing\nname: local-model-routing\n---\n\n# Local Model Routing\n\nThis local-only fixture stays on the device and should not be uploaded.\n`,
      path: `${rulesPayloadRoot(scope)}/local/model-routing.local.md`
    },
    {
      content:
        `---\ntitle: Review Checklist\nname: review-checklist\n---\n\n# Review Checklist\n\nConfirm metadata titles, nested paths, right-click actions, and external open commands.\n`,
      path: `${rulesPayloadRoot(scope)}/review.md`
    }
  ]
}

export const ensureRelayFixtureDocumentEntries = async (scope: RelayDocumentScope) => {
  const homeDir = resolveUserHomeDir()
  for (const file of fixtureDocumentFiles(scope)) {
    const target = resolve(homeDir, file.path)
    const existing = await readFile(target, 'utf8').catch(() => undefined)
    if (existing != null) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, {
      encoding: 'utf8',
      mode: 0o600
    })
  }
}

const readDocumentFile = async (
  homeDir: string,
  kind: RelayPersonalDocumentKind,
  payloadPath: string
): Promise<RelayPersonalDocumentFile | undefined> => {
  if (isLocalOnlyMarkdownPath(payloadPath)) return undefined
  const path = resolve(homeDir, payloadPath)
  const content = await readFile(path, 'utf8').catch(() => undefined)
  if (content == null) return undefined
  const fileStat = await stat(path).catch(() => undefined)
  return {
    content,
    hash: hashText(content),
    kind,
    mtimeMs: fileStat?.mtimeMs ?? 0,
    path: payloadPath,
    sizeBytes: Buffer.byteLength(content, 'utf8')
  }
}

const scanMarkdownPayloadPaths = async (
  homeDir: string,
  payloadRoot: string
): Promise<string[]> => {
  const root = resolve(homeDir, payloadRoot)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const paths = await Promise.all(entries.map(async (entry) => {
    const payloadPath = `${payloadRoot}/${entry.name}`
    if (entry.isDirectory()) return scanMarkdownPayloadPaths(homeDir, payloadPath)
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') return []
    return [normalizePayloadPath(homeDir, resolve(homeDir, payloadPath))]
  }))
  return paths.flat()
}

const stripMetadataQuotes = (value: string) => {
  const trimmed = value.trim()
  const quote = trimmed[0]
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

const markdownMetadataDisplayName = (content: string) => {
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content
  const lines = normalized.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') return undefined
  const closingIndex = lines.slice(1).findIndex(line => line.trim() === '---')
  if (closingIndex < 0) return undefined
  const metadataLines = lines.slice(1, closingIndex + 1)
  const metadata = new Map<string, string>()
  for (const line of metadataLines) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (!/^[A-Za-z][\w-]*$/u.test(key) || value === '') continue
    metadata.set(key.toLowerCase(), stripMetadataQuotes(value))
  }
  return metadata.get('title') || metadata.get('name') || metadata.get('displayname') || undefined
}

export const listRelayDocumentEntries = async (
  scope: RelayDocumentScope
): Promise<RelayPersonalDocumentEntry[]> => {
  const homeDir = resolveUserHomeDir()
  const basePayloadPath = documentBasePayloadPath(scope)
  const scannedRulePaths = await scanMarkdownPayloadPaths(homeDir, rulesPayloadRoot(scope))
  const accountRulePaths = scannedRulePaths.length === 0
    ? [`${rulesPayloadRoot(scope)}/**/*.md`]
    : scannedRulePaths
  const payloadPaths: Array<{ kind: RelayPersonalDocumentKind; path: string }> = scope.type === 'account'
    ? [
      { kind: 'agents', path: agentsPayloadPath(scope) },
      { kind: 'ooAgents', path: ooAgentsPayloadPath(scope) },
      ...accountRulePaths.map(path => ({ kind: 'ooRules' as const, path }))
    ]
    : [
      { kind: 'agents', path: agentsPayloadPath(scope) },
      ...scannedRulePaths.map(path => ({ kind: 'agents' as const, path }))
    ]
  const entries = await Promise.all(payloadPaths.map(async ({ kind, path: payloadPath }) => {
    const path = resolve(homeDir, payloadPath)
    const content = await readFile(path, 'utf8').catch(() => undefined)
    const relativePath = basePayloadPath !== '' && payloadPath.startsWith(`${basePayloadPath}/`)
      ? payloadPath.slice(basePayloadPath.length + 1)
      : payloadPath
    return {
      displayName: markdownMetadataDisplayName(content ?? '') || basename(payloadPath),
      exists: content != null,
      kind,
      localOnly: isLocalOnlyMarkdownPath(payloadPath),
      path: payloadPath,
      relativePath
    }
  }))
  return entries.sort((left, right) => {
    if (left.relativePath === 'AGENTS.md') return -1
    if (right.relativePath === 'AGENTS.md') return 1
    if (left.relativePath === '.oo/AGENTS.md') return -1
    if (right.relativePath === '.oo/AGENTS.md') return 1
    return left.relativePath.localeCompare(right.relativePath)
  })
}

const collectLocalDocuments = async (
  preferences: RelayPersonalDocumentSyncPreferences,
  scope: RelayDocumentScope
): Promise<RelayPersonalDocumentPayload> => {
  const homeDir = resolveUserHomeDir()
  const documents: RelayPersonalDocumentFile[] = []
  if (scope.type === 'team') {
    if (preferences.agents) {
      const payloadPaths = [
        agentsPayloadPath(scope),
        ...await scanMarkdownPayloadPaths(homeDir, rulesPayloadRoot(scope))
      ]
      for (const payloadPath of payloadPaths) {
        const document = await readDocumentFile(homeDir, 'agents', payloadPath)
        if (document != null) documents.push(document)
      }
    }
  } else {
    if (preferences.agents) {
      const document = await readDocumentFile(homeDir, 'agents', agentsPayloadPath(scope))
      if (document != null) documents.push(document)
    }
    if (preferences.ooAgents) {
      const document = await readDocumentFile(homeDir, 'ooAgents', ooAgentsPayloadPath(scope))
      if (document != null) documents.push(document)
    }
    if (preferences.ooRules) {
      const payloadPaths = await scanMarkdownPayloadPaths(homeDir, rulesPayloadRoot(scope))
      for (const payloadPath of payloadPaths) {
        const document = await readDocumentFile(homeDir, 'ooRules', payloadPath)
        if (document != null) documents.push(document)
      }
    }
  }
  return {
    documents: documents.sort((left, right) => left.path.localeCompare(right.path)),
    version: 1
  }
}

const localPayloadUpdatedAt = (payload: RelayPersonalDocumentPayload) => {
  const mtimeMs = Math.max(0, ...payload.documents.map(document => document.mtimeMs))
  return mtimeMs === 0 ? undefined : new Date(mtimeMs).toISOString()
}

const localPayloadIsNewer = (
  localUpdatedAt: string | undefined,
  remoteUpdatedAt: string | undefined
) => {
  if (localUpdatedAt == null) return false
  if (remoteUpdatedAt == null) return true
  return Date.parse(localUpdatedAt) > Date.parse(remoteUpdatedAt) + 1000
}

const conflictBackupPath = (target: string) => {
  const extension = extname(target)
  const base = extension === '' ? target : target.slice(0, -extension.length)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/u, 'Z')
  return `${base}.relay-conflict-${stamp}${extension || '.md'}`
}

const importRootAgentsToAccountDocuments = async (accountId: string): Promise<ApplyRemoteDocumentsResult> => {
  const homeDir = resolveUserHomeDir()
  const source = resolve(homeDir, 'AGENTS.md')
  const content = await readFile(source, 'utf8').catch(() => undefined)
  if (content == null) {
    throw new Error('未找到 ~/AGENTS.md，无法同步当前账号规则。')
  }

  const target = resolve(homeDir, agentsPayloadPath({ id: accountId, type: 'account' }))
  const existing = await readFile(target, 'utf8').catch(() => undefined)
  let conflictBackups = 0
  if (existing != null && existing !== content) {
    await writeFile(conflictBackupPath(target), existing, {
      encoding: 'utf8',
      mode: 0o600
    })
    conflictBackups = 1
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, {
    encoding: 'utf8',
    mode: 0o600
  })
  return { conflictBackups }
}

const resolveEncryptionIdentity = async (params: {
  remote?: RelayPersonalConfigSnapshotPayload
  server: ResolvedRelayServer
  storedServer: RelayStoredServer | undefined
}) => {
  const remoteUserId = toString(params.remote?.userId)
  if (remoteUserId !== '') return remoteUserId
  const storedUserId = toString(params.storedServer?.account?.id)
  if (storedUserId !== '') return storedUserId

  const authStore = await readOneWorksAuthStore().catch(() => undefined)
  const serverUrl = normalizeRemoteBaseUrl(params.server.remoteBaseUrl)
  const account = authStore?.accounts.find(item =>
    item.serverId === params.server.id ||
    normalizeRemoteBaseUrl(item.serverUrl) === serverUrl
  )
  return toString(account?.userId) || undefined
}

const deriveEncryptionKey = (params: {
  identity: string
  server: ResolvedRelayServer
}) => (
  createHash('sha256')
    .update('oneworks-relay-personal-documents-v1')
    .update('\0')
    .update(normalizeRemoteBaseUrl(params.server.remoteBaseUrl))
    .update('\0')
    .update(params.identity)
    .digest()
)

const deriveTeamEncryptionKey = (params: {
  server: ResolvedRelayServer
  teamId: string
}) => (
  createHash('sha256')
    .update('oneworks-relay-team-documents-v1')
    .update('\0')
    .update(normalizeRemoteBaseUrl(params.server.remoteBaseUrl))
    .update('\0')
    .update(params.teamId)
    .digest()
)

const encryptDocumentPayload = (
  payload: RelayPersonalDocumentPayload,
  key: Buffer
): RelayPersonalDocumentEncryptedPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ])
  return {
    algorithm: 'aes-256-gcm',
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1
  }
}

const decryptDocumentPayload = (
  snapshot: RelayPersonalDocumentSnapshotPayload,
  key: Buffer
): RelayPersonalDocumentPayload => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(snapshot.encryptedPayload.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(snapshot.encryptedPayload.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(snapshot.encryptedPayload.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
  const parsed = JSON.parse(plaintext)
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.documents)) {
    throw new Error('Relay personal document payload is invalid.')
  }
  const documents = parsed.documents
    .filter(isRecord)
    .map((document): RelayPersonalDocumentFile | undefined => {
      const kind = toString(document.kind)
      const path = toString(document.path)
      const content = typeof document.content === 'string' ? document.content : undefined
      if (
        !PERSONAL_DOCUMENT_KINDS.includes(kind as RelayPersonalDocumentKind) ||
        path === '' ||
        content == null ||
        isLocalOnlyMarkdownPath(path)
      ) {
        return undefined
      }
      return {
        content,
        hash: hashText(content),
        kind: kind as RelayPersonalDocumentKind,
        mtimeMs: normalizeNumber(document.mtimeMs) ?? 0,
        path,
        sizeBytes: normalizeNumber(document.sizeBytes) ?? Buffer.byteLength(content, 'utf8')
      }
    })
    .filter((document): document is RelayPersonalDocumentFile => document != null)
  return {
    documents: documents.sort((left, right) => left.path.localeCompare(right.path)),
    version: 1
  }
}

const kindMatchesPath = (kind: RelayPersonalDocumentKind, path: string, scope: RelayDocumentScope) => (
  scope.type === 'team'
    ? kind === 'agents' &&
      (
        path === agentsPayloadPath(scope) ||
        (path.startsWith(`${rulesPayloadRoot(scope)}/`) && extname(path).toLowerCase() === '.md')
      )
    : (
      (kind === 'agents' && path === agentsPayloadPath(scope)) ||
      (kind === 'ooAgents' && path === ooAgentsPayloadPath(scope)) ||
      (kind === 'ooRules' && path.startsWith(`${rulesPayloadRoot(scope)}/`) && extname(path).toLowerCase() === '.md')
    )
)

const resolveSafePayloadPath = (
  homeDir: string,
  document: RelayPersonalDocumentFile,
  scope: RelayDocumentScope
) => {
  if (
    document.path.includes('*') ||
    !kindMatchesPath(document.kind, document.path, scope) ||
    isLocalOnlyMarkdownPath(document.path)
  ) return undefined
  const target = resolve(homeDir, document.path)
  return target === homeDir || target.startsWith(`${homeDir}${sep}`) ? target : undefined
}

const applyRemoteDocuments = async (
  payload: RelayPersonalDocumentPayload,
  preferences: RelayPersonalDocumentSyncPreferences,
  scope: RelayDocumentScope
): Promise<ApplyRemoteDocumentsResult> => {
  const homeDir = resolveUserHomeDir()
  let conflictBackups = 0
  for (const document of filterDocumentsByPreferences(payload.documents, preferences)) {
    const target = resolveSafePayloadPath(homeDir, document, scope)
    if (target == null) continue
    const existing = await readFile(target, 'utf8').catch(() => undefined)
    if (existing != null && existing !== document.content) {
      await writeFile(conflictBackupPath(target), existing, {
        encoding: 'utf8',
        mode: 0o600
      })
      conflictBackups += 1
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, document.content, {
      encoding: 'utf8',
      mode: 0o600
    })
  }
  return { conflictBackups }
}

const mergeRemoteWithLocalEnabledDocuments = (
  remote: RelayPersonalDocumentPayload | undefined,
  local: RelayPersonalDocumentPayload,
  preferences: RelayPersonalDocumentSyncPreferences
): RelayPersonalDocumentPayload => {
  const enabledKinds = enabledKindSet(preferences)
  return {
    documents: [
      ...(remote?.documents ?? []).filter(document => !enabledKinds.has(document.kind)),
      ...local.documents
    ].sort((left, right) => left.path.localeCompare(right.path)),
    version: 1
  }
}

const buildDocumentSnapshot = (
  payload: RelayPersonalDocumentPayload,
  key: Buffer
): RelayPersonalDocumentSnapshotPayload => {
  const countsByKind = countDocuments(payload.documents)
  return {
    countsByKind,
    documentCount: payload.documents.length,
    encryptedPayload: encryptDocumentPayload(payload, key),
    totalSizeBytes: totalSizeBytes(payload.documents),
    version: 1
  }
}

const putRemoteDocumentSnapshot = async (params: {
  baseHash?: string
  deviceToken: string
  key: Buffer
  payload: RelayPersonalDocumentPayload
  server: ResolvedRelayServer
}): Promise<RelayPersonalConfigSnapshotPayload | undefined> => {
  const response = await fetch(new URL('/api/relay/config/global', params.server.remoteBaseUrl), {
    body: JSON.stringify({
      ...(params.baseHash == null ? {} : { baseHash: params.baseHash }),
      documents: buildDocumentSnapshot(params.payload, params.key)
    }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`,
      'content-type': 'application/json'
    },
    method: 'PUT'
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay personal document update failed with ${response.status}.`)
  }
  return readPersonalConfigPayload(body)
}

const readRemotePersonalConfigSnapshot = async (params: {
  deviceToken: string
  server: ResolvedRelayServer
}): Promise<RelayPersonalConfigSnapshotPayload | undefined> => {
  const response = await fetch(new URL('/api/relay/config/global', params.server.remoteBaseUrl), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${params.deviceToken}`
    }
  })
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay personal document sync failed with ${response.status}.`)
  }
  return readPersonalConfigPayload(body)
}

const putRemoteTeamDocumentSnapshot = async (params: {
  baseHash?: string
  key: Buffer
  payload: RelayPersonalDocumentPayload
  server: ResolvedRelayServer
  sessionToken: string
  teamId: string
}): Promise<RelayTeamDocumentSnapshotPayload | undefined> => {
  const response = await fetch(
    new URL(`/api/relay/teams/${encodeURIComponent(params.teamId)}/documents`, params.server.remoteBaseUrl),
    {
      body: JSON.stringify({
        ...(params.baseHash == null ? {} : { baseHash: params.baseHash }),
        documents: buildDocumentSnapshot(params.payload, params.key)
      }),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${params.sessionToken}`,
        'content-type': 'application/json'
      },
      method: 'PUT'
    }
  )
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay team document update failed with ${response.status}.`)
  }
  return readTeamDocumentSnapshotPayload(body)
}

const readRemoteTeamDocumentSnapshot = async (params: {
  server: ResolvedRelayServer
  sessionToken: string
  teamId: string
}): Promise<RelayTeamDocumentSnapshotPayload | undefined> => {
  const response = await fetch(
    new URL(`/api/relay/teams/${encodeURIComponent(params.teamId)}/documents`, params.server.remoteBaseUrl),
    {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${params.sessionToken}`
      }
    }
  )
  const body = await readResponseJson(response)
  if (!response.ok) {
    throw new Error(toString(body.error) || `Relay team document sync failed with ${response.status}.`)
  }
  return readTeamDocumentSnapshotPayload(body)
}

export const createPersonalDocumentSyncStatus = (
  preferences: RelayPersonalDocumentSyncPreferences,
  input: Partial<Omit<RelayPersonalDocumentSyncStatus, 'countsByKind' | 'enabled' | 'preferences'>> & {
    countsByKind?: RelayPersonalDocumentSyncCounts
  } = {}
): RelayPersonalDocumentSyncStatus => ({
  appliedRemote: input.appliedRemote ?? false,
  conflictBackups: input.conflictBackups ?? 0,
  countsByKind: input.countsByKind ?? emptyCounts(),
  documentCount: input.documentCount ?? 0,
  enabled: relayPersonalDocumentSyncEnabled(preferences),
  entries: input.entries,
  hash: input.hash ?? null,
  lastError: input.lastError ?? null,
  lastSyncedAt: input.lastSyncedAt ?? null,
  preferences,
  pushedLocal: input.pushedLocal ?? false,
  totalSizeBytes: input.totalSizeBytes ?? 0
})

export const syncRelayPersonalDocuments = async (params: {
  accountId?: string
  deviceToken: string
  importRootAgents?: boolean
  server: ResolvedRelayServer
  storedServer: RelayStoredServer | undefined
}): Promise<RelayPersonalDocumentSyncStatus> => {
  const preferences = params.importRootAgents === true
    ? { ...readRelayPersonalDocumentSyncPreferences(params.storedServer), agents: true }
    : readRelayPersonalDocumentSyncPreferences(params.storedServer)
  if (!relayPersonalDocumentSyncEnabled(preferences)) {
    return createPersonalDocumentSyncStatus(preferences)
  }
  const requestedAccountId = params.accountId?.trim()
  const earlyImportResult = params.importRootAgents === true && requestedAccountId != null && requestedAccountId !== ''
    ? await importRootAgentsToAccountDocuments(requestedAccountId)
    : { conflictBackups: 0 }
  if (params.deviceToken === '') {
    throw new Error('No relay device token is available for personal document sync.')
  }

  const remote = await readRemotePersonalConfigSnapshot({
    deviceToken: params.deviceToken,
    server: params.server
  })
  const identity = await resolveEncryptionIdentity({
    remote,
    server: params.server,
    storedServer: params.storedServer
  })
  if (identity == null) {
    throw new Error('Relay account identity is required for personal document sync.')
  }
  const accountId = requestedAccountId || identity
  const importResult = params.importRootAgents === true && earlyImportResult.conflictBackups === 0 &&
      requestedAccountId !== accountId
    ? await importRootAgentsToAccountDocuments(accountId)
    : earlyImportResult
  const scope: RelayDocumentScope = { id: accountId, type: 'account' }
  const key = deriveEncryptionKey({ identity, server: params.server })
  const remotePayload = remote?.documents == null
    ? undefined
    : decryptDocumentPayload(remote.documents, key)
  const remoteEnabledPayload = remotePayload == null
    ? undefined
    : {
      documents: filterDocumentsByPreferences(remotePayload.documents, preferences),
      version: 1 as const
    }
  const localPayload = await collectLocalDocuments(preferences, scope)
  const localHash = hashDocumentPayload(localPayload)
  const remoteHash = remoteEnabledPayload == null ? undefined : hashDocumentPayload(remoteEnabledPayload)
  const lastSyncedAt = new Date().toISOString()

  if (localPayload.documents.length === 0 && (remoteEnabledPayload?.documents.length ?? 0) === 0) {
    return createPersonalDocumentSyncStatus(preferences, {
      countsByKind: countDocuments(remotePayload?.documents ?? []),
      documentCount: remotePayload?.documents.length ?? 0,
      hash: remote?.documents?.hash ?? null,
      lastSyncedAt,
      conflictBackups: importResult.conflictBackups,
      totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? [])
    })
  }

  if (localHash === remoteHash) {
    return createPersonalDocumentSyncStatus(preferences, {
      countsByKind: countDocuments(remotePayload?.documents ?? localPayload.documents),
      documentCount: remotePayload?.documents.length ?? localPayload.documents.length,
      hash: remote?.documents?.hash ?? localHash,
      lastSyncedAt,
      conflictBackups: importResult.conflictBackups,
      totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? localPayload.documents)
    })
  }

  if (
    remoteEnabledPayload == null || (
      localPayload.documents.length > 0 &&
      localPayloadIsNewer(localPayloadUpdatedAt(localPayload), remote?.documents?.updatedAt)
    )
  ) {
    const mergedPayload = mergeRemoteWithLocalEnabledDocuments(remotePayload, localPayload, preferences)
    const updated = await putRemoteDocumentSnapshot({
      baseHash: remote?.hash,
      deviceToken: params.deviceToken,
      key,
      payload: mergedPayload,
      server: params.server
    })
    const documents = updated?.documents
    return createPersonalDocumentSyncStatus(preferences, {
      countsByKind: documents?.countsByKind ?? countDocuments(mergedPayload.documents),
      documentCount: documents?.documentCount ?? mergedPayload.documents.length,
      hash: documents?.hash ?? hashDocumentPayload(mergedPayload),
      lastSyncedAt: updated?.updatedAt ?? lastSyncedAt,
      conflictBackups: importResult.conflictBackups,
      pushedLocal: true,
      totalSizeBytes: documents?.totalSizeBytes ?? totalSizeBytes(mergedPayload.documents)
    })
  }

  const applied = remotePayload == null
    ? { conflictBackups: 0 }
    : await applyRemoteDocuments(remotePayload, preferences, scope)
  return createPersonalDocumentSyncStatus(preferences, {
    appliedRemote: remotePayload != null,
    conflictBackups: importResult.conflictBackups + applied.conflictBackups,
    countsByKind: countDocuments(remotePayload?.documents ?? []),
    documentCount: remotePayload?.documents.length ?? 0,
    hash: remote?.documents?.hash ?? remoteHash ?? null,
    lastSyncedAt,
    totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? [])
  })
}

export const syncRelayTeamDocuments = async (params: {
  preferences: RelayPersonalDocumentSyncPreferences
  server: ResolvedRelayServer
  sessionToken: string
  teamId: string
}): Promise<RelayPersonalDocumentSyncStatus> => {
  if (!relayPersonalDocumentSyncEnabled(params.preferences)) {
    return createPersonalDocumentSyncStatus(params.preferences)
  }
  if (params.sessionToken === '') {
    throw new Error('A Relay login session is required for team document sync.')
  }

  const remote = await readRemoteTeamDocumentSnapshot({
    server: params.server,
    sessionToken: params.sessionToken,
    teamId: params.teamId
  })
  const key = deriveTeamEncryptionKey({
    server: params.server,
    teamId: params.teamId
  })
  const scope: RelayDocumentScope = { id: params.teamId, type: 'team' }
  const remotePayload = remote == null ? undefined : decryptDocumentPayload(remote, key)
  const remoteEnabledPayload = remotePayload == null
    ? undefined
    : {
      documents: filterDocumentsByPreferences(remotePayload.documents, params.preferences),
      version: 1 as const
    }
  const localPayload = await collectLocalDocuments(params.preferences, scope)
  const localHash = hashDocumentPayload(localPayload)
  const remoteHash = remoteEnabledPayload == null ? undefined : hashDocumentPayload(remoteEnabledPayload)
  const lastSyncedAt = new Date().toISOString()

  if (localPayload.documents.length === 0 && (remoteEnabledPayload?.documents.length ?? 0) === 0) {
    return createPersonalDocumentSyncStatus(params.preferences, {
      countsByKind: countDocuments(remotePayload?.documents ?? []),
      documentCount: remotePayload?.documents.length ?? 0,
      hash: remote?.hash ?? null,
      lastSyncedAt,
      totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? [])
    })
  }

  if (localHash === remoteHash) {
    return createPersonalDocumentSyncStatus(params.preferences, {
      countsByKind: countDocuments(remotePayload?.documents ?? localPayload.documents),
      documentCount: remotePayload?.documents.length ?? localPayload.documents.length,
      hash: remote?.hash ?? localHash,
      lastSyncedAt,
      totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? localPayload.documents)
    })
  }

  if (
    remoteEnabledPayload == null || (
      localPayload.documents.length > 0 &&
      localPayloadIsNewer(localPayloadUpdatedAt(localPayload), remote?.updatedAt)
    )
  ) {
    const mergedPayload = mergeRemoteWithLocalEnabledDocuments(remotePayload, localPayload, params.preferences)
    const updated = await putRemoteTeamDocumentSnapshot({
      baseHash: remote?.hash,
      key,
      payload: mergedPayload,
      server: params.server,
      sessionToken: params.sessionToken,
      teamId: params.teamId
    })
    return createPersonalDocumentSyncStatus(params.preferences, {
      countsByKind: updated?.countsByKind ?? countDocuments(mergedPayload.documents),
      documentCount: updated?.documentCount ?? mergedPayload.documents.length,
      hash: updated?.hash ?? hashDocumentPayload(mergedPayload),
      lastSyncedAt: updated?.updatedAt ?? lastSyncedAt,
      pushedLocal: true,
      totalSizeBytes: updated?.totalSizeBytes ?? totalSizeBytes(mergedPayload.documents)
    })
  }

  const applied = remotePayload == null
    ? { conflictBackups: 0 }
    : await applyRemoteDocuments(remotePayload, params.preferences, scope)
  return createPersonalDocumentSyncStatus(params.preferences, {
    appliedRemote: remotePayload != null,
    conflictBackups: applied.conflictBackups,
    countsByKind: countDocuments(remotePayload?.documents ?? []),
    documentCount: remotePayload?.documents.length ?? 0,
    hash: remote?.hash ?? remoteHash ?? null,
    lastSyncedAt,
    totalSizeBytes: totalSizeBytes(remotePayload?.documents ?? [])
  })
}
