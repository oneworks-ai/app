import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

const seedUser = async (dataPath: string) => {
  const store = await readRelayStore(dataPath)
  store.users.push({
    createdAt: timestamp,
    email: 'owner@example.test',
    id: 'owner',
    name: 'Owner',
    role: 'owner',
    teamIds: []
  })
  store.sessions.push({
    createdAt: timestamp,
    expiresAt: future,
    lastSeenAt: timestamp,
    token: 'owner-session',
    userId: 'owner'
  })
  store.devices.push({
    capabilities: {},
    createdAt: timestamp,
    deviceToken: 'owner-device-token',
    id: 'owner-device',
    lastSeenAt: timestamp,
    name: 'Owner Device',
    userId: 'owner',
    workspaceFolder: '/workspace'
  })
  await writeRelayStore(dataPath, store)
}

describe('relay personal global config route', () => {
  it('stores safe single-user global config for the authenticated user', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const token = Buffer.from(JSON.stringify({ refresh_token: 'codex-refresh-token' })).toString('base64')
    const update = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                default: {
                  auth: {
                    encoding: 'base64',
                    token,
                    type: 'codex-auth-json'
                  },
                  email: 'owner@example.test'
                }
              }
            }
          },
          env: {
            SECRET: 'do-not-sync'
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    const pulled = await requestJson(baseUrl, '/api/relay/config/global', {
      headers: authHeaders('owner-session')
    })
    const serialized = JSON.stringify(pulled.body)

    expect(update.response.status).toBe(200)
    expect(pulled.response.status).toBe(200)
    expect(pulled.body.personalConfigSnapshot).toMatchObject({
      allowedFields: ['adapters'],
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              default: {
                auth: {
                  encoding: 'base64',
                  token,
                  type: 'codex-auth-json'
                },
                email: 'owner@example.test'
              }
            }
          }
        }
      },
      hash: expect.stringMatching(/^sha256:/),
      sourceDeviceId: 'owner-device',
      userId: 'owner'
    })
    expect(serialized).not.toContain('do-not-sync')
  })

  it('rejects stale writes unless the client opts into forcing a newer version', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const first = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                default: {
                  email: 'first@example.test'
                }
              }
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    const conflict = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        baseHash: 'sha256:stale',
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                default: {
                  email: 'second@example.test'
                }
              }
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(first.response.status).toBe(200)
    expect(conflict.response.status).toBe(409)
    expect(conflict.body.personalConfigSnapshot).toMatchObject({
      hash: (first.body.personalConfigSnapshot as { hash?: string }).hash
    })
  })

  it('replaces the canonical personal config snapshot for the same user', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const first = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                first: {
                  email: 'first@example.test'
                }
              },
              defaultAccount: 'first'
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    const firstHash = (first.body.personalConfigSnapshot as { hash?: string }).hash

    const second = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        baseHash: firstHash,
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                second: {
                  email: 'second@example.test'
                }
              },
              defaultAccount: 'second'
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(second.response.status).toBe(200)
    expect(second.body.personalConfigSnapshot).toMatchObject({
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              second: {
                email: 'second@example.test'
              }
            },
            defaultAccount: 'second'
          }
        }
      }
    })
    expect(JSON.stringify(second.body)).not.toContain('first@example.test')
  })

  it('stores encrypted instruction documents without plaintext contents', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const update = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        documents: {
          countsByKind: {
            agents: 1,
            ooAgents: 0,
            ooRules: 0
          },
          documentCount: 1,
          encryptedPayload: {
            algorithm: 'aes-256-gcm',
            ciphertext: Buffer.from('encrypted only').toString('base64'),
            iv: Buffer.from('123456789012').toString('base64'),
            tag: Buffer.from('1234567890123456').toString('base64'),
            version: 1
          },
          plaintext: 'AGENTS secret content',
          totalSizeBytes: 128,
          version: 1
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    const pulled = await requestJson(baseUrl, '/api/relay/config/global', {
      headers: authHeaders('owner-session')
    })
    const serialized = JSON.stringify(pulled.body)

    expect(update.response.status).toBe(200)
    expect(pulled.response.status).toBe(200)
    expect(pulled.body.personalConfigSnapshot).toMatchObject({
      documents: {
        countsByKind: {
          agents: 1,
          ooAgents: 0,
          ooRules: 0
        },
        documentCount: 1,
        encryptedPayload: {
          algorithm: 'aes-256-gcm',
          ciphertext: Buffer.from('encrypted only').toString('base64'),
          version: 1
        },
        hash: expect.stringMatching(/^sha256:/),
        totalSizeBytes: 128,
        version: 1
      },
      hash: expect.stringMatching(/^sha256:/),
      sourceDeviceId: 'owner-device',
      userId: 'owner'
    })
    expect(serialized).not.toContain('AGENTS secret content')
  })

  it('keeps existing config patch when encrypted instruction documents are updated', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const first = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                default: {
                  email: 'owner@example.test'
                }
              }
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    const firstHash = (first.body.personalConfigSnapshot as { hash?: string }).hash

    const second = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        baseHash: firstHash,
        documents: {
          countsByKind: {
            agents: 1,
            ooAgents: 0,
            ooRules: 0
          },
          documentCount: 1,
          encryptedPayload: {
            algorithm: 'aes-256-gcm',
            ciphertext: Buffer.from('encrypted rules').toString('base64'),
            iv: Buffer.from('abcdefghijkl').toString('base64'),
            tag: Buffer.from('abcdefghijklmnop').toString('base64'),
            version: 1
          },
          totalSizeBytes: 64,
          version: 1
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)
    expect(second.body.personalConfigSnapshot).toMatchObject({
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              default: {
                email: 'owner@example.test'
              }
            }
          }
        }
      },
      documents: {
        documentCount: 1,
        totalSizeBytes: 64
      }
    })
  })
})
