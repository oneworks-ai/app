import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'

import { ensureGooseCli, resolveInstalledGooseCli } from '../src/managed-cli'
import { resolveGooseManagedBinaryPath, resolveGooseReleaseTarget } from '../src/paths'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('goose CLI validation environment', () => {
  it('uses a tombstone-aware minimal environment for every init and history version probe', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-probe-env-'))
    tempDirs.push(root)
    vi.stubEnv('HOME', '/poisoned/process/home')
    vi.stubEnv('NODE_OPTIONS', '--require /private/loader.cjs')
    vi.stubEnv('OPENAI_API_KEY', 'poisoned-process-openai-key')
    vi.stubEnv('__ONEWORKS_PROJECT_REGISTER_LOADER__', 'file:///private/oneworks-loader.mjs')

    const pathBinary = resolve(root, 'configured-goose')
    await writeFile(pathBinary, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
    await chmod(pathBinary, 0o755)
    const createProbeEnv = () =>
      ({
        __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: resolve(root, 'cache'),
        AWS_SECRET_ACCESS_KEY: 'poisoned-context-aws-key',
        GOOSE_API_KEY: 'poisoned-goose-auth-not-needed-for-version',
        HOME: null,
        HTTPS_PROXY: 'https://proxy.example.test',
        LANG: 'C.UTF-8',
        PATH: '/trusted/probe/bin'
      }) as unknown as AdapterCtx['env']
    const target = resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' })
    const managedBinary = resolveGooseManagedBinaryPath({
      env: createProbeEnv(),
      target,
      version: '1.46.0'
    })
    await mkdir(dirname(managedBinary), { recursive: true })
    await writeFile(managedBinary, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
    await chmod(managedBinary, 0o755)

    const captured: NodeJS.ProcessEnv[] = []
    const dependencies = {
      arch: 'arm64' as const,
      platform: 'darwin' as const,
      execFile: (async (_command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
        captured.push(options.env ?? {})
        return { stdout: 'goose 1.46.0\n', stderr: '' }
      }) as never,
      resolveSystemBinary: (async () => '/usr/local/bin/goose') as never
    }
    const createInitContext = (env: AdapterCtx['env']) =>
      ({
        cwd: root,
        cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
        configs: [],
        env,
        logger: {
          debug: () => undefined,
          error: () => undefined,
          info: () => undefined,
          stream: process.stderr,
          warn: () => undefined
        }
      }) as unknown as AdapterCtx

    await ensureGooseCli({
      config: { source: 'path', path: pathBinary },
      ctx: createInitContext(createProbeEnv()),
      dependencies
    })
    await resolveInstalledGooseCli({
      config: { source: 'path', path: pathBinary },
      cwd: root,
      dependencies,
      env: createProbeEnv()
    })
    await ensureGooseCli({
      config: { source: 'system' },
      ctx: createInitContext(createProbeEnv()),
      dependencies
    })
    await resolveInstalledGooseCli({
      config: { source: 'system' },
      cwd: root,
      dependencies,
      env: createProbeEnv()
    })
    await ensureGooseCli({
      config: { source: 'managed' },
      ctx: createInitContext(createProbeEnv()),
      dependencies
    })
    await resolveInstalledGooseCli({
      config: { source: 'managed' },
      cwd: root,
      dependencies,
      env: createProbeEnv()
    })

    expect(captured).toHaveLength(6)
    for (const env of captured) {
      expect(env).toMatchObject({
        HTTPS_PROXY: 'https://proxy.example.test',
        LANG: 'C.UTF-8',
        PATH: '/trusted/probe/bin'
      })
      expect(env).not.toHaveProperty('HOME')
      expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
      expect(env).not.toHaveProperty('GOOSE_API_KEY')
      expect(env).not.toHaveProperty('NODE_OPTIONS')
      expect(env).not.toHaveProperty('OPENAI_API_KEY')
      expect(Object.keys(env).some(name => name.startsWith('__ONEWORKS_PROJECT_'))).toBe(false)
    }
  })

  it('uses the minimal environment at the real login-shell resolver boundary for init and history', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-system-discovery-env-'))
    tempDirs.push(root)
    const envLog = resolve(root, 'resolver-env.log')
    const shellPath = resolve(root, 'capture-shell')
    const systemBinary = resolve(root, 'system-goose')
    await writeFile(systemBinary, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
    await chmod(systemBinary, 0o755)
    await writeFile(
      shellPath,
      `#!/bin/sh\n/usr/bin/env | /usr/bin/sort >> '${envLog}'\nprintf '%s\\n' '---' >> '${envLog}'\nprintf '%s\\n' '${systemBinary}'\n`,
      'utf8'
    )
    await chmod(shellPath, 0o755)

    vi.stubEnv('HOME', '/poisoned/process/home')
    vi.stubEnv('NODE_OPTIONS', '--require /private/loader.cjs')
    vi.stubEnv('OPENAI_API_KEY', 'poisoned-process-openai-key')
    vi.stubEnv('__ONEWORKS_PROJECT_REGISTER_LOADER__', 'file:///private/oneworks-loader.mjs')
    const createEnv = () =>
      ({
        __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: resolve(root, 'cache'),
        AWS_SECRET_ACCESS_KEY: 'poisoned-context-aws-key',
        GOOSE_API_KEY: 'poisoned-goose-auth',
        HOME: null,
        HTTPS_PROXY: 'https://proxy.example.test',
        LANG: 'C.UTF-8',
        PATH: '/trusted/discovery/bin',
        SHELL: shellPath
      }) as unknown as AdapterCtx['env']
    const probe = (async (command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      expect(command).toBe(systemBinary)
      expect(options.env).toMatchObject({
        HTTPS_PROXY: 'https://proxy.example.test',
        LANG: 'C.UTF-8',
        PATH: '/trusted/discovery/bin',
        SHELL: shellPath
      })
      return { stdout: 'goose 1.46.0\n', stderr: '' }
    }) as never
    const initCtx = {
      cwd: root,
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      configs: [],
      env: createEnv(),
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      }
    } as unknown as AdapterCtx

    await expect(ensureGooseCli({
      config: { source: 'system' },
      ctx: initCtx,
      dependencies: { execFile: probe }
    })).resolves.toBe(systemBinary)
    await expect(resolveInstalledGooseCli({
      config: { source: 'system' },
      cwd: root,
      dependencies: { execFile: probe },
      env: createEnv()
    })).resolves.toBe(systemBinary)

    const captures = (await readFile(envLog, 'utf8')).split('---\n').filter(Boolean)
    expect(captures).toHaveLength(2)
    for (const capture of captures) {
      expect(capture).toContain(`SHELL=${shellPath}`)
      expect(capture).toContain('PATH=/trusted/discovery/bin')
      expect(capture).toContain('LANG=C.UTF-8')
      expect(capture).toContain('HTTPS_PROXY=https://proxy.example.test')
      expect(capture).not.toContain('HOME=')
      expect(capture).not.toContain('AWS_SECRET_ACCESS_KEY')
      expect(capture).not.toContain('GOOSE_API_KEY')
      expect(capture).not.toContain('NODE_OPTIONS')
      expect(capture).not.toContain('OPENAI_API_KEY')
      expect(capture).not.toContain('__ONEWORKS_PROJECT_')
    }
  })
})
