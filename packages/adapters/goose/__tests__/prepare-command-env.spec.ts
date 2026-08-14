import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import '../src/adapter-config'
import { ensureGooseCli } from '../src/managed-cli'
import { resolveGooseManagedBinaryPath, resolveGooseReleaseTarget } from '../src/paths'
import { prepareGooseSession } from '../src/runtime/prepare'

const tempDirs: string[] = []

const waitForFile = async (path: string) => {
  const startedAt = Date.now()
  while (true) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() - startedAt > 1_000) throw error
      await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
    }
  }
}

const writeExecutable = async (path: string, source: string) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, source, 'utf8')
  await chmod(path, 0o755)
}

const createFixture = async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-mcp-discovery-'))
  tempDirs.push(root)
  const captureDir = resolve(root, 'captures')
  const configDir = resolve(root, 'goose-config')
  const cacheDir = resolve(root, 'cache')
  const shellPath = resolve(root, 'capture-shell')
  const goosePath = resolve(root, 'system-goose')
  const alphaPath = resolve(root, 'mcp-alpha')
  const betaPath = resolve(root, 'mcp-beta')
  await Promise.all([
    mkdir(captureDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    writeExecutable(goosePath, '#!/bin/sh\necho "goose 1.46.0"\n'),
    writeExecutable(alphaPath, '#!/bin/sh\nexit 0\n'),
    writeExecutable(betaPath, '#!/bin/sh\nexit 0\n')
  ])
  await writeExecutable(
    shellPath,
    `#!/bin/sh
command_name="$4"
capture_path='${captureDir}/'"$command_name"'.env'
{
  /usr/bin/env | /usr/bin/sort
  printf '%s\n' '--END--'
} > "$capture_path"
case "$command_name" in
  goose) printf '%s\n' '${goosePath}' ;;
  mcp-alpha) printf '%s\n' '${alphaPath}' ;;
  mcp-beta) printf '%s\n' '${betaPath}' ;;
  malformed-mcp) printf '%s\n' 'not-an-absolute-command-path' ;;
  missing-mcp) exit 127 ;;
  slow-mcp)
    printf '%s\n' "$$" > '${captureDir}/slow-mcp.pid'
    child=''
    trap 'kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; printf "%s\\n" terminated >> "${captureDir}/slow-mcp.terminated"; exit 143' TERM
    /bin/sleep 30 &
    child="$!"
    wait "$child"
    ;;
  *) exit 127 ;;
esac
`
  )
  return { alphaPath, betaPath, cacheDir, captureDir, configDir, goosePath, root, shellPath }
}

const createContext = (
  fixture: Awaited<ReturnType<typeof createFixture>>,
  source: 'managed' | 'path' | 'system',
  path?: string
) =>
  ({
    ctxId: `ctx-goose-${source}`,
    cwd: fixture.root,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__: fixture.configDir,
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_SOURCE__: source,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: resolve(fixture.root, '.project-home'),
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: fixture.cacheDir,
      __ONEWORKS_PROJECT_REGISTER_LOADER__: 'file:///private/context-loader.mjs',
      AWS_SHARED_CREDENTIALS_FILE: '/private/context-aws-credentials',
      GOOSE_API_KEY: 'context-goose-secret',
      GOOGLE_APPLICATION_CREDENTIALS: '/private/context-google-credentials.json',
      HOME: null,
      HTTPS_PROXY: 'https://proxy.example.test',
      LANG: 'C.UTF-8',
      NODE_OPTIONS: '--require /private/context-loader.cjs',
      OPENAI_API_KEY: 'context-provider-secret',
      PATH: '/trusted/discovery/bin',
      PROJECT_FLAG: 'runtime-only',
      SHELL: fixture.shellPath,
      SSL_CERT_FILE: '/trusted/ca.pem',
      TMPDIR: resolve(fixture.root, 'tmp'),
      ...(path == null ? {} : { __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: path })
    },
    cache: {
      get: async () => undefined,
      set: async () => ({ cachePath: '' })
    },
    configs: [{ adapters: { goose: { cli: { source, ...(path == null ? {} : { path }) } } } }],
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      stream: process.stderr
    }
  }) as unknown as AdapterCtx

const createOptions = (commands: string[]): AdapterQueryOptions => ({
  type: 'create',
  runtime: 'server',
  sessionId: '11111111-1111-4111-8111-111111111111',
  permissionMode: 'default',
  assetPlan: {
    adapter: 'goose',
    diagnostics: [],
    mcpServers: Object.fromEntries(commands.map((command, index) => [
      `server-${index}`,
      { command, args: ['serve'], env: { MCP_TOKEN: `scoped-${index}` } }
    ])),
    overlays: []
  } as never,
  onEvent: () => undefined
})

const assertMinimalCapture = (capture: string, shellPath: string, root: string) => {
  expect(capture).toContain(`SHELL=${shellPath}`)
  expect(capture).toContain('PATH=/trusted/discovery/bin')
  expect(capture).toContain('LANG=C.UTF-8')
  expect(capture).toContain('HTTPS_PROXY=https://proxy.example.test')
  expect(capture).toContain('SSL_CERT_FILE=/trusted/ca.pem')
  expect(capture).toContain(`TMPDIR=${resolve(root, 'tmp')}`)
  expect(capture).not.toContain('HOME=')
  expect(capture).not.toContain('AWS_SHARED_CREDENTIALS_FILE')
  expect(capture).not.toContain('GOOGLE_APPLICATION_CREDENTIALS')
  expect(capture).not.toContain('GOOSE_API_KEY')
  expect(capture).not.toContain('NODE_OPTIONS')
  expect(capture).not.toContain('OPENAI_API_KEY')
  expect(capture).not.toContain('__ONEWORKS_PROJECT_')
  expect(capture.match(/--END--/gu)).toHaveLength(1)
}

describe.skipIf(process.platform === 'win32')('goose MCP command discovery environment', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it.each(['path', 'system', 'managed'] as const)(
    'uses a minimal real login-shell environment for multiple MCP commands after %s CLI prepare',
    async (source) => {
      const fixture = await createFixture()
      vi.stubEnv('HOME', '/poisoned/process/home')
      vi.stubEnv('NODE_OPTIONS', '--require /private/process-loader.cjs')
      vi.stubEnv('OPENAI_API_KEY', 'process-provider-secret')
      vi.stubEnv('GOOSE_API_KEY', 'process-goose-secret')
      vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/private/process-aws-credentials')
      vi.stubEnv('__ONEWORKS_PROJECT_REGISTER_LOADER__', 'file:///private/process-loader.mjs')

      const pathBinary = resolve(fixture.root, 'configured-goose')
      if (source === 'path') await writeExecutable(pathBinary, '#!/bin/sh\necho "goose 1.46.0"\n')
      const ctx = createContext(fixture, source, source === 'path' ? pathBinary : undefined)
      if (source === 'managed') {
        const target = resolveGooseReleaseTarget()
        const managedBinary = resolveGooseManagedBinaryPath({ env: ctx.env, target, version: '1.46.0' })
        await writeExecutable(managedBinary, '#!/bin/sh\necho "goose 1.46.0"\n')
      }
      const cliConfig = { source, ...(source === 'path' ? { path: pathBinary } : {}), autoInstall: false }
      await ensureGooseCli({ config: cliConfig, ctx })

      const options = createOptions(['mcp-alpha', 'mcp-beta'])
      const envBefore = { ...ctx.env }
      const assetPlanBefore = JSON.stringify(options.assetPlan)
      const prepared = await prepareGooseSession(ctx, options)

      expect(ctx.env).toEqual(envBefore)
      expect(JSON.stringify(options.assetPlan)).toBe(assetPlanBefore)
      expect(prepared.mcpServers).toEqual([
        {
          name: 'server-0',
          command: fixture.alphaPath,
          args: ['serve'],
          env: [{ name: 'MCP_TOKEN', value: 'scoped-0' }]
        },
        {
          name: 'server-1',
          command: fixture.betaPath,
          args: ['serve'],
          env: [{ name: 'MCP_TOKEN', value: 'scoped-1' }]
        }
      ])
      for (const command of ['mcp-alpha', 'mcp-beta']) {
        assertMinimalCapture(
          await readFile(resolve(fixture.captureDir, `${command}.env`), 'utf8'),
          fixture.shellPath,
          fixture.root
        )
      }
      if (source === 'system') {
        assertMinimalCapture(
          await readFile(resolve(fixture.captureDir, 'goose.env'), 'utf8'),
          fixture.shellPath,
          fixture.root
        )
        expect(prepared.binaryPath).toBe(fixture.goosePath)
      }
    },
    15_000
  )

  it('fails closed to the explicit command on missing, malformed, and timed-out shell results', async () => {
    const fixture = await createFixture()
    const cliPath = resolve(fixture.root, 'configured-goose')
    await writeExecutable(cliPath, '#!/bin/sh\necho "goose 1.46.0"\n')
    const ctx = createContext(fixture, 'path', cliPath)
    const options = createOptions(['missing-mcp', 'malformed-mcp', 'slow-mcp'])
    const optionsBefore = JSON.stringify(options.assetPlan)
    const startedAt = Date.now()

    const prepared = await prepareGooseSession(ctx, options, { mcpCommandTimeoutMs: 1_500 })

    expect(Date.now() - startedAt).toBeLessThan(4_000)
    expect(prepared.mcpServers.map(server => 'command' in server ? server.command : undefined)).toEqual([
      'missing-mcp',
      'malformed-mcp',
      'slow-mcp'
    ])
    expect(JSON.stringify(options.assetPlan)).toBe(optionsBefore)
    for (const command of ['missing-mcp', 'malformed-mcp', 'slow-mcp']) {
      assertMinimalCapture(
        await waitForFile(resolve(fixture.captureDir, `${command}.env`)),
        fixture.shellPath,
        fixture.root
      )
    }
    expect(await waitForFile(resolve(fixture.captureDir, 'slow-mcp.terminated'))).toBe('terminated\n')
    const pid = Number(await readFile(resolve(fixture.captureDir, 'slow-mcp.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  }, 10_000)
})
