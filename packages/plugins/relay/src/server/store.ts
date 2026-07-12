import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { resolveGlobalOneWorksPath } from '@oneworks/utils/ai-path'

import {
  normalizeRelayConfigSourcePreferences,
  serializeRelayConfigSourcePreferences
} from './config-source-preferences.js'
import {
  normalizeRelayPersonalDocumentSyncPreferences,
  normalizeRelayTeamDocumentSyncPreferences,
  serializeRelayPersonalDocumentSyncPreferences,
  serializeRelayTeamDocumentSyncPreferences
} from './personal-document-sync-preferences.js'
import type { RelayStore, RelayStoredServer } from './types.js'
import { isRecord, normalizeRemoteBaseUrl, parseJson, toString } from './utils.js'

const LEGACY_STORE_PATH = ['.local', 'plugins', 'relay', 'device.json']
const STORE_PATH = ['relay', 'device.json']
const SERVICE_INFO_STORE_PATH = ['relay', 'service-info-cache.json']
const MANAGEMENT_SERVER_STORE_PATH = ['.local', 'plugins', 'relay', 'management-server.json']

const createSecret = () => randomBytes(32).toString('base64url')

const readJsonFile = async (filePath: string) => {
  const content = await readFile(filePath, 'utf8').catch(() => undefined)
  return content == null
    ? undefined
    : parseJson(content)
}

const normalizeRelayStore = (parsed: Record<string, unknown>): RelayStore => ({
  deviceId: toString(parsed.deviceId) || randomUUID(),
  deviceSecret: toString(parsed.deviceSecret) || createSecret(),
  deviceName: toString(parsed.deviceName),
  servers: normalizeStoredServers(parsed.servers)
})

const normalizeStoredAccount = (value: unknown): RelayStoredServer['account'] => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  const email = toString(value.email)
  const loginId = toString(value.loginId)
  const name = toString(value.name)
  const avatarUrl = toString(value.avatarUrl)
  const provider = toString(value.provider)
  const role = toString(value.role)
  if ([id, email, loginId, name, avatarUrl, provider, role].every(item => item === '')) return undefined
  return {
    ...(avatarUrl === '' ? {} : { avatarUrl }),
    ...(email === '' ? {} : { email }),
    ...(id === '' ? {} : { id }),
    ...(loginId === '' ? {} : { loginId }),
    ...(name === '' ? {} : { name }),
    ...(provider === '' ? {} : { provider }),
    ...(role === '' ? {} : { role })
  }
}

const normalizeStoredServers = (value: unknown): Record<string, RelayStoredServer> => {
  if (!isRecord(value)) return {}
  const servers: Record<string, RelayStoredServer> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const id = toString(raw.id) || key
    const remoteBaseUrl = normalizeRemoteBaseUrl(raw.remoteBaseUrl)
    const deviceToken = toString(raw.deviceToken)
    if (id === '' || remoteBaseUrl === '') continue
    const account = normalizeStoredAccount(raw.account)
    const configDisabledSources = normalizeRelayConfigSourcePreferences(raw.configDisabledSources)
    const personalDocumentSync = normalizeRelayPersonalDocumentSyncPreferences(raw.personalDocumentSync)
    const teamDocumentSync = normalizeRelayTeamDocumentSyncPreferences(raw.teamDocumentSync)
    servers[id] = {
      ...(account == null ? {} : { account }),
      ...(configDisabledSources == null
        ? {}
        : { configDisabledSources: serializeRelayConfigSourcePreferences(configDisabledSources) }),
      ...(personalDocumentSync == null
        ? {}
        : { personalDocumentSync: serializeRelayPersonalDocumentSyncPreferences(personalDocumentSync) }),
      ...(teamDocumentSync == null
        ? {}
        : { teamDocumentSync: serializeRelayTeamDocumentSyncPreferences(teamDocumentSync) }),
      deviceToken,
      id,
      registeredAt: typeof raw.registeredAt === 'string' ? raw.registeredAt : undefined,
      remoteBaseUrl,
      sessionExpiresAt: typeof raw.sessionExpiresAt === 'string' ? raw.sessionExpiresAt : undefined,
      sessionToken: toString(raw.sessionToken) || undefined,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
    }
  }
  return servers
}

export const createRelayDeviceStore = (projectHome: string) => {
  const storePath = resolveGlobalOneWorksPath(process.env, ...STORE_PATH)
  const legacyStorePath = join(projectHome, ...LEGACY_STORE_PATH)

  const writeStore = async (store: RelayStore) => {
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(
      storePath,
      `${JSON.stringify(store, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600
      }
    )
  }

  const readStore = async (): Promise<RelayStore> => {
    let needsWrite = false
    const parsed = await readJsonFile(storePath).catch(() => {
      needsWrite = true
      return undefined
    })

    let source = parsed
    if (source == null) {
      source = await readJsonFile(legacyStorePath)
      needsWrite = true
    }

    const store = normalizeRelayStore(source ?? {})
    if (parsed == null || toString(parsed.deviceId) === '' || toString(parsed.deviceSecret) === '') {
      needsWrite = true
    }
    if (needsWrite) {
      await writeStore(store)
    }
    return store
  }

  return { readStore, storePath, writeStore }
}

export { createRelayManagementServerStore } from './management-server-store.js'
export type { RelayManagementServerStore } from './management-server-store.js'
export { createRelayServiceInfoStore } from './service-info-store.js'
export type { RelayCachedServiceInfo } from './service-info-store.js'
