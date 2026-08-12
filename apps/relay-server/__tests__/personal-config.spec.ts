/* eslint-disable max-lines -- personal config route coverage keeps encryption and merge scenarios together. */
import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import { mergeRelayPersonalConfigPatches } from '../src/personal-config.js'
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
  it('merges adapter accounts without replacing a portable credential with a device card', () => {
    const token = Buffer.from('portable').toString('base64')
    expect(mergeRelayPersonalConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token, type: 'codex-auth-json' } }
          }
        }
      }
    }, {
      adapters: {
        'claude-code': {
          accounts: { personal: { displayName: 'Ada' } }
        },
        codex: {
          accounts: {
            work: {
              auth: {
                binding: 'device',
                portability: 'device-bound',
                storage: 'device',
                type: 'native'
              },
              title: 'Work'
            }
          }
        }
      }
    })).toEqual({
      adapters: {
        'claude-code': {
          accounts: { personal: { displayName: 'Ada' } }
        },
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token, type: 'codex-auth-json' },
              title: 'Work'
            }
          }
        }
      }
    })
  })

  it('propagates account deletions without resurrecting stale device snapshots', () => {
    expect(mergeRelayPersonalConfigPatches({
      adapters: {
        'claude-code': {
          defaultAccount: 'work',
          accounts: { work: { displayName: 'Ada', generation: 'generation-work', updatedAt: 10 } }
        }
      }
    }, {
      adapters: {
        'claude-code': {
          accountTombstones: { work: 'generation-work' }
        }
      }
    })).toEqual({
      adapters: {
        'claude-code': {
          accounts: {},
          accountTombstones: { work: ['generation-work'] }
        }
      }
    })
  })

  it('keeps the newer credential revision when stale metadata is refreshed later', () => {
    const currentToken = Buffer.from('current').toString('base64')
    const staleToken = Buffer.from('stale').toString('base64')
    const merged = mergeRelayPersonalConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: currentToken, type: 'codex-auth-json' },
              credentialRevision: '2:00000000-0000-0000-0000-000000000002',
              updatedAt: 20
            }
          }
        }
      }
    }, {
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { encoding: 'base64', token: staleToken, type: 'codex-auth-json' },
              credentialRevision: '1:00000000-0000-0000-0000-000000000001',
              title: 'Fresh metadata',
              updatedAt: 999
            }
          }
        }
      }
    })

    expect(merged).toMatchObject({
      adapters: {
        codex: {
          accounts: {
            work: {
              auth: { token: currentToken },
              credentialRevision: '2:00000000-0000-0000-0000-000000000002',
              title: 'Fresh metadata'
            }
          }
        }
      }
    })
  })

  it('keeps the canonical legacy credential when an old client uploads without a revision', () => {
    const merged = mergeRelayPersonalConfigPatches({
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token: 'canonical', type: 'codex-auth-json' } }
          }
        }
      }
    }, {
      adapters: {
        codex: {
          accounts: {
            work: { auth: { encoding: 'base64', token: 'stale', type: 'codex-auth-json' } }
          }
        }
      }
    })

    expect((merged?.adapters?.codex as any).accounts.work.auth.token).toBe('canonical')
  })

  it('stores safe single-user global config for the authenticated user', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const token = Buffer.from(JSON.stringify({ refresh_token: 'codex-refresh-token' })).toString('base64')
    const claudeState = Buffer.from(JSON.stringify({ oauthAccount: { displayName: 'Ada' } })).toString('base64')
    const devicePrivateToken = Buffer.from('device-private-token').toString('base64')
    const update = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accountPool: {
                cooldownMs: 120000,
                enabled: true,
                strategy: 'sticky-priority'
              },
              accounts: {
                default: {
                  auth: {
                    encoding: 'base64',
                    token,
                    type: 'codex-auth-json'
                  },
                  disabled: false,
                  email: 'owner@example.test',
                  priority: 100
                }
              }
            },
            'claude-code': {
              defaultAccount: 'device',
              accounts: {
                device: {
                  auth: {
                    storage: 'device',
                    type: 'claude-native-credential-store',
                    version: 1,
                    portability: 'device-bound',
                    binding: 'device-binding'
                  },
                  state: {
                    storage: 'inline',
                    type: 'claude-account-state-json',
                    version: 1,
                    portability: 'portable',
                    encoding: 'base64',
                    token: claudeState
                  },
                  displayName: 'Ada'
                }
              }
            },
            opencode: {
              accounts: {
                unsafe: {
                  auth: {
                    encoding: 'base64',
                    portability: 'device-bound',
                    storage: 'inline',
                    token: devicePrivateToken,
                    type: 'opencode-device-credential'
                  }
                }
              },
              accountTombstones: {
                removed: 'generation-removed',
                invalid: 20
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
            accountPool: {
              cooldownMs: 120000,
              enabled: true,
              strategy: 'sticky-priority'
            },
            accounts: {
              default: {
                auth: {
                  encoding: 'base64',
                  token,
                  type: 'codex-auth-json'
                },
                disabled: false,
                email: 'owner@example.test',
                priority: 100
              }
            }
          },
          'claude-code': {
            defaultAccount: 'device',
            accounts: {
              device: {
                auth: {
                  storage: 'device',
                  type: 'claude-native-credential-store',
                  version: 1,
                  portability: 'device-bound',
                  binding: 'device-binding'
                },
                state: {
                  storage: 'inline',
                  type: 'claude-account-state-json',
                  version: 1,
                  portability: 'portable',
                  encoding: 'base64',
                  token: claudeState
                },
                displayName: 'Ada'
              }
            }
          },
          opencode: {
            accountTombstones: {
              removed: ['generation-removed']
            }
          }
        }
      },
      hash: expect.stringMatching(/^sha256:/),
      sourceDeviceId: 'owner-device',
      userId: 'owner'
    })
    expect(serialized).not.toContain('do-not-sync')
    expect(serialized).not.toContain(devicePrivateToken)
  })

  it('preserves allowed fields for retained data when an old client sends a partial patch', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters', 'modelServices'],
        configPatch: {
          adapters: {
            codex: {
              accounts: { work: { title: 'Work' } },
              defaultAccount: 'work'
            }
          },
          modelServices: { official: { apiBaseUrl: 'https://example.test' } }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: { codex: { accounts: { work: { description: 'Updated' } } } }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    const pulled = await requestJson(baseUrl, '/api/relay/config/global', {
      headers: authHeaders('owner-session')
    })

    expect(pulled.body.personalConfigSnapshot).toMatchObject({
      allowedFields: ['adapters', 'modelServices'],
      configPatch: {
        adapters: {
          codex: {
            accounts: { work: { description: 'Updated', title: 'Work' } },
            defaultAccount: 'work'
          }
        },
        modelServices: { official: { apiBaseUrl: 'https://example.test' } }
      }
    })
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

  it('merges partial personal config updates for compatibility with older clients', async () => {
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
              first: {
                email: 'first@example.test'
              },
              second: {
                email: 'second@example.test'
              }
            },
            defaultAccount: 'second'
          }
        }
      }
    })
    expect(JSON.stringify(second.body)).toContain('first@example.test')
  })

  it('accepts a default-only partial update when the account already exists', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const first = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: {
                first: { email: 'first@example.test' },
                second: { email: 'second@example.test' }
              },
              defaultAccount: 'first'
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    const updated = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        baseHash: (first.body.personalConfigSnapshot as { hash?: string }).hash,
        configPatch: {
          adapters: { codex: { defaultAccount: 'second' } }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(updated.response.status).toBe(200)
    expect(updated.body.personalConfigSnapshot).toMatchObject({
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              first: { email: 'first@example.test' },
              second: { email: 'second@example.test' }
            },
            defaultAccount: 'second'
          }
        }
      }
    })
  })

  it('rejects a default-only partial update for a missing account', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const update = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: { codex: { defaultAccount: 'missing' } }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(update.response.status).toBe(400)
    expect(update.body.error).toMatch(/missing or deleted/i)
  })

  it('rejects a default-only partial update for a tombstoned account', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: {
            codex: {
              accounts: { work: { generation: 'generation-work', title: 'Work' } },
              accountTombstones: { work: ['generation-work'] }
            }
          }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })
    const update = await requestJson(baseUrl, '/api/relay/config/global', {
      body: JSON.stringify({
        allowedFields: ['adapters'],
        configPatch: {
          adapters: { codex: { defaultAccount: 'work' } }
        }
      }),
      headers: authHeaders('owner-device-token'),
      method: 'PUT'
    })

    expect(update.response.status).toBe(400)
    expect(update.body.error).toMatch(/missing or deleted/i)
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
