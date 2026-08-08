import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncRelayPersonalGlobalConfig } from '../src/server/config-sync.js'
import type { ResolvedRelayServer } from '../src/server/options.js'

const tempDirs: string[] = []
const uuid = '00000000-0000-0000-0000-000000000001'

const createServer = (): ResolvedRelayServer => ({
  id: 'test',
  name: 'Test Relay',
  pairingToken: '',
  pairingTokenConfigured: false,
  protocol: 'https',
  remoteBaseUrl: 'https://relay.example',
  server: 'relay.example'
})

const createHome = async (config: Record<string, unknown>) => {
  const homeDir = await mkdtemp(join(tmpdir(), 'relay-config-sync-'))
  tempDirs.push(homeDir)
  vi.stubEnv('HOME', homeDir)
  vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)
  const configPath = join(homeDir, '.oneworks', '.oo.config.json')
  await mkdir(join(homeDir, '.oneworks'), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { configPath, homeDir }
}

const snapshot = (configPatch: Record<string, unknown>, hash: string) => ({
  personalConfigSnapshot: {
    allowedFields: ['adapters'],
    configPatch,
    hash,
    updatedAt: '2099-01-01T00:00:00.000Z',
    version: 'personal-global-v1'
  }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Relay personal config causal sync', () => {
  it('publishes higher credential revisions and tombstones even when the local clock is slow', async () => {
    const remoteToken = Buffer.from('remote').toString('base64')
    const localToken = Buffer.from('local').toString('base64')
    const remotePatch = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: remoteToken, type: 'codex-auth-json' },
              credentialRevision: `1:${uuid}`,
              generation: 'generation-work'
            },
            removed: { generation: 'generation-removed', title: 'Removed' }
          }
        }
      }
    }
    const localPatch = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: localToken, type: 'codex-auth-json' },
              credentialRevision: `2:${uuid}`,
              generation: 'generation-work'
            }
          },
          accountTombstones: { removed: ['generation-removed'] }
        }
      }
    }
    const { configPath } = await createHome(localPatch)
    await utimes(configPath, new Date('2000-01-01T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'))
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'PUT') {
          return new Response(JSON.stringify(snapshot(remotePatch, 'sha256:remote')), { status: 200 })
        }
        const request = JSON.parse(String(init.body)) as Record<string, unknown>
        requests.push(request)
        return new Response(JSON.stringify(snapshot(request.configPatch as Record<string, unknown>, 'sha256:merged')), {
          status: 200
        })
      })
    )

    const result = await syncRelayPersonalGlobalConfig({
      deviceToken: 'device-token',
      server: createServer()
    })

    expect(result.pushedLocal).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      baseHash: 'sha256:remote',
      configPatch: {
        adapters: {
          codex: {
            accounts: { work: { auth: { token: localToken }, credentialRevision: `2:${uuid}` } },
            accountTombstones: { removed: ['generation-removed'] }
          }
        }
      }
    })
    expect(requests[0]).not.toHaveProperty('configPatch.adapters.codex.accounts.removed')
  })

  it('does not upload an unchanged patch when only the local file timestamp changed', async () => {
    const token = Buffer.from('same').toString('base64')
    const patch = {
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token, type: 'codex-auth-json' } }
          }
        }
      }
    }
    const { configPath } = await createHome(patch)
    await utimes(configPath, new Date(), new Date())
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      new Response(JSON.stringify(snapshot(patch, 'sha256:remote')), {
        status: init?.method === 'PUT' ? 500 : 200
      })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncRelayPersonalGlobalConfig({
      deviceToken: 'device-token',
      server: createServer()
    })

    expect(result.pushedLocal).toBe(false)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0)
  })

  it('keeps the remote credential authoritative for legacy revisions', async () => {
    const remoteToken = Buffer.from('remote-legacy').toString('base64')
    const localToken = Buffer.from('local-legacy').toString('base64')
    const remotePatch = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: remoteToken, type: 'codex-auth-json' }
            }
          }
        }
      }
    }
    const { configPath } = await createHome({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: localToken, type: 'codex-auth-json' }
            }
          }
        }
      }
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify(snapshot(remotePatch, 'sha256:remote')), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await syncRelayPersonalGlobalConfig({ deviceToken: 'device-token', server: createServer() })
    const local = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0)
    expect(local).toHaveProperty('adapters.codex.accounts.work.auth.token', remoteToken)
  })

  it('recomputes once from a third-device canonical conflict and writes the successful canonical response', async () => {
    const token = (value: string) => Buffer.from(value).toString('base64')
    const remotePatch = {
      adapters: {
        codex: {
          accounts: {
            remote: {
              auth: { encoding: 'base64', token: token('remote'), type: 'codex-auth-json' }
            }
          }
        }
      }
    }
    const localPatch = {
      adapters: {
        codex: {
          accounts: {
            local: {
              auth: { encoding: 'base64', token: token('local'), type: 'codex-auth-json' }
            }
          }
        }
      }
    }
    const thirdDevicePatch = {
      adapters: {
        codex: {
          accounts: {
            remote: { auth: { encoding: 'base64', token: token('remote'), type: 'codex-auth-json' } },
            third: { auth: { encoding: 'base64', token: token('third'), type: 'codex-auth-json' } }
          }
        }
      }
    }
    const { configPath } = await createHome(localPatch)
    const putRequests: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'PUT') {
          return new Response(JSON.stringify(snapshot(remotePatch, 'sha256:remote')), { status: 200 })
        }
        const request = JSON.parse(String(init.body)) as Record<string, unknown>
        putRequests.push(request)
        if (putRequests.length === 1) {
          return new Response(JSON.stringify(snapshot(thirdDevicePatch, 'sha256:third')), { status: 409 })
        }
        const requestPatch = request.configPatch as any
        const canonicalPatch = {
          ...requestPatch,
          adapters: {
            ...requestPatch.adapters,
            codex: {
              ...requestPatch.adapters.codex,
              accountTombstones: {
                ...requestPatch.adapters.codex.accountTombstones,
                'server-only': ['generation-server-only']
              }
            }
          }
        }
        return new Response(JSON.stringify(snapshot(canonicalPatch, 'sha256:canonical')), { status: 200 })
      })
    )

    const result = await syncRelayPersonalGlobalConfig({ deviceToken: 'device-token', server: createServer() })
    const local = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>

    expect(result).toMatchObject({ hash: 'sha256:canonical', pushedLocal: true })
    expect(putRequests).toHaveLength(2)
    expect(putRequests[1]).toMatchObject({
      baseHash: 'sha256:third',
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              local: expect.any(Object),
              remote: expect.any(Object),
              third: expect.any(Object)
            }
          }
        }
      }
    })
    expect(local).toHaveProperty(
      'adapters.codex.accountTombstones.server-only',
      ['generation-server-only']
    )
  })

  it('stops after a second personal config conflict', async () => {
    const token = Buffer.from('local').toString('base64')
    const patch = {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token, type: 'codex-auth-json' }
            }
          }
        }
      }
    }
    await createHome(patch)
    let puts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'PUT') {
          return new Response(JSON.stringify({ personalConfigSnapshot: null }), { status: 200 })
        }
        puts += 1
        return new Response(
          JSON.stringify(snapshot({
            adapters: {
              codex: {
                accounts: {
                  [`third-${puts}`]: {
                    auth: {
                      encoding: 'base64',
                      token: Buffer.from(`third-${puts}`).toString('base64'),
                      type: 'codex-auth-json'
                    }
                  }
                }
              }
            }
          }, `sha256:conflict-${puts}`)),
          { status: 409 }
        )
      })
    )

    await expect(syncRelayPersonalGlobalConfig({
      deviceToken: 'device-token',
      server: createServer()
    })).rejects.toThrow(/changed again/i)
    expect(puts).toBe(2)
  })
})
