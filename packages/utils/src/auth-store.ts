import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { resolveGlobalOneWorksDir } from '@oneworks/utils/ai-path'

export const ONEWORKS_AUTH_STORE_VERSION = 1

export interface OneWorksAuthServer {
  id: string
  name?: string
  official?: boolean
  platform?: string
  url: string
}

export interface OneWorksAuthAccount {
  accountKey: string
  avatarUrl?: string
  deviceId?: string
  deviceToken?: string
  email?: string
  enabled: boolean
  loginId?: string
  name?: string
  registeredAt?: string
  role?: string
  serverId: string
  serverUrl: string
  sessionExpiresAt?: string
  sessionToken?: string
  updatedAt?: string
  userId: string
}

export interface OneWorksAuthStore {
  accounts: OneWorksAuthAccount[]
  servers: Record<string, OneWorksAuthServer>
  version: typeof ONEWORKS_AUTH_STORE_VERSION
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const toText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const optionalText = (value: unknown) => {
  const text = toText(value)
  return text === '' ? undefined : text
}

const normalizeServer = (value: unknown, fallbackId: string): OneWorksAuthServer | undefined => {
  if (!isRecord(value)) return undefined
  const id = toText(value.id) || fallbackId
  const url = toText(value.url)
  if (id === '' || url === '') return undefined
  return {
    id,
    url,
    ...(optionalText(value.name) == null ? {} : { name: optionalText(value.name) }),
    ...(value.official === true ? { official: true } : {}),
    ...(optionalText(value.platform) == null ? {} : { platform: optionalText(value.platform) })
  }
}

const normalizeAccount = (value: unknown): OneWorksAuthAccount | undefined => {
  if (!isRecord(value)) return undefined
  const serverId = toText(value.serverId)
  const serverUrl = toText(value.serverUrl)
  const userId = toText(value.userId)
  if (serverId === '' || serverUrl === '' || userId === '') return undefined
  const accountKey = toText(value.accountKey) || createAccountKey(serverId, userId)
  return {
    accountKey,
    enabled: value.enabled === true,
    serverId,
    serverUrl,
    userId,
    ...(optionalText(value.avatarUrl) == null ? {} : { avatarUrl: optionalText(value.avatarUrl) }),
    ...(optionalText(value.deviceId) == null ? {} : { deviceId: optionalText(value.deviceId) }),
    ...(optionalText(value.deviceToken) == null ? {} : { deviceToken: optionalText(value.deviceToken) }),
    ...(optionalText(value.email) == null ? {} : { email: optionalText(value.email) }),
    ...(optionalText(value.loginId) == null ? {} : { loginId: optionalText(value.loginId) }),
    ...(optionalText(value.name) == null ? {} : { name: optionalText(value.name) }),
    ...(optionalText(value.registeredAt) == null ? {} : { registeredAt: optionalText(value.registeredAt) }),
    ...(optionalText(value.role) == null ? {} : { role: optionalText(value.role) }),
    ...(optionalText(value.sessionExpiresAt) == null ? {} : { sessionExpiresAt: optionalText(value.sessionExpiresAt) }),
    ...(optionalText(value.sessionToken) == null ? {} : { sessionToken: optionalText(value.sessionToken) }),
    ...(optionalText(value.updatedAt) == null ? {} : { updatedAt: optionalText(value.updatedAt) })
  }
}

export const resolveOneWorksAuthStorePath = (env: Record<string, string | null | undefined> = process.env) =>
  join(resolveGlobalOneWorksDir(env), 'auth.json')

export const createAccountKey = (serverId: string, userId: string) => `${serverId}:${userId}`

export const createAuthDeviceId = (serverId: string, userId: string) => (
  `ow-${randomBytes(8).toString('hex')}-${Buffer.from(`${serverId}:${userId}`).toString('base64url').slice(0, 16)}`
)

export const emptyOneWorksAuthStore = (): OneWorksAuthStore => ({
  accounts: [],
  servers: {},
  version: ONEWORKS_AUTH_STORE_VERSION
})

export const normalizeOneWorksAuthStore = (value: unknown): OneWorksAuthStore => {
  if (!isRecord(value)) return emptyOneWorksAuthStore()
  const rawServers = isRecord(value.servers) ? value.servers : {}
  const servers = Object.fromEntries(
    Object.entries(rawServers)
      .map(([id, server]) => normalizeServer(server, id))
      .filter((server): server is OneWorksAuthServer => server != null)
      .map(server => [server.id, server])
  )
  const accounts = Array.isArray(value.accounts)
    ? value.accounts.map(normalizeAccount).filter((account): account is OneWorksAuthAccount => account != null)
    : []
  return {
    accounts,
    servers,
    version: ONEWORKS_AUTH_STORE_VERSION
  }
}

export const readOneWorksAuthStore = async (
  env: Record<string, string | null | undefined> = process.env
): Promise<OneWorksAuthStore> => {
  const raw = await readFile(resolveOneWorksAuthStorePath(env), 'utf8').catch(() => '')
  if (raw.trim() === '') return emptyOneWorksAuthStore()
  try {
    return normalizeOneWorksAuthStore(JSON.parse(raw) as unknown)
  } catch {
    return emptyOneWorksAuthStore()
  }
}

export const writeOneWorksAuthStore = async (
  store: OneWorksAuthStore,
  env: Record<string, string | null | undefined> = process.env
) => {
  const authPath = resolveOneWorksAuthStorePath(env)
  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 })
  const tempPath = `${authPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(normalizeOneWorksAuthStore(store), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(tempPath, authPath)
}

export const upsertOneWorksAuthServer = (
  store: OneWorksAuthStore,
  server: OneWorksAuthServer
): OneWorksAuthStore => ({
  ...store,
  servers: {
    ...store.servers,
    [server.id]: server
  }
})

export const upsertOneWorksAuthAccount = (
  store: OneWorksAuthStore,
  account: OneWorksAuthAccount
): OneWorksAuthStore => {
  const accounts = store.accounts.filter(item => item.accountKey !== account.accountKey)
  accounts.push(account)
  accounts.sort((left, right) => left.accountKey.localeCompare(right.accountKey))
  return {
    ...store,
    accounts
  }
}
