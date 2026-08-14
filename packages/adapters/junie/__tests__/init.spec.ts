import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'

import '../src/adapter-config'
import { ensureJunieCli, validateJunieVersionOutput } from '#~/runtime/init.js'

const managedMocks = vi.hoisted(() => ({ ensureManagedNpmCli: vi.fn() }))
vi.mock('@oneworks/utils/managed-npm-cli', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/utils/managed-npm-cli')>(),
  ensureManagedNpmCli: managedMocks.ensureManagedNpmCli
}))

const withProcessPlatform = async <T>(platform: NodeJS.Platform, task: () => Promise<T>) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return await task()
  } finally {
    if (descriptor != null) Object.defineProperty(process, 'platform', descriptor)
  }
}

describe('junie CLI prepare sources and version policy', () => {
  let cwd: string | undefined
  const processSentinels = {
    OPENAI_API_KEY: 'sentinel-process-openai',
    AWS_SECRET_ACCESS_KEY: 'sentinel-process-aws',
    AZURE_OPENAI_API_KEY: 'sentinel-process-azure',
    GITHUB_TOKEN: 'sentinel-process-git',
    INTERNAL_SECRET: 'sentinel-process-internal'
  }
  let previousProcessEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    previousProcessEnv = Object.fromEntries(
      Object.keys(processSentinels).map(key => [key, process.env[key]])
    )
    Object.assign(process.env, processSentinels)
  })

  afterEach(async () => {
    managedMocks.ensureManagedNpmCli.mockReset()
    for (const [key, value] of Object.entries(previousProcessEnv)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
    if (cwd != null) await rm(cwd, { recursive: true, force: true })
    cwd = undefined
  })

  const makeFake = async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-init-'))
    const binaryPath = join(cwd, 'junie')
    const recordPath = join(cwd, 'version-probe-env.jsonl')
    await writeFile(
      binaryPath,
      `#!${process.execPath}
require('node:fs').appendFileSync(
  ${JSON.stringify(recordPath)},
  JSON.stringify({
    keys: Object.keys(process.env).sort(),
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR
  }) + '\\n'
)
console.log('Junie version: 26.8.10 (2651.4)')
`
    )
    await chmod(binaryPath, 0o755)
    return binaryPath
  }

  it.each(['managed', 'system', 'path'] as const)('prepares the %s source with a conservative probe', async source => {
    const binaryPath = await makeFake()
    managedMocks.ensureManagedNpmCli.mockResolvedValue(binaryPath)
    const ctx = {
      ctxId: 'ctx-init',
      cwd,
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: cwd,
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
        JUNIE_API_KEY: 'must-not-reach-version-probe',
        OPENAI_API_KEY: 'must-not-reach-version-probe',
        AWS_SECRET_ACCESS_KEY: 'must-not-reach-version-probe',
        XDG_RUNTIME_DIR: '/run/user/1000'
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      },
      configs: [
        { adapters: { junie: { cli: { source, ...(source === 'path' ? { path: binaryPath } : {}) } } } },
        undefined
      ]
    } as AdapterCtx
    await expect(withProcessPlatform('linux', () => ensureJunieCli(ctx))).resolves.toBe(binaryPath)
    expect(ctx.env.__ONEWORKS_PROJECT_JUNIE_DATA__).toBeUndefined()
    expect(managedMocks.ensureManagedNpmCli).toHaveBeenCalledWith(expect.objectContaining({
      adapterKey: 'junie',
      childEnvPolicy: 'minimal',
      commandCheckTimeoutMs: 180_000,
      config: expect.objectContaining({ source }),
      defaultPackageName: '@jetbrains/junie',
      defaultVersion: '2651.4.0',
      installHomeDir: source === 'managed'
        ? expect.stringContaining('/.oneworks/bootstrap/npm/junie-runtime-home')
        : undefined,
      versionRange: '>=26.8.10 <26.9.0'
    }))
    const probeEnv = managedMocks.ensureManagedNpmCli.mock.calls.at(-1)?.[0].env as NodeJS.ProcessEnv
    expect(probeEnv.HOME).toContain('/.oneworks/bootstrap/npm/junie-runtime-home')
    expect(probeEnv).not.toHaveProperty('JUNIE_API_KEY')
    expect(probeEnv).not.toHaveProperty('OPENAI_API_KEY')
    expect(probeEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(probeEnv.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
    expect(probeEnv.XDG_RUNTIME_DIR).toBe('/run/user/1000')
    const finalProbe = JSON.parse(await readFile(join(cwd!, 'version-probe-env.jsonl'), 'utf8')) as {
      DBUS_SESSION_BUS_ADDRESS?: string
      XDG_RUNTIME_DIR?: string
      keys: string[]
    }
    expect(finalProbe.keys).not.toEqual(expect.arrayContaining(Object.keys(processSentinels)))
    expect(finalProbe.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
    expect(finalProbe.XDG_RUNTIME_DIR).toBe('/run/user/1000')
  })

  it('keeps login-shell system discovery on the minimal child environment', async () => {
    const binaryPath = await makeFake()
    const shellPath = join(cwd!, 'capture-shell')
    const shellRecordPath = join(cwd!, 'shell-probe-env.json')
    await writeFile(
      shellPath,
      `#!${process.execPath}
require('node:fs').writeFileSync(
  ${JSON.stringify(shellRecordPath)},
  JSON.stringify({
    keys: Object.keys(process.env).sort(),
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR
  })
)
console.log(${JSON.stringify(binaryPath)})
`
    )
    await chmod(shellPath, 0o755)
    managedMocks.ensureManagedNpmCli.mockResolvedValue('junie')
    const ctx = {
      ctxId: 'ctx-init-system-shell',
      cwd,
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: cwd,
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
        SHELL: shellPath,
        XDG_RUNTIME_DIR: '/run/user/1000',
        ...processSentinels
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      },
      configs: [{ adapters: { junie: { cli: { source: 'system' } } } }, undefined]
    } as AdapterCtx

    await expect(withProcessPlatform('linux', () => ensureJunieCli(ctx))).resolves.toBe(binaryPath)
    const shellRecord = JSON.parse(await readFile(shellRecordPath, 'utf8')) as {
      DBUS_SESSION_BUS_ADDRESS?: string
      XDG_RUNTIME_DIR?: string
      keys: string[]
    }
    expect(shellRecord.keys).not.toEqual(expect.arrayContaining(Object.keys(processSentinels)))
    expect(shellRecord.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
    expect(shellRecord.XDG_RUNTIME_DIR).toBe('/run/user/1000')
  })

  it('rejects relative paths and incompatible version output', async () => {
    const binaryPath = await makeFake()
    managedMocks.ensureManagedNpmCli.mockResolvedValue(binaryPath)
    const ctx = {
      ctxId: 'ctx-init',
      cwd,
      env: { __ONEWORKS_PROJECT_REAL_HOME__: cwd },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      },
      configs: [{ adapters: { junie: { cli: { source: 'path', path: './junie' } } } }, undefined]
    } as AdapterCtx
    await expect(ensureJunieCli(ctx)).rejects.toThrow('must be absolute')
    expect(() => validateJunieVersionOutput('Junie version: 26.9.0 (2652.1)')).toThrow('Unsupported Junie CLI version')
    expect(() => validateJunieVersionOutput('unknown')).toThrow('Could not parse Junie CLI version')
  })

  it('honors an environment source override without assigning the managed data directory', async () => {
    const binaryPath = await makeFake()
    managedMocks.ensureManagedNpmCli.mockResolvedValue(binaryPath)
    const ctx = {
      ctxId: 'ctx-init-env-source',
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_SOURCE__: 'system',
        __ONEWORKS_PROJECT_REAL_HOME__: cwd
      },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      },
      configs: [{ adapters: { junie: { cli: { source: 'managed' } } } }, undefined]
    } as AdapterCtx

    await expect(ensureJunieCli(ctx)).resolves.toBe(binaryPath)
    expect(ctx.env.__ONEWORKS_PROJECT_JUNIE_DATA__).toBeUndefined()
  })

  it('resolves the managed npm launcher to its isolated installed executable', async () => {
    await makeFake()
    const managedHome = join(cwd!, '.oneworks', 'bootstrap', 'npm', 'junie-runtime-home')
    const launcherPath = join(managedHome, '.local', 'bin', 'junie')
    const installedBinaryPath = join(managedHome, '.local', 'share', 'junie', 'current', 'junie')
    await mkdir(join(managedHome, '.local', 'bin'), { recursive: true })
    await mkdir(join(managedHome, '.local', 'share', 'junie', 'current'), { recursive: true })
    await writeFile(launcherPath, '#!/bin/sh\n# JUNIE_MANAGED_SHIM\n')
    await writeFile(
      installedBinaryPath,
      `#!${process.execPath}\nconsole.log('Junie version: 26.8.10 (2651.4)')\n`
    )
    await Promise.all([chmod(launcherPath, 0o755), chmod(installedBinaryPath, 0o755)])
    managedMocks.ensureManagedNpmCli.mockResolvedValue(launcherPath)
    const ctx = {
      ctxId: 'ctx-init-managed-launcher',
      cwd,
      env: { __ONEWORKS_PROJECT_REAL_HOME__: cwd },
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        stream: process.stderr,
        warn: () => undefined
      },
      configs: [{ adapters: { junie: { cli: { source: 'managed' } } } }, undefined]
    } as AdapterCtx

    const resolvedInstalledBinaryPath = await realpath(installedBinaryPath)
    await expect(ensureJunieCli(ctx)).resolves.toBe(resolvedInstalledBinaryPath)
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__).toBe(resolvedInstalledBinaryPath)
  })
})
