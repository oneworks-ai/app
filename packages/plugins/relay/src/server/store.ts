import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { RelayStore, RelayStoredServer } from './types.js'
import { isRecord, normalizeRemoteBaseUrl, parseJson, toString } from './utils.js'

const STORE_PATH = ['.local', 'plugins', 'relay', 'device.json']

const createSecret = () => randomBytes(32).toString('base64url')

const normalizeStoredAccount = (value: unknown): RelayStoredServer['account'] => {
  if (!isRecord(value)) return undefined
  const id = toString(value.id)
  const email = toString(value.email)
  const name = toString(value.name)
  const avatarUrl = toString(value.avatarUrl)
  const provider = toString(value.provider)
  const role = toString(value.role)
  if ([id, email, name, avatarUrl, provider, role].every(item => item === '')) return undefined
  return {
    ...(avatarUrl === '' ? {} : { avatarUrl }),
    ...(email === '' ? {} : { email }),
    ...(id === '' ? {} : { id }),
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
    servers[id] = {
      ...(account == null ? {} : { account }),
      deviceToken,
      id,
      registeredAt: typeof raw.registeredAt === 'string' ? raw.registeredAt : undefined,
      remoteBaseUrl,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
    }
  }
  return servers
}

export const createRelayDeviceStore = (projectHome: string) => {
  const storePath = join(projectHome, ...STORE_PATH)

  const writeStore = async (store: RelayStore) => {
    await mkdir(join(projectHome, '.local', 'plugins', 'relay'), { recursive: true })
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
    const content = await readFile(storePath, 'utf8').catch(() => {
      needsWrite = true
      return '{}'
    })
    const parsed = parseJson(content)
    const store = {
      deviceId: toString(parsed.deviceId) || randomUUID(),
      deviceSecret: toString(parsed.deviceSecret) || createSecret(),
      deviceName: toString(parsed.deviceName),
      servers: normalizeStoredServers(parsed.servers)
    }
    if (toString(parsed.deviceId) === '' || toString(parsed.deviceSecret) === '') {
      needsWrite = true
    }
    if (needsWrite) {
      await writeStore(store)
    }
    return store
  }

  return {
    readStore,
    storePath,
    writeStore
  }
}
