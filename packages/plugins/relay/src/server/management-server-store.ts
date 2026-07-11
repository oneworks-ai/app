import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { isRecord, parseJson, toString } from './utils.js'

const MANAGEMENT_SERVER_STORE_PATH = ['.local', 'plugins', 'relay', 'management-server.json']

export interface RelayManagementServerStore {
  createdAt?: string
  id: string
  kind?: string
  name?: string
  updatedAt?: string
}

const readJsonFile = async (filePath: string) => {
  const content = await readFile(filePath, 'utf8').catch(() => undefined)
  return content == null ? undefined : parseJson(content)
}

const normalizeManagementServerStore = (value: unknown): RelayManagementServerStore => {
  const parsed = isRecord(value) ? value : {}
  const id = toString(parsed.id) || randomUUID()
  const createdAt = toString(parsed.createdAt)
  const updatedAt = toString(parsed.updatedAt)
  const kind = toString(parsed.kind)
  const name = toString(parsed.name)
  return {
    ...(createdAt === '' ? {} : { createdAt }),
    id,
    ...(kind === '' ? {} : { kind }),
    ...(name === '' ? {} : { name }),
    ...(updatedAt === '' ? {} : { updatedAt })
  }
}

export const createRelayManagementServerStore = (projectHome: string) => {
  const storePath = join(projectHome, ...MANAGEMENT_SERVER_STORE_PATH)
  const writeStore = async (store: RelayManagementServerStore) => {
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  const readStore = async (): Promise<RelayManagementServerStore> => {
    const parsed = await readJsonFile(storePath)
    const store = normalizeManagementServerStore(parsed)
    if (parsed == null || !isRecord(parsed) || toString(parsed.id) === '') {
      const now = new Date().toISOString()
      const next = { ...store, createdAt: store.createdAt ?? now, updatedAt: now }
      await writeStore(next)
      return next
    }
    return store
  }
  return { readStore, storePath, writeStore }
}
