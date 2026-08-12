import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const requireModule = createRequire(import.meta.url)
const { BUILTIN_PLUGIN_PACKAGES } = requireModule('../src/builtin-adapter-cache.cjs') as {
  BUILTIN_PLUGIN_PACKAGES: string[]
}
const {
  assertBuiltinRuntimeActive,
  assertPackagedServerRuntimeBundle,
  assertLocalClientSourcesCompile,
  createPackagedServerChildEnv,
  createPackagedAsset,
  parsePluginCatalog,
  readLocalPluginClientSource,
  readServerText,
  serverCompileTimeoutMs,
  serverRequestTimeoutMs,
  resolvePositiveTimeoutMs
} = requireModule('../scripts/smoke-packaged-server.cjs') as {
  assertBuiltinRuntimeActive: (
    catalog: unknown,
    port: number,
    options?: { privatePaths?: string[] }
  ) => Promise<void>
  assertPackagedServerRuntimeBundle: (appDir: string) => void
  assertLocalClientSourcesCompile: (catalog: unknown, port: number) => Promise<void>
  createPackagedServerChildEnv: (input: {
    clientDistDir: string
    dataDir: string
    dbPath?: string
    logDir: string
    port: number
    workspaceEnv: NodeJS.ProcessEnv
  }) => NodeJS.ProcessEnv
  createPackagedAsset: (
    port: number,
    options?: {
      httpRequest?: typeof import('node:http').request
      timeoutMs?: number
    }
  ) => Promise<{
    data: { asset: { kind: string; path: string } }
    success: boolean
  }>
  parsePluginCatalog: (body: string) => unknown
  readLocalPluginClientSource: (
    port: number,
    versionedEntryUrl: string,
    scope: string,
    options?: {
      httpGet?: typeof import('node:http').get
      timeoutMs?: number
    }
  ) => Promise<string>
  readServerText: (
    port: number,
    requestPath: string,
    label: string,
    options?: {
      httpGet?: typeof import('node:http').get
      timeoutMs?: number
    }
  ) => Promise<string>
  serverCompileTimeoutMs: number
  serverRequestTimeoutMs: number
  resolvePositiveTimeoutMs: (
    env: NodeJS.ProcessEnv,
    name: string,
    fallbackMs: number
  ) => number
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const createRootFreeBuiltinCatalog = () => ({
  plugins: BUILTIN_PLUGIN_PACKAGES.map(packageId => ({
    ...(packageId === '@oneworks/plugin-relay'
      ? {
        contributions: {
          cliCommands: [{ command: 'relay login', id: 'relay-login', root: true }]
        },
        manifest: {
          native: { apps: [{ authentication: { tokenUrl: 'https://example.test/token' }, id: 'relay' }] }
        }
      }
      : {}),
    enabled: true,
    packageId,
    requestId: packageId,
    scope: packageId
  }))
})

describe('packaged server smoke timeouts', () => {
  it('forces the packaged child through the split dist runtime', () => {
    const env = createPackagedServerChildEnv({
      clientDistDir: '/fixture/client',
      dataDir: '/fixture/data',
      logDir: '/fixture/logs',
      port: 43110,
      workspaceEnv: {}
    })

    expect(env.__ONEWORKS_PROJECT_CLI_PREFER_DIST_ENTRY__).toBe('true')
  })

  it('requires both the packaged runtime entry and at least one split chunk', async () => {
    const appDir = await mkdtemp(path.join(os.tmpdir(), 'ow-packaged-runtime-'))
    tempDirs.push(appDir)
    const runtimeDir = path.join(
      appDir,
      'node_modules',
      '@oneworks',
      'server',
      'dist',
      '__INTERNAL__home'
    )
    await mkdir(path.join(runtimeDir, 'chunks'), { recursive: true })
    await writeFile(path.join(runtimeDir, 'index.mjs'), 'export {}\n')

    expect(() => assertPackagedServerRuntimeBundle(appDir)).toThrow('split chunks')

    await writeFile(path.join(runtimeDir, 'chunks', 'runtime-fixture.mjs'), 'export {}\n')
    expect(() => assertPackagedServerRuntimeBundle(appDir)).not.toThrow()
  })

  it('accepts active built-in runtimes without resolved roots', async () => {
    await expect(
      assertBuiltinRuntimeActive(createRootFreeBuiltinCatalog(), 43110, {
        privatePaths: ['/private/packaged-runtime']
      })
    ).resolves.toBeUndefined()
  })

  it.each(['contributions', 'plugin.contributions', 'manifest.plugin.contributions'])(
    'accepts a boolean CLI root at declared %s',
    async placement => {
      const catalog = createRootFreeBuiltinCatalog()
      const relay = catalog.plugins.find(plugin => plugin.packageId === '@oneworks/plugin-relay') as Record<
        string,
        unknown
      >
      delete relay.contributions
      const contributions = {
        cliCommands: [{ command: 'relay login', id: 'relay-login', root: true }]
      }
      if (placement === 'contributions') relay.contributions = contributions
      if (placement === 'plugin.contributions') relay.plugin = { contributions }
      if (placement === 'manifest.plugin.contributions') relay.manifest = { plugin: { contributions } }

      await expect(assertBuiltinRuntimeActive(catalog, 43110)).resolves.toBeUndefined()
    }
  )

  it.each([
    ['root metadata', { pluginRoot: '/private/packaged-runtime/browser-driver' }],
    ['workspace metadata', { runtime: { workspaceFolder: '/private/workspace' } }],
    ['credential metadata', { authentication: { accessToken: 'credential-sentinel' } }],
    [
      'alternate credential metadata',
      {
        authentication: {
          authorizationHeader: 'credential-sentinel',
          bearerToken: 'credential-sentinel',
          oauthToken: 'credential-sentinel',
          privateKey: 'credential-sentinel',
          secret: 'credential-sentinel',
          token: 'credential-sentinel'
        }
      }
    ],
    ['encoded credential metadata', { authentication: { 'a%25252563cess_token': 'credential-sentinel' } }],
    ['private path value', { description: 'Loaded from /private/packaged-runtime/browser-driver' }],
    ['encoded private path value', { description: 'Loaded from %252Fprivate%252Fpackaged-runtime/browser-driver' }],
    [
      'non-boolean CLI root',
      { contributions: { cliCommands: [{ command: 'relay login', id: 'relay-login', root: '/private/root' }] } }
    ],
    [
      'undeclared nested CLI root',
      {
        evil: {
          plugins: [{
            contributions: { cliCommands: [{ command: 'relay login', id: 'relay-login', root: true }] }
          }]
        }
      }
    ]
  ])('rejects active built-in runtimes with leaked %s', async (_label, leakedMetadata) => {
    const catalog = createRootFreeBuiltinCatalog()
    Object.assign(catalog.plugins[0], leakedMetadata)

    await expect(
      assertBuiltinRuntimeActive(catalog, 43110, {
        privatePaths: ['/private/packaged-runtime']
      })
    ).rejects.toThrow(/^Packaged plugin catalog exposed (a )?private/u)
  })

  it('does not include private metadata in smoke failure messages', async () => {
    const catalog = createRootFreeBuiltinCatalog()
    Object.assign(catalog.plugins[0], {
      authentication: { accessToken: 'credential-value-sentinel' }
    })

    const error = await assertBuiltinRuntimeActive(catalog, 43110).catch(value => value as Error)
    expect(error.message).toBe('Packaged plugin catalog exposed private metadata.')
    expect(error.message).not.toContain('credential-value-sentinel')

    const valueCatalog = createRootFreeBuiltinCatalog()
    Object.assign(valueCatalog.plugins[0], {
      description: 'Bearer credential-value-sentinel'
    })
    const valueError = await assertBuiltinRuntimeActive(valueCatalog, 43110).catch(value => value as Error)
    expect(valueError.message).toBe('Packaged plugin catalog exposed private metadata.')
    expect(valueError.message).not.toContain('credential-value-sentinel')

    const invalidJsonError = (() => {
      try {
        parsePluginCatalog('{"accessToken":"credential-value-sentinel"')
      } catch (value) {
        return value as Error
      }
    })()
    expect(invalidJsonError?.message).toBe('Packaged plugin catalog returned invalid JSON.')
    expect(invalidJsonError?.message).not.toContain('credential-value-sentinel')

    const localSourceError = await assertLocalClientSourcesCompile({
      plugins: [{ description: '/private/path/credential-value-sentinel', scope: 'china-red-theme' }]
    }, 43110).catch(value => value as Error)
    expect(localSourceError.message).toBe(
      'Packaged local plugin "china-red-theme" did not expose its compiled source entry.'
    )
    expect(localSourceError.message).not.toContain('/private/path')
    expect(localSourceError.message).not.toContain('credential-value-sentinel')
  })

  it('uses the request timeout fallback for cold plugin compilation', () => {
    expect(
      resolvePositiveTimeoutMs(
        {},
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
        30000
      )
    ).toBe(30000)
  })

  it('accepts an explicit positive request timeout', () => {
    expect(
      resolvePositiveTimeoutMs(
        { ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS: '45000' },
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
        30000
      )
    ).toBe(45000)
  })

  it.each(['0', '-1', '1.5', '30e3', '30000ms', 'invalid'])(
    'rejects invalid request timeout %s',
    value => {
      expect(() =>
        resolvePositiveTimeoutMs(
          { ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS: value },
          'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
          30000
        )
      ).toThrow(
        'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS must be a positive integer'
      )
    }
  )

  it('uses a separate two minute deadline for cold plugin compilation', async () => {
    let capturedOptions: RequestOptions | undefined
    const httpGet = ((
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void
    ) => {
      capturedOptions = options
      const request = new EventEmitter()
      const response = new EventEmitter()
      Object.assign(request, {
        destroy: (error?: Error) => {
          if (error != null) request.emit('error', error)
          return request
        }
      })
      Object.assign(response, {
        setEncoding: () => response,
        statusCode: 200
      })

      queueMicrotask(() => {
        onResponse(response as unknown as IncomingMessage)
        response.emit('data', 'compiled-source')
        response.emit('end')
      })

      return request as unknown as ClientRequest
    }) as typeof import('node:http').get

    await expect(
      readLocalPluginClientSource(
        43110,
        '/api/plugins/china-red-theme/client-source/@v/desktop-smoke/index.ts',
        'china-red-theme',
        { httpGet }
      )
    ).resolves.toBe('compiled-source')
    expect(serverCompileTimeoutMs).toBe(120000)
    expect(capturedOptions?.timeout).toBe(serverCompileTimeoutMs)
    expect(capturedOptions?.path).toBe(
      '/api/plugins/china-red-theme/client-source/@v/desktop-smoke/index.ts?pluginVersion=desktop-smoke'
    )
  })

  it('wires the 30 second default into packaged server HTTP reads', async () => {
    let capturedOptions: RequestOptions | undefined
    const httpGet = ((
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void
    ) => {
      capturedOptions = options
      const request = new EventEmitter()
      const response = new EventEmitter()
      Object.assign(request, {
        destroy: (error?: Error) => {
          if (error != null) request.emit('error', error)
          return request
        }
      })
      Object.assign(response, {
        setEncoding: () => response,
        statusCode: 200
      })

      queueMicrotask(() => {
        onResponse(response as unknown as IncomingMessage)
        response.emit('data', 'compiled-source')
        response.emit('end')
      })

      return request as unknown as ClientRequest
    }) as typeof import('node:http').get

    await expect(
      readServerText(
        43110,
        '/api/plugins/china-red-theme/client-source/index.ts',
        'cold plugin source',
        { httpGet }
      )
    ).resolves.toBe('compiled-source')
    expect(serverRequestTimeoutMs).toBe(30000)
    expect(capturedOptions?.timeout).toBe(serverRequestTimeoutMs)
  })

  it('posts a rule through the packaged filesystem authority route', async () => {
    let capturedBody = ''
    let capturedOptions: RequestOptions | undefined
    const httpRequest = ((
      options: RequestOptions,
      onResponse: (response: IncomingMessage) => void
    ) => {
      capturedOptions = options
      const request = new EventEmitter()
      const response = new EventEmitter()
      Object.assign(request, {
        destroy: (error?: Error) => {
          if (error != null) request.emit('error', error)
          return request
        },
        end: (body: string) => {
          capturedBody = body
          queueMicrotask(() => {
            onResponse(response as unknown as IncomingMessage)
            response.emit(
              'data',
              JSON.stringify({
                data: {
                  asset: { kind: 'rule', path: '.oo/rules/packaged-authority-smoke.md' }
                },
                success: true
              })
            )
            response.emit('end')
          })
        }
      })
      Object.assign(response, {
        setEncoding: () => response,
        statusCode: 201
      })
      return request as unknown as ClientRequest
    }) as typeof import('node:http').request

    await expect(createPackagedAsset(43110, { httpRequest })).resolves.toEqual({
      data: {
        asset: { kind: 'rule', path: '.oo/rules/packaged-authority-smoke.md' }
      },
      success: true
    })
    expect(capturedOptions).toMatchObject({
      method: 'POST',
      path: '/api/ai/assets',
      timeout: serverRequestTimeoutMs
    })
    expect(JSON.parse(capturedBody)).toEqual({
      kind: 'rule',
      name: 'Packaged Authority Smoke'
    })
  })
})
