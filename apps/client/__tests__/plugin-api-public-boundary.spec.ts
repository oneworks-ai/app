/* eslint-disable max-lines -- transport-boundary privacy regressions share one Response projection harness. */
import { describe, expect, it, vi } from 'vitest'

import { listPluginSnapshot } from '#~/plugins/api'

const apiMocks = vi.hoisted(() => ({
  fetchApiJson: vi.fn(),
  fetchApiResponse: vi.fn()
}))

vi.mock('#~/api/base', () => ({
  buildApiUrl: (path: string) => path,
  ...apiMocks
}))

const snapshotFromValue = async (value: unknown) => {
  apiMocks.fetchApiResponse.mockResolvedValueOnce(
    new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' },
      status: 200
    })
  )
  return listPluginSnapshot()
}

const snapshotFrom = async (plugins: unknown[]) => snapshotFromValue({ plugins })

const snapshotFromRaw = async (json: string) => {
  apiMocks.fetchApiResponse.mockResolvedValueOnce(new Response(json, { status: 200 }))
  return listPluginSnapshot()
}

describe('public plugin API boundary', () => {
  it('constructs a root-free fresh graph from the list snapshot transport', async () => {
    const snapshot = await snapshotFrom([{
      client: {
        clientEntryUrl: '/api/plugins/docs/client',
        projectHome: '/private/client',
        root: '/private/root',
        sourceRoot: '/private/source',
        workspaceFolder: '/private/workspace'
      },
      diagnostics: [{
        level: 'info',
        message: 'safe',
        pluginRoot: '/private/diagnostic',
        workspace_folder: '/private/diagnostic'
      }],
      manifest: {
        plugin: { client: { root: '/private/manifest' } },
        project_home: '/private/manifest-project',
        rootDir: '/private/manifest-root'
      },
      pluginRoot: '/private/plugin',
      projectHome: '/private/project',
      requestId: 'docs',
      rootDir: '/private/root',
      scope: 'docs',
      workspaceFolder: '/private/workspace'
    }])

    expect(snapshot.plugins).toEqual([{
      client: { clientEntryUrl: '/api/plugins/docs/client' },
      clientEntryUrl: '/api/plugins/docs/client',
      diagnostics: [{ level: 'info', message: 'safe' }],
      requestId: 'docs',
      scope: 'docs'
    }])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('/private/')
  })

  it('requires a plugins array and rebuilds public diagnostics and runtime metadata', async () => {
    const snapshot = await snapshotFromValue({
      diagnostics: [{
        code: 'safe',
        level: 'warning',
        message: 'Safe diagnostic',
        pluginRoot: '/private/plugin',
        projectHome: '/private/project',
        unknownPrivateMetadata: '/private/unknown',
        workspaceFolder: '/private/workspace'
      }],
      plugins: [],
      runtime: {
        current: true,
        id: 'manager:http://localhost',
        pluginRoot: '/private/plugin',
        projectHome: '/private/project',
        role: 'manager',
        serverBaseUrl: 'http://localhost',
        startedAt: '2026-07-30T00:00:00.000Z',
        status: 'online',
        unknownPrivateMetadata: '/private/unknown',
        workspaceFolder: '/private/workspace',
        workspaceId: 'manager'
      }
    })

    expect(snapshot).toEqual({
      diagnostics: [{
        code: 'safe',
        level: 'warning',
        message: 'Safe diagnostic'
      }],
      plugins: [],
      runtime: {
        current: true,
        id: 'manager:http://localhost',
        role: 'manager',
        serverBaseUrl: 'http://localhost',
        startedAt: '2026-07-30T00:00:00.000Z',
        status: 'online',
        workspaceId: 'manager'
      }
    })
    expect(JSON.stringify(snapshot)).not.toContain('/private/')
  })

  it('rejects path-shaped declared text from the real Response boundary', async () => {
    const privatePath = ['', 'private', 'response-boundary'].join('/')
    const snapshot = await snapshotFrom([{
      description: privatePath,
      diagnostics: [{ code: 'path', level: 'warning', message: privatePath }],
      manifest: { displayName: privatePath, name: privatePath },
      requestId: 'path-free',
      scope: 'path-free'
    }])

    expect(snapshot.plugins).toEqual([{
      requestId: 'path-free',
      scope: 'path-free'
    }])
    expect(JSON.stringify(snapshot)).not.toContain(privatePath)

    for (
      const clientEntryUrl of [
        `/@fs${privatePath}/client.js`,
        `/api/plugins/docs/client?path=${encodeURIComponent(privatePath)}`,
        `/api/plugins/docs/client?${encodeURIComponent(privatePath)}=value`,
        `/plugins/docs#${encodeURIComponent(privatePath)}`
      ]
    ) {
      const endpointSnapshot = await snapshotFrom([{
        client: { clientEntryUrl },
        clientEntryUrl,
        requestId: 'unsafe-endpoint',
        scope: 'unsafe-endpoint'
      }])
      expect(endpointSnapshot.plugins).toEqual([{
        requestId: 'unsafe-endpoint',
        scope: 'unsafe-endpoint'
      }])
    }

    const genericSnapshot = await snapshotFrom([{
      description: `https://docs.example.test/?${encodeURIComponent(privatePath)}=value`,
      requestId: 'unsafe-generic-url',
      scope: 'unsafe-generic-url'
    }])
    expect(genericSnapshot.plugins).toEqual([{
      requestId: 'unsafe-generic-url',
      scope: 'unsafe-generic-url'
    }])

    await expect(snapshotFromValue({
      diagnostics: [{ code: 'path', level: 'warning', message: privatePath }],
      plugins: []
    })).rejects.toThrow(/diagnostics/i)
    await expect(snapshotFromValue({
      plugins: [],
      runtime: { id: 'manager', role: 'manager', workspaceId: privatePath }
    })).rejects.toThrow(/runtime/i)
  })

  it('unwraps the API envelope and preserves the authoritative marketplace runtime identity', async () => {
    const snapshot = await snapshotFromValue({
      data: {
        plugins: [{
          enabled: true,
          manifest: {
            native: {
              adapter: 'codex',
              apps: [{
                authentication: null,
                capabilities: ['Read', 'Write'],
                connectionRequirements: null,
                id: 'asdk_app_693ca6ce2db08191bb52d66743c65184',
                name: 'airtable',
                permissions: null
              }]
            }
          },
          name: 'airtable',
          pluginRoot: '/private/managed/plugins/airtable',
          requestId: 'airtable@openai-plugins',
          scope: 'codex-openai-plugins-airtable-52fa4877979453b87dbb90a4',
          source: {
            adapter: 'codex',
            kind: 'marketplace',
            marketplace: 'openai-plugins',
            plugin: 'airtable',
            root: '/private/managed/plugins/airtable'
          },
          version: '0.1.3'
        }],
        runtime: {
          current: true,
          id: 'workspace:w_airtable',
          role: 'workspace',
          serverBaseUrl: 'http://127.0.0.1:56876',
          status: 'online'
        }
      },
      success: true,
      unknownPrivateMetadata: '/private/envelope'
    })

    expect(snapshot).toEqual({
      diagnostics: undefined,
      plugins: [{
        enabled: true,
        manifest: {
          native: {
            adapter: 'codex',
            apps: [{
              capabilities: ['Read', 'Write'],
              id: 'asdk_app_693ca6ce2db08191bb52d66743c65184',
              name: 'airtable'
            }]
          }
        },
        name: 'airtable',
        requestId: 'airtable@openai-plugins',
        scope: 'codex-openai-plugins-airtable-52fa4877979453b87dbb90a4',
        source: {
          adapter: 'codex',
          kind: 'marketplace',
          marketplace: 'openai-plugins',
          plugin: 'airtable'
        },
        version: '0.1.3'
      }],
      runtime: {
        current: true,
        id: 'workspace:w_airtable',
        role: 'workspace',
        serverBaseUrl: 'http://127.0.0.1:56876',
        status: 'online'
      }
    })
    expect(JSON.stringify(snapshot)).not.toContain('/private/')
  })

  it('rejects repeatedly encoded credential values from native metadata responses', async () => {
    const encodedAuthorizationValue = ['sk', '%252D', 'abcdefghijklmnop'].join('')
    const encodedCallbackValue = ['api', '%255F', 'key', '%253D', 'abcdefghijklmnop'].join('')
    const encodedTokenValue = ['ghp', '%252D', 'abcdefghijklmnop'].join('')
    const snapshot = await snapshotFrom([{
      manifest: {
        native: {
          adapter: 'codex',
          apps: [{
            authentication: {
              authorizationUrl: `https://example.test/oauth?state=${encodedAuthorizationValue}`,
              type: 'oauth2'
            },
            id: 'encoded-authorization'
          }, {
            authentication: {
              callbackPath: `/oauth/callback?state=${encodedCallbackValue}`,
              type: 'oauth2'
            },
            id: 'encoded-callback'
          }, {
            authentication: {
              tokenUrl: `https://example.test/token?state=${encodedTokenValue}`,
              type: 'oauth2'
            },
            id: 'encoded-token'
          }]
        }
      },
      requestId: 'encoded-native',
      scope: 'encoded-native'
    }])

    expect(snapshot.plugins).toEqual([{
      requestId: 'encoded-native',
      scope: 'encoded-native'
    }])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('abcdefghijklmnop')
  })

  it('rejects control whitespace in active native URLs from a real Response', async () => {
    const snapshot = await snapshotFrom([{
      manifest: {
        native: {
          adapter: 'codex',
          apps: [{
            authentication: {
              authorizationUrl: 'ht\ntps://example.test/oauth',
              type: 'oauth2'
            },
            id: 'control-authorization'
          }, {
            authentication: {
              tokenUrl: 'https://example.test/to%250Aken',
              type: 'oauth2'
            },
            id: 'control-token'
          }, {
            connectionRequirements: {
              endpoint: 'https://example.test/con\tnect',
              type: 'oauth'
            },
            id: 'control-endpoint'
          }, {
            authentication: {
              authorizationUrl: 'https://example.test/oauth%252525250Aauthorize',
              type: 'oauth2'
            },
            id: 'deep-control-authorization'
          }, {
            authentication: {
              tokenUrl: 'https://example.test/to%252525250Aken',
              type: 'oauth2'
            },
            id: 'deep-control-token'
          }, {
            authentication: {
              callbackPath: '/oauth/call%252525250Aback',
              type: 'oauth2'
            },
            id: 'deep-control-callback'
          }, {
            connectionRequirements: {
              endpoint: 'https://example.test/con%252525250Anect',
              type: 'oauth'
            },
            id: 'deep-control-endpoint'
          }]
        }
      },
      requestId: 'control-native',
      scope: 'control-native'
    }])

    expect(snapshot.plugins).toEqual([{
      requestId: 'control-native',
      scope: 'control-native'
    }])
  })

  it('preserves safe redirect URI routes and nested HTTPS callbacks in native metadata', async () => {
    const authorizationUrl =
      'https://example.test/oauth?redirect_uri=%2Foauth%2Fcallback&redirect_url=https%3A%2F%2Fapp.example.test%2Fauth%2Fcallback'
    const snapshot = await snapshotFrom([{
      manifest: {
        native: {
          adapter: 'codex',
          apps: [{
            authentication: { authorizationUrl, type: 'oauth2' },
            id: 'safe-redirects'
          }]
        }
      },
      requestId: 'safe-native',
      scope: 'safe-native'
    }])

    expect(snapshot.plugins[0]?.manifest?.native?.apps).toEqual([{
      authentication: { authorizationUrl, type: 'oauth2' },
      id: 'safe-redirects'
    }])
  })

  it('rejects filesystem selectors in native URL and route metadata from a real Response', async () => {
    const encodedPath = encodeURIComponent('/Users/private/plugin-root')
    const snapshot = await snapshotFrom([{
      manifest: {
        native: {
          adapter: 'codex',
          apps: [{
            authentication: {
              authorizationUrl: `https://example.test/oauth?${encodedPath}=value`,
              type: 'oauth2'
            },
            id: 'filesystem-query-key'
          }, {
            authentication: {
              callbackPath: `/oauth/callback?next=${encodedPath}`,
              type: 'oauth2'
            },
            id: 'filesystem-route-query'
          }, {
            connectionRequirements: {
              endpoint: `https://example.test/connect#${encodedPath}`,
              type: 'oauth'
            },
            id: 'filesystem-fragment'
          }, {
            authentication: {
              authorizationUrl: 'https://example.test/oauth?creden%2574ial=private-value',
              type: 'oauth2'
            },
            id: 'encoded-credential-key'
          }, {
            authentication: {
              tokenUrl: 'https://example.test/token?authorization%2548eader=private-value',
              type: 'oauth2'
            },
            id: 'encoded-authorization-key'
          }, {
            authentication: {
              authorizationUrl: 'https://example.test/oauth?redirect_uri=%2FUsers%2Funrelated%2Foauth%2Fcallback',
              type: 'oauth2'
            },
            id: 'filesystem-redirect-route'
          }]
        }
      },
      requestId: 'filesystem-native',
      scope: 'filesystem-native'
    }])

    expect(snapshot.plugins).toEqual([{
      requestId: 'filesystem-native',
      scope: 'filesystem-native'
    }])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('/Users/')
    expect(JSON.stringify(snapshot.plugins)).not.toContain('%2FUsers')
  })

  it('fails closed for malformed plugin snapshot wrappers', async () => {
    await expect(snapshotFromValue([])).rejects.toThrow(/object wrapper/i)
    await expect(snapshotFromValue({ plugins: {} })).rejects.toThrow(/plugins array/i)
    await expect(snapshotFromValue({ diagnostics: {}, plugins: [] })).rejects.toThrow(/diagnostics/i)
    await expect(snapshotFromValue({ plugins: [], runtime: { id: 'missing-role' } })).rejects.toThrow(/runtime/i)
    await expect(snapshotFromValue({ data: { plugins: [] }, success: false })).rejects.toThrow(
      /successful API envelope/i
    )
    await expect(snapshotFromValue({ data: [], success: true })).rejects.toThrow(/envelope data/i)
  })

  it('preserves the declared public runtime contract through the list snapshot transport', async () => {
    const snapshot = await snapshotFrom([{
      apis: [{
        description: { en: 'Search API' },
        headerSchema: { type: 'object' },
        id: 'search',
        inputSchema: { type: 'string' },
        mode: 'proxy',
        outputSchema: {
          $defs: { Result: { type: 'array' } },
          $ref: '#/$defs/Result',
          type: 'array'
        },
        proxyTarget: 'manager',
        target: '/api/plugins/docs/proxy/search',
        title: 'Search'
      }],
      contributions: { routes: [{ id: 'docs', title: 'Docs' }] },
      descriptionI18n: { en: 'Docs integration' },
      displayNameI18n: { en: 'Docs' },
      options: { theme: 'light' },
      plugin: { contributions: { navItems: [{ id: 'docs', title: 'Docs' }] } },
      requestId: 'docs',
      scope: 'docs',
      manifest: {
        config: { schema: { type: 'object' } },
        descriptionI18n: { en: 'Manifest description' },
        displayNameI18n: { en: 'Manifest title' },
        plugin: {
          contributions: { routes: [{ id: 'manifest-docs', title: 'Manifest Docs' }] },
          server: { entry: 'server.ts', roles: ['workspace'] }
        }
      }
    }])

    expect(snapshot.plugins[0]).toMatchObject({
      apis: [{
        description: { en: 'Search API' },
        headerSchema: { type: 'object' },
        id: 'search',
        inputSchema: { type: 'string' },
        mode: 'proxy',
        outputSchema: {
          $defs: { Result: { type: 'array' } },
          $ref: '#/$defs/Result',
          type: 'array'
        },
        proxyTarget: 'manager',
        target: '/api/plugins/docs/proxy/search',
        title: 'Search'
      }],
      contributions: { routes: [{ id: 'docs', title: 'Docs' }] },
      descriptionI18n: { en: 'Docs integration' },
      displayNameI18n: { en: 'Docs' },
      options: { theme: 'light' },
      plugin: { contributions: { navItems: [{ id: 'docs', title: 'Docs' }] } },
      manifest: {
        config: { schema: { type: 'object' } },
        descriptionI18n: { en: 'Manifest description' },
        displayNameI18n: { en: 'Manifest title' },
        plugin: {
          contributions: { routes: [{ id: 'manifest-docs', title: 'Manifest Docs' }] },
          server: { entry: 'server.ts', roles: ['workspace'] }
        }
      }
    })
  })

  it('rejects unsafe API registration targets and proxy targets from a real Response', async () => {
    for (
      const api of [{
        id: 'filesystem-target',
        mode: 'handler',
        target: '/@fs/private/plugin/index.ts'
      }, {
        id: 'filesystem-query',
        mode: 'handler',
        target: '/api/plugins/docs/proxy/search?next=%2Fprivate%2Fplugin'
      }, {
        id: 'unsafe-scheme',
        mode: 'handler',
        target: 'javascript:alert(1)'
      }, {
        id: 'filesystem-proxy',
        mode: 'proxy',
        proxyTarget: '/private/plugin',
        target: '/api/plugins/docs/proxy/search'
      }, {
        id: 'unsafe-proxy-scheme',
        mode: 'proxy',
        proxyTarget: 'javascript:alert(1)',
        target: '/api/plugins/docs/proxy/search'
      }]
    ) {
      const snapshot = await snapshotFrom([{
        apis: [api],
        requestId: 'unsafe-api',
        scope: 'unsafe-api'
      }])
      expect(snapshot.plugins).toEqual([{
        requestId: 'unsafe-api',
        scope: 'unsafe-api'
      }])
      expect(JSON.stringify(snapshot.plugins)).not.toContain('/private/')
      expect(JSON.stringify(snapshot.plugins)).not.toContain('/@fs')
      expect(JSON.stringify(snapshot.plugins)).not.toContain('javascript:')
    }
  })

  it('projects every declared cliCommands field while keeping root boolean-only', async () => {
    const snapshot = await snapshotFrom([{
      contributions: {
        cliCommands: [{
          aliases: ['sign-in'],
          command: 'login',
          description: { en: 'Sign in' },
          descriptionI18n: { 'zh-Hans': '登录' },
          i18n: {
            en: {
              description: 'Sign in to an account',
              title: 'Login'
            }
          },
          id: 'login',
          path: ['account', 'login'],
          roles: ['manager'],
          root: true,
          surfaces: ['launcher'],
          title: 'Login',
          titleI18n: { 'zh-Hans': '登录' }
        }, {
          command: 'status',
          id: 'status',
          root: false
        }],
        routes: [{ id: 'account', title: 'Account' }]
      },
      requestId: 'cli',
      scope: 'cli'
    }])

    expect(snapshot.plugins).toEqual([{
      contributions: {
        cliCommands: [{
          aliases: ['sign-in'],
          command: 'login',
          description: { en: 'Sign in' },
          descriptionI18n: { 'zh-Hans': '登录' },
          i18n: {
            en: {
              description: 'Sign in to an account',
              title: 'Login'
            }
          },
          id: 'login',
          path: ['account', 'login'],
          roles: ['manager'],
          root: true,
          surfaces: ['launcher'],
          title: 'Login',
          titleI18n: { 'zh-Hans': '登录' }
        }, {
          command: 'status',
          id: 'status',
          root: false
        }],
        routes: [{ id: 'account', title: 'Account' }]
      },
      requestId: 'cli',
      scope: 'cli'
    }])
  })

  it('permits local JSON pointers only in schema reference fields', async () => {
    for (
      const api of [{
        description: '#/Users/private/api-description',
        id: 'unsafe-description',
        mode: 'handler',
        target: 'unsafe.description'
      }, {
        id: 'unsafe-schema',
        inputSchema: { default: '#/Users/private/schema-default', type: 'string' },
        mode: 'handler',
        target: 'unsafe.schema'
      }]
    ) {
      const snapshot = await snapshotFrom([{
        apis: [api],
        requestId: 'schema-scope',
        scope: 'schema-scope'
      }])
      expect(snapshot.plugins).toEqual([{
        requestId: 'schema-scope',
        scope: 'schema-scope'
      }])
      expect(JSON.stringify(snapshot)).not.toContain('#/Users/')
    }
  })

  it('rejects invalid cliCommands roots, filesystem paths, unknown keys, and nested leaks', async () => {
    const snapshot = await snapshotFrom([
      {
        contributions: { cliCommands: [{ command: 'login', id: 'login', root: '/private/root' }] },
        requestId: 'root-string',
        scope: 'root-string'
      },
      {
        contributions: { cliCommands: [{ command: 'login', id: 'login', root: null }] },
        requestId: 'root-null',
        scope: 'root-null'
      },
      {
        contributions: { cliCommands: [{ command: 'login', id: 'login', path: ['/private/root'] }] },
        requestId: 'path-value',
        scope: 'path-value'
      },
      {
        contributions: { cliCommands: [{ command: 'login', extra: true, id: 'login' }] },
        requestId: 'unknown',
        scope: 'unknown'
      },
      {
        contributions: {
          cliCommands: [{
            command: 'login',
            i18n: { en: { accessToken: 'token-secret', title: 'Login' } },
            id: 'login'
          }]
        },
        requestId: 'nested-credential',
        scope: 'nested-credential'
      },
      {
        contributions: {
          cliCommands: [{
            command: 'login',
            i18n: { en: { projectHome: '/private/project', title: 'Login' } },
            id: 'login'
          }]
        },
        requestId: 'nested-path',
        scope: 'nested-path'
      }
    ])

    expect(snapshot.plugins).toEqual([
      { requestId: 'root-string', scope: 'root-string' },
      { requestId: 'root-null', scope: 'root-null' },
      { requestId: 'path-value', scope: 'path-value' },
      { requestId: 'unknown', scope: 'unknown' },
      { requestId: 'nested-credential', scope: 'nested-credential' },
      { requestId: 'nested-path', scope: 'nested-path' }
    ])
    expect(JSON.stringify(snapshot.plugins)).not.toContain('secret')
    expect(JSON.stringify(snapshot.plugins)).not.toContain('/private/')
  })

  it('fails closed for nested credential keys across encoding and separator variants', async () => {
    const snapshot = await snapshotFrom([{
      apis: [{
        id: 'credential-output',
        mode: 'handler',
        outputSchema: {
          properties: {
            access_token: { const: 'access-secret' }
          },
          type: 'object'
        },
        target: 'credential.output'
      }],
      manifest: {
        config: {
          schema: {
            properties: {
              CLIENTSECRET: { const: 'client-secret' }
            },
            type: 'object'
          }
        }
      },
      options: {
        nested: {
          '%2561pi%254Bey': 'api-secret'
        }
      },
      requestId: 'credentials',
      scope: 'credentials'
    }])

    expect(snapshot.plugins).toEqual([{ requestId: 'credentials', scope: 'credentials' }])
    expect(JSON.stringify(snapshot.plugins)).not.toMatch(/(?:access|api|client)-secret/u)
  })

  it('rejects repeatedly encoded credential values in generic metadata and diagnostics', async () => {
    const credential = ['sk', '%252D', 'abcdefghijklmnop'].join('')
    const snapshot = await snapshotFrom([{
      diagnostics: [{ code: 'safe', level: 'warning', message: credential }],
      options: {
        credentialUrl: 'https://alice:s3cret@example.test/path',
        encodedPath: '%2Fprivate%2Funrelated',
        label: credential
      },
      requestId: 'encoded-values',
      scope: 'encoded-values'
    }])

    expect(snapshot.plugins).toEqual([{
      requestId: 'encoded-values',
      scope: 'encoded-values'
    }])
    expect(JSON.stringify(snapshot)).not.toContain('abcdefghijklmnop')
    expect(JSON.stringify(snapshot)).not.toContain('s3cret')
    expect(JSON.stringify(snapshot)).not.toContain('%2Fprivate')
  })

  it('drops wrong types and field-local oversized declarations after JSON parsing', async () => {
    const snapshot = await snapshotFrom([
      { requestId: 7, scope: 'wrong-type' },
      { requestId: 'oversized', scope: 'x'.repeat(16 * 1024 + 1) }
    ])

    expect(snapshot.plugins).toEqual([])
  })

  it('rejects deep and over-budget raw JSON before public projection', async () => {
    const deep = `${'{"value":'.repeat(18)}null${'}'.repeat(18)}`
    await expect(snapshotFromRaw(deep)).rejects.toThrow(/structural limit/i)
    await expect(snapshotFromRaw(JSON.stringify({
      plugins: Array.from({ length: 257 }, (_, index) => ({ requestId: `p-${index}`, scope: `p-${index}` }))
    }))).rejects.toThrow(/array item limit/i)
  })

  it('fails closed for private fields inside generic public sections', async () => {
    const snapshot = await snapshotFrom([{
      contributions: { routes: [{ id: 'safe', sourceRoot: '/private/source', title: 'Safe' }] },
      manifest: { config: { schema: { workspace_folder: '/private/workspace' } } },
      options: { rootDir: '/private/root', sourceRoot: '/private/source' },
      requestId: 'bounded',
      scope: 'bounded'
    }])

    expect(snapshot.plugins).toEqual([{ requestId: 'bounded', scope: 'bounded' }])
  })
})
