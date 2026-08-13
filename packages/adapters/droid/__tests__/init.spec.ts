import '../src/adapter-config'

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'
import { resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import { DROID_CLI_PACKAGE, DROID_CLI_VERSION, DROID_CLI_VERSION_ENV } from '../src/paths'
import { initDroidAdapter } from '../src/runtime/init'
import { createDroidSession } from '../src/runtime/session'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const installVersionedFake = async (
  root: string,
  version = '0.195.0',
  envCapturePath?: string
) => {
  const templatePath = fileURLToPath(new URL('../__fixtures__/fake-droid.mjs', import.meta.url))
  const peerPath = join(root, 'fake-droid-peer.mjs')
  const source = (await readFile(templatePath, 'utf8'))
    .replace('#!NODE_EXECUTABLE_PLACEHOLDER', `#!${process.execPath}`)
  await writeFile(peerPath, source)
  await chmod(peerPath, 0o755)
  const binaryPath = join(root, 'droid')
  await writeFile(
    binaryPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  ${
      envCapturePath == null
        ? ':'
        : `printf 'probe|%s|%s|%s|%s|%s|%s|%s\\n' "\${FACTORY_API_KEY-unset}" "\${FACTORY_TOKEN-unset}" "\${OPENAI_API_KEY-unset}" "\${AWS_SECRET_ACCESS_KEY-unset}" "\${GIT_INTERNAL_TOKEN-unset}" "\${INTERNAL_CANARY-unset}" "\${CTX_INTERNAL_CANARY-unset}" >> "${envCapturePath}"`
    }
  echo "droid ${version}"
  exit 0
fi
${
      envCapturePath == null
        ? ''
        : `printf 'runtime|%s|%s\\n' "\${FACTORY_API_KEY-unset}" "\${FACTORY_TOKEN-unset}" >> "${envCapturePath}"`
    }
exec "${peerPath}" "$@"
`
  )
  await chmod(binaryPath, 0o755)
  return binaryPath
}

const createCtx = (
  root: string,
  config: Record<string, unknown>,
  env: Record<string, string | undefined> = {}
): AdapterCtx => ({
  ctxId: 'ctx-droid-init',
  cwd: root,
  env: {
    ...env,
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(root, 'project-home'),
    __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home')
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: join(root, 'cache.json') })
  },
  configs: [{ adapters: { droid: config } }, undefined],
  logger: {
    stream: new PassThrough(),
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  }
})

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Droid init lifecycle')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const runInitializedLifecycle = async (ctx: AdapterCtx, sessionId: string) => {
  const events: AdapterOutputEvent[] = []
  const session = await createDroidSession(ctx, {
    type: 'create',
    runtime: 'cli',
    sessionId,
    model: 'default',
    permissionMode: 'default',
    assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
    onEvent: event => events.push(event)
  })
  session.emit({ type: 'message', content: [{ type: 'text', text: `initialized ${sessionId}` }] })
  await waitFor(() => events.some(event => event.type === 'stop'))
  await session.stop?.()
  await waitFor(() => events.some(event => event.type === 'exit'))
  expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
  expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  return events
}

const stubPrepareCanaries = () => {
  vi.stubEnv('FACTORY_API_KEY', 'process-factory-secret')
  vi.stubEnv('FACTORY_TOKEN', 'process-factory-token')
  vi.stubEnv('OPENAI_API_KEY', 'process-openai-secret')
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'process-aws-secret')
  vi.stubEnv('GIT_INTERNAL_TOKEN', 'process-git-secret')
  vi.stubEnv('INTERNAL_CANARY', 'process-internal-secret')
}

const expectPrepareCaptureIsMinimal = (capture: string) => {
  const probeLines = capture.trim().split('\n').filter(line => line.startsWith('probe|'))
  expect(probeLines.length).toBeGreaterThan(0)
  for (const line of probeLines) expect(line).toBe('probe|unset|unset|unset|unset|unset|unset|unset')
}

describe('factory Droid adapter init', () => {
  it('uses contribution-layered CLI config during normal runtime init', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-init-layers-'))
    tempDirs.push(root)
    const binaryPath = await installVersionedFake(root, '0.195.5')
    const effectiveProjectConfig = {
      adapters: { droid: { cli: { source: 'path' as const, path: binaryPath } } }
    }
    const userConfig = {
      adapters: { droid: { cli: { autoInstall: false } } }
    }
    const ctx = createCtx(root, {})
    ctx.configs = [effectiveProjectConfig, userConfig]
    ctx.configState = {
      effectiveProjectConfig,
      projectConfig: { adapters: { droid: { cli: { path: '/raw/source/path' } } } },
      userConfig,
      mergedConfig: { adapters: { droid: { cli: { autoInstall: false } } } }
    }
    const sourceSnapshot = structuredClone({ effectiveProjectConfig, userConfig })

    await initDroidAdapter(ctx)

    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).toBe(binaryPath)
    expect(ctx.env[DROID_CLI_VERSION_ENV]).toBe('0.195.5')
    expect({ effectiveProjectConfig, userConfig }).toEqual(sourceSnapshot)
  })

  it(
    'honors source:path, validates the version, binds the runtime env, and runs without a manual CLI env',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-init-path-'))
      tempDirs.push(root)
      stubPrepareCanaries()
      const envCapturePath = join(root, 'child-env.log')
      const binaryPath = await installVersionedFake(root, '0.195.7', envCapturePath)
      const ctx = createCtx(root, { cli: { source: 'path', path: binaryPath } }, {
        AWS_SECRET_ACCESS_KEY: 'ctx-aws-secret',
        CTX_INTERNAL_CANARY: 'ctx-internal-secret',
        FACTORY_API_KEY: 'runtime-factory-secret',
        FACTORY_TOKEN: 'runtime-factory-token',
        FAKE_DROID_LOG: join(root, 'requests.jsonl')
      })
      expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).toBeUndefined()

      await initDroidAdapter(ctx)
      expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).toBe(binaryPath)
      expect(ctx.env[DROID_CLI_VERSION_ENV]).toBe('0.195.7')
      expectPrepareCaptureIsMinimal(await readFile(envCapturePath, 'utf8'))

      const events = await runInitializedLifecycle(ctx, 'init-path-lifecycle')
      expect(events).toContainEqual(expect.objectContaining({
        type: 'init',
        data: expect.objectContaining({ version: '0.195.7' })
      }))
      expect(await readFile(envCapturePath, 'utf8')).toContain(
        'runtime|runtime-factory-secret|runtime-factory-token'
      )
    },
    10_000
  )

  it('honors a compatible system binary and runs without a manual CLI env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-init-system-'))
    tempDirs.push(root)
    stubPrepareCanaries()
    const envCapturePath = join(root, 'child-env.log')
    await installVersionedFake(root, '0.195.4', envCapturePath)
    const ctx = createCtx(root, { cli: { source: 'system' } }, {
      FACTORY_API_KEY: 'ctx-factory-secret',
      FACTORY_TOKEN: 'ctx-factory-token',
      FAKE_DROID_LOG: join(root, 'requests.jsonl'),
      INTERNAL_CANARY: 'ctx-internal-secret',
      PATH: `${root}:${process.env.PATH ?? ''}`
    })

    await initDroidAdapter(ctx)
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).toBe('droid')
    expect(ctx.env[DROID_CLI_VERSION_ENV]).toBe('0.195.4')
    expectPrepareCaptureIsMinimal(await readFile(envCapturePath, 'utf8'))
    const events = await runInitializedLifecycle(ctx, 'init-system-lifecycle')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({ version: '0.195.4' })
    }))
  }, 10_000)

  it('rejects incompatible path and missing system binaries before session spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-init-reject-'))
    tempDirs.push(root)
    const incompatible = await installVersionedFake(root, '0.194.9')
    await expect(initDroidAdapter(createCtx(root, {
      cli: { source: 'path', path: incompatible }
    }))).rejects.toThrow('does not satisfy version requirement')
    await expect(initDroidAdapter(createCtx(root, {
      cli: { source: 'system' }
    }, { PATH: join(root, 'empty-bin') }))).rejects.toThrow('droid CLI was not found on PATH')
  }, 10_000)

  it('performs a normal first-use managed install with custom package/version and no credential env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-init-managed-'))
    tempDirs.push(root)
    stubPrepareCanaries()
    const binaryEnvLog = join(root, 'binary-env.log')
    const sourceBinary = await installVersionedFake(root, '0.195.0', binaryEnvLog)
    const npmPath = join(root, 'fake-npm')
    const npmLog = join(root, 'npm.log')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'npm-probe|%s|%s|%s|%s|%s|%s|%s\\n' "$FACTORY_API_KEY" "$FACTORY_TOKEN" "$OPENAI_API_KEY" "$AWS_SECRET_ACCESS_KEY" "$GIT_INTERNAL_TOKEN" "$INTERNAL_CANARY" "$CTX_INTERNAL_CANARY" >> "${npmLog}"
  echo "10.0.0"
  exit 0
fi
printf 'npm-install|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$*" "$FACTORY_API_KEY" "$FACTORY_TOKEN" "$OPENAI_API_KEY" "$AWS_SECRET_ACCESS_KEY" "$GIT_INTERNAL_TOKEN" "$INTERNAL_CANARY" "$CTX_INTERNAL_CANARY" >> "${npmLog}"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cp "${sourceBinary}" "$prefix/node_modules/.bin/droid"
chmod +x "$prefix/node_modules/.bin/droid"
`
    )
    await chmod(npmPath, 0o755)
    const ctx = createCtx(root, {
      cli: {
        source: 'managed',
        package: '@fixture/factory-cli',
        version: '9.8.7',
        npmPath
      }
    }, {
      AWS_SECRET_ACCESS_KEY: 'ctx-aws-secret',
      CTX_INTERNAL_CANARY: 'ctx-internal-secret',
      FACTORY_API_KEY: 'must-not-reach-installer',
      FACTORY_TOKEN: 'must-not-reach-installer',
      FAKE_DROID_LOG: join(root, 'requests.jsonl')
    })
    const defaultPaths = resolveManagedNpmCliPaths({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      env: ctx.env,
      packageName: DROID_CLI_PACKAGE,
      version: DROID_CLI_VERSION
    })
    const defaultCacheLog = join(root, 'default-cache-used.log')
    await mkdir(defaultPaths.binDir, { recursive: true })
    await writeFile(
      defaultPaths.binaryPath,
      `#!/bin/sh
echo used >> "${defaultCacheLog}"
echo "droid 0.195.0"
`
    )
    await chmod(defaultPaths.binaryPath, 0o755)

    await initDroidAdapter(ctx)
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).toContain('node_modules/.bin/droid')
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__).not.toBe(defaultPaths.binaryPath)
    await expect(readFile(defaultCacheLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const log = await readFile(npmLog, 'utf8')
    expect(log).toContain('@fixture/factory-cli@9.8.7')
    for (
      const secret of [
        'process-factory-secret',
        'process-factory-token',
        'process-openai-secret',
        'process-aws-secret',
        'process-git-secret',
        'process-internal-secret',
        'must-not-reach-installer',
        'ctx-aws-secret',
        'ctx-internal-secret'
      ]
    ) expect(log).not.toContain(secret)
    expectPrepareCaptureIsMinimal(await readFile(binaryEnvLog, 'utf8'))
    expect(ctx.env[DROID_CLI_VERSION_ENV]).toBe('0.195.0')
    const events = await runInitializedLifecycle(ctx, 'init-managed-lifecycle')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({ version: '0.195.0' })
    }))
  }, 10_000)
})
