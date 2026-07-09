import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAccountKey,
  emptyOneWorksAuthStore,
  readOneWorksAuthStore,
  resolveOneWorksAuthStorePath,
  upsertOneWorksAuthAccount,
  upsertOneWorksAuthServer,
  writeOneWorksAuthStore
} from '../src/auth-store'

const tempDirs: string[] = []

const createTempHome = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-auth-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('oneWorks auth store', () => {
  it('stores auth state in the global auth.json file with private permissions', async () => {
    const home = await createTempHome()
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: home }
    const accountKey = createAccountKey('oneworks-cloudflare', 'user-1')
    const store = upsertOneWorksAuthAccount(
      upsertOneWorksAuthServer(emptyOneWorksAuthStore(), {
        id: 'oneworks-cloudflare',
        name: 'OneWorks Cloudflare',
        official: true,
        platform: 'cloudflare',
        url: 'https://relay.oneworks.cloud'
      }),
      {
        accountKey,
        enabled: true,
        loginId: 'alice',
        serverId: 'oneworks-cloudflare',
        serverUrl: 'https://relay.oneworks.cloud',
        sessionToken: 'session-token',
        userId: 'user-1'
      }
    )

    await writeOneWorksAuthStore(store, env)

    const authPath = resolveOneWorksAuthStorePath(env)
    expect(authPath).toBe(path.join(home, '.oneworks', 'auth.json'))
    expect((await stat(authPath)).mode & 0o777).toBe(0o600)
    await expect(readOneWorksAuthStore(env)).resolves.toEqual(store)
  })

  it('normalizes legacy account records and upserts by account key', async () => {
    const home = await createTempHome()
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: home }
    const authPath = resolveOneWorksAuthStorePath(env)
    await mkdir(path.dirname(authPath), { recursive: true })
    await writeFile(
      authPath,
      JSON.stringify({
        accounts: [
          {
            email: 'alice@example.com',
            enabled: true,
            serverId: 'oneworks-cloudflare',
            serverUrl: 'https://relay.oneworks.cloud',
            userId: 'user-1'
          }
        ],
        servers: {
          'oneworks-cloudflare': {
            id: 'oneworks-cloudflare',
            url: 'https://relay.oneworks.cloud'
          }
        }
      })
    )

    const normalized = await readOneWorksAuthStore(env)
    expect(normalized.accounts[0]?.accountKey).toBe('oneworks-cloudflare:user-1')

    const updated = upsertOneWorksAuthAccount(normalized, {
      ...normalized.accounts[0]!,
      enabled: false,
      loginId: 'alice'
    })
    expect(updated.accounts).toHaveLength(1)
    expect(updated.accounts[0]).toEqual(expect.objectContaining({
      accountKey: 'oneworks-cloudflare:user-1',
      enabled: false,
      loginId: 'alice'
    }))
    await writeOneWorksAuthStore(updated, env)
    await expect(readOneWorksAuthStore(env)).resolves.toEqual(updated)
  })

  it('serializes concurrent writes to the same auth file', async () => {
    const home = await createTempHome()
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: home }
    vi.spyOn(Date, 'now').mockReturnValue(123456)

    const buildStore = (userId: string) => upsertOneWorksAuthAccount(
      upsertOneWorksAuthServer(emptyOneWorksAuthStore(), {
        id: 'local',
        url: 'http://127.0.0.1:8791'
      }),
      {
        accountKey: createAccountKey('local', userId),
        enabled: true,
        serverId: 'local',
        serverUrl: 'http://127.0.0.1:8791',
        userId
      }
    )

    await expect(Promise.all([
      writeOneWorksAuthStore(buildStore('user-1'), env),
      writeOneWorksAuthStore(buildStore('user-2'), env),
      writeOneWorksAuthStore(buildStore('user-3'), env)
    ])).resolves.toBeDefined()

    const store = await readOneWorksAuthStore(env)
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0]?.userId).toBe('user-3')
  })
})
