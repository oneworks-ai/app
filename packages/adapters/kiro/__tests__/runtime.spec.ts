import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import { kiroAdapterConfigSchema } from '../src/config-schema'
import { mapKiroHookInputToOneWorks } from '../src/hook-bridge'
import {
  assertKiroInstallVersion,
  resolveKiroManagedBinaryPath,
  resolveKiroManagedRootDir,
  resolveKiroManagedVersionDir
} from '../src/paths'
import {
  assertSafeKiroArchivePath,
  assertSafeKiroManifestCliPath,
  ensureKiroCli,
  extractVerifiedKiroPackage,
  probeKiroBinary,
  replaceKiroInstallDirectory,
  selectKiroManifestPackage
} from '../src/runtime/init'
import { buildKiroCapabilityMatrix, createKiroSession } from '../src/runtime/session'
import { mapKiroMcpServers, prepareKiroSessionRuntime } from '../src/runtime/shared'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-kiro-cli.mjs')
const tempDirs: string[] = []
const execFileAsync = promisify(execFile)

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oneworks-kiro-runtime-'))
  tempDirs.push(dir)
  return dir
}

const createContext = (params: {
  config?: Record<string, unknown>
  env?: AdapterCtx['env']
  root: string
}): AdapterCtx => ({
  ctxId: 'ctx-runtime',
  cwd: params.root,
  env: {
    __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(params.root, '.oneworks-projects'),
    __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(params.root, '.bootstrap'),
    __ONEWORKS_PROJECT_REAL_HOME__: join(params.root, 'real-home'),
    ...params.env
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: '' })
  },
  configs: [params.config as never, undefined],
  logger: {
    stream: new PassThrough(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('kiro CLI acquisition', () => {
  it.each(['../outside', '/tmp/outside', 'nested/version', 'nested\\version', '.', '..', 'latest'])(
    'rejects unsafe or non-exact managed version %s',
    (version) => {
      expect(() => assertKiroInstallVersion(version)).toThrow('Invalid Kiro CLI version')
      expect(() =>
        resolveKiroManagedVersionDir({
          __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: '/tmp/kiro-cache'
        }, version)
      ).toThrow('Invalid Kiro CLI version')
    }
  )

  it('selects only official platform packages from a checksum manifest', () => {
    const manifest = {
      version: '2.18.0',
      packages: [
        {
          os: 'linux',
          architecture: 'x86_64',
          fileType: 'tarXz',
          variant: 'headless',
          download: '2.18.0/kiro.tar.xz',
          sha256: 'abc'
        },
        {
          os: 'macos',
          architecture: 'universal',
          fileType: 'dmg',
          variant: 'full',
          download: '2.18.0/Kiro CLI.dmg',
          sha256: 'def',
          cliPath: 'Contents/MacOS/kiro-cli'
        }
      ]
    }
    expect(selectKiroManifestPackage(manifest, 'linux', 'x64').download).toContain('kiro.tar.xz')
    expect(selectKiroManifestPackage(manifest, 'darwin', 'arm64').fileType).toBe('dmg')
    expect(() => selectKiroManifestPackage(manifest, 'win32', 'x64')).toThrow('unsupported')
  })

  it.each([
    '../outside',
    '/absolute/outside',
    'nested/../../outside',
    'C:\\outside\\kiro-cli',
    '\\\\server\\share\\kiro-cli',
    'nested\\kiro-cli'
  ])('rejects unsafe archive and DMG manifest paths %s', (unsafePath) => {
    expect(() => assertSafeKiroArchivePath(unsafePath, 'test entry')).toThrow('Unsafe Kiro')
    expect(() => assertSafeKiroManifestCliPath(unsafePath)).toThrow('Unsafe Kiro')
  })

  it('rejects a valid-digest tar.xz with an escaping link before extraction and cleans staging', async () => {
    const root = await createTempDir()
    const sourceDir = join(root, 'source')
    const archivePath = join(root, 'malicious.tar.xz')
    const extractDir = join(root, 'extract')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'kiro-cli'), '#!/bin/sh\n', 'utf8')
    await symlink('../../outside', join(sourceDir, 'escape'))
    await execFileAsync('tar', ['-cJf', archivePath, '-C', sourceDir, '.'])
    await mkdir(extractDir, { recursive: true })
    const checksum = createHash('sha256').update(await readFile(archivePath)).digest('hex')

    await expect(extractVerifiedKiroPackage({
      archivePath,
      expectedSha256: checksum,
      extractDir,
      manifestPackage: {
        architecture: 'aarch64',
        download: 'malicious.tar.xz',
        fileType: 'tarXz',
        os: 'linux',
        sha256: checksum,
        variant: 'headless'
      }
    })).rejects.toThrow('escapes the extraction root')
    expect(await readdir(extractDir)).toEqual([])
  })

  it('extracts a valid-digest contained tar.xz into staging', async () => {
    const root = await createTempDir()
    const sourceDir = join(root, 'source')
    const archivePath = join(root, 'contained.tar.xz')
    const extractDir = join(root, 'extract')
    await mkdir(sourceDir, { recursive: true })
    await copyFile(fixturePath, join(sourceDir, 'kiro-cli'))
    await chmod(join(sourceDir, 'kiro-cli'), 0o755)
    await execFileAsync('tar', ['-cJf', archivePath, '-C', sourceDir, '.'])
    await mkdir(extractDir, { recursive: true })
    const checksum = createHash('sha256').update(await readFile(archivePath)).digest('hex')

    const extracted = await extractVerifiedKiroPackage({
      archivePath,
      expectedSha256: checksum,
      extractDir,
      manifestPackage: {
        architecture: 'aarch64',
        download: 'contained.tar.xz',
        fileType: 'tarXz',
        os: 'linux',
        sha256: checksum,
        variant: 'headless'
      }
    })
    expect(extracted).toBe(join(extractDir, 'kiro-cli'))
    expect(await realpath(extracted!)).toBe(await realpath(join(extractDir, 'kiro-cli')))
  })

  it('rejects a valid-digest DMG with an escaping manifest cliPath before mounting', async () => {
    const root = await createTempDir()
    const archivePath = join(root, 'malicious.dmg')
    const extractDir = join(root, 'extract')
    await writeFile(archivePath, 'not-mounted-because-cliPath-is-rejected-first', 'utf8')
    await mkdir(extractDir, { recursive: true })
    const checksum = createHash('sha256').update(await readFile(archivePath)).digest('hex')

    await expect(extractVerifiedKiroPackage({
      archivePath,
      expectedSha256: checksum,
      extractDir,
      manifestPackage: {
        architecture: 'universal',
        cliPath: '../../../outside/kiro-cli',
        download: 'malicious.dmg',
        fileType: 'dmg',
        os: 'macos',
        sha256: checksum,
        variant: 'full'
      }
    })).rejects.toThrow('Unsafe Kiro manifest cliPath')
    expect(await readdir(extractDir)).toEqual([])
  })

  it('restores the previous managed install when final staging validation fails', async () => {
    const root = await createTempDir()
    const versionsDir = join(root, 'versions')
    const finalDir = join(versionsDir, '2.18.0')
    const stagedDir = join(versionsDir, '.staged')
    await mkdir(finalDir, { recursive: true })
    await mkdir(stagedDir, { recursive: true })
    await writeFile(join(finalDir, 'marker'), 'previous-install', 'utf8')
    await writeFile(join(stagedDir, 'marker'), 'invalid-new-install', 'utf8')

    await expect(replaceKiroInstallDirectory({
      finalDir,
      stagedDir,
      versionsDir,
      validate: async () => false
    })).rejects.toThrow('final executable probe')
    expect(await readFile(join(finalDir, 'marker'), 'utf8')).toBe('previous-install')
    expect((await readdir(versionsDir)).filter(name => name.startsWith('.backup-'))).toEqual([])
  })

  it('probes configured path and system sources for ACP support', async () => {
    const root = await createTempDir()
    await mkdir(root, { recursive: true })
    expect(await probeKiroBinary(fixturePath, process.env)).toBe('kiro-cli 9.9.9-test')

    const pathCtx = createContext({
      root,
      config: { adapters: { kiro: { cli: { source: 'path', path: fixturePath } } } }
    })
    await expect(ensureKiroCli(pathCtx)).resolves.toBe(fixturePath)

    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    await symlink(fixturePath, join(binDir, 'kiro-cli'))
    const systemCtx = createContext({
      root,
      config: { adapters: { kiro: { cli: { source: 'system' } } } },
      env: { PATH: `${binDir}:${process.env.PATH ?? ''}` }
    })
    await expect(ensureKiroCli(systemCtx)).resolves.toBe('kiro-cli')
  })

  it('reuses only a contained managed binary from the checksummed manifest version', async () => {
    const root = await createTempDir()
    const env = { __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(root, '.bootstrap') }
    const versionDir = resolveKiroManagedVersionDir(env, '2.18.0')
    const binaryPath = join(versionDir, process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli')
    await mkdir(versionDir, { recursive: true })
    await copyFile(fixturePath, binaryPath)
    await chmod(binaryPath, 0o755)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ packages: [], version: '2.18.0' })
      })
    )
    const ctx = createContext({
      root,
      config: { adapters: { kiro: { cli: { autoInstall: false, source: 'managed' } } } },
      env
    })

    await expect(ensureKiroCli(ctx)).resolves.toBe(await realpath(binaryPath))

    await rm(binaryPath)
    await symlink(fixturePath, binaryPath)
    expect(() => resolveKiroManagedBinaryPath(env, '2.18.0')).toThrow('escaped')
  })

  it.runIf(process.platform !== 'win32')(
    'rejects symlinked managed roots/ancestors before executing an outside binary',
    async () => {
      for (const attack of ['managed-root', 'versions', 'version'] as const) {
        const root = await createTempDir()
        const env = { __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(root, '.bootstrap') }
        const managedRoot = resolveKiroManagedRootDir(env)
        const versionsDir = join(managedRoot, 'versions')
        const versionDir = join(versionsDir, '2.18.0')
        const outsideRoot = join(root, `outside-${attack}`)
        const sentinel = join(root, 'outside-sentinel')
        await writeFile(sentinel, 'safe', 'utf8')

        const executableRoot = attack === 'managed-root'
          ? join(outsideRoot, 'versions', '2.18.0')
          : attack === 'versions'
          ? join(outsideRoot, '2.18.0')
          : outsideRoot
        await mkdir(executableRoot, { recursive: true })
        const outsideExecutable = join(executableRoot, 'kiro-cli')
        await writeFile(
          outsideExecutable,
          `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')\n`,
          'utf8'
        )
        await chmod(outsideExecutable, 0o755)

        if (attack === 'managed-root') {
          await mkdir(dirname(managedRoot), { recursive: true })
          await symlink(outsideRoot, managedRoot, 'dir')
        } else if (attack === 'versions') {
          await mkdir(managedRoot, { recursive: true })
          await symlink(outsideRoot, versionsDir, 'dir')
        } else {
          await mkdir(versionsDir, { recursive: true })
          await symlink(outsideRoot, versionDir, 'dir')
        }

        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ packages: [], version: '2.18.0' })
          })
        )
        const ctx = createContext({
          root,
          config: { adapters: { kiro: { cli: { autoInstall: false, source: 'managed' } } } },
          env
        })

        await expect(ensureKiroCli(ctx)).rejects.toThrow('Unsafe Kiro managed directory')
        expect(await readFile(sentinel, 'utf8')).toBe('safe')
      }
    }
  )

  it('rejects special managed executable entries', async () => {
    const root = await createTempDir()
    const env = { __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(root, '.bootstrap') }
    const versionDir = resolveKiroManagedVersionDir(env, '2.18.0')
    await mkdir(join(versionDir, 'kiro-cli'), { recursive: true })

    expect(() => resolveKiroManagedBinaryPath(env, '2.18.0')).toThrow('Unsafe Kiro managed executable')
  })
})

describe('kiro isolated runtime assets', () => {
  it('stages a fresh private HOME, durable KIRO_HOME, native assets, and process-only auth', async () => {
    const root = await createTempDir()
    const skillDir = join(root, 'skill')
    const realHome = join(root, 'real-home')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# Research\n', 'utf8')
    await mkdir(join(realHome, 'Library', 'Keychains'), { recursive: true })
    await writeFile(join(realHome, 'Library', 'Keychains', 'test.keychain'), 'not-a-real-secret', 'utf8')
    const ctx = createContext({
      root,
      config: {
        adapters: {
          kiro: {
            configContent: { telemetry: false },
            agentConfig: { description: 'Configured One Works agent', name: '../../outside-agent' }
          }
        }
      },
      env: {
        KIRO_API_KEY: 'test-secret-not-for-disk',
        __ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__: '1',
        __ONEWORKS_PROJECT_KIRO_HOOK_COMMAND__: 'node call-hook.js'
      }
    })
    const options: AdapterQueryOptions = {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-assets',
      systemPrompt: 'Follow the project rules.',
      assetPlan: {
        adapter: 'kiro',
        diagnostics: [],
        mcpServers: {},
        overlays: [{
          assetId: 'skill:research',
          kind: 'skill',
          sourcePath: skillDir,
          targetPath: 'skills/research'
        }]
      },
      onEvent: () => undefined
    }
    const runtime = await prepareKiroSessionRuntime(ctx, options, {
      configContent: { telemetry: false },
      agentConfig: { description: 'Configured One Works agent', name: '../../outside-agent' }
    })

    expect(runtime.env.KIRO_HOME).toBe(runtime.kiroHome)
    expect(runtime.env.HOME).not.toBe(realHome)
    expect(runtime.env.HOME).not.toContain('adapter-kiro/home')
    expect(runtime.env.KIRO_API_KEY).toBe('test-secret-not-for-disk')
    expect(await readlink(join(runtime.kiroHome, 'skills', 'research'))).toBe(skillDir)
    expect(JSON.parse(await readFile(join(runtime.kiroHome, 'settings', 'cli.json'), 'utf8'))).toEqual({
      telemetry: false
    })
    expect(await readFile(join(runtime.kiroHome, 'steering', 'oneworks-system.md'), 'utf8'))
      .toContain('Follow the project rules.')
    const agent = JSON.parse(await readFile(join(runtime.kiroHome, 'agents', 'oneworks.json'), 'utf8'))
    expect(agent).toEqual(expect.objectContaining({
      description: 'Configured One Works agent',
      name: 'oneworks',
      includeMcpJson: false,
      hooks: expect.objectContaining({ preToolUse: expect.any(Array) })
    }))
    const diskContent = [
      await readFile(join(runtime.kiroHome, 'settings', 'cli.json'), 'utf8'),
      await readFile(join(runtime.kiroHome, 'agents', 'oneworks.json'), 'utf8')
    ].join('\n')
    expect(diskContent).not.toContain('test-secret-not-for-disk')
    await expect(readFile(join(runtime.env.HOME!, 'Library', 'Keychains'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(realHome, 'Library', 'Keychains', 'test.keychain'), 'utf8'))
      .toBe('not-a-real-secret')
  })

  it('maps stdio MCP and reports every remote transport as skipped', () => {
    const servers = {
      local: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'runtime-only' } },
      remote: { type: 'http' as const, url: 'https://example.test/mcp', headers: { Authorization: 'runtime-only' } },
      events: { type: 'sse' as const, url: 'https://example.test/events', headers: {} }
    }
    expect(mapKiroMcpServers(servers)).toEqual({
      servers: [expect.objectContaining({ name: 'local' })],
      skippedServerNames: ['remote', 'events']
    })
  })
})

describe('kiro capability and config contracts', () => {
  it('fails direct mode before spawn when a non-default model cannot be verified', async () => {
    const root = await createTempDir()
    await expect(createKiroSession(createContext({ root }), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-direct-model',
      mode: 'direct',
      model: 'unverified-native-id',
      onEvent: () => undefined
    })).rejects.toThrow('cannot verify or apply a non-default native model')
  })

  it('derives a closed capability matrix from initialize', () => {
    expect(buildKiroCapabilityMatrix({
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { additionalDirectories: {}, close: false, resume: false }
      }
    })).toEqual({
      loadSession: true,
      resumeSession: false,
      closeSession: false,
      additionalDirectories: true
    })
  })

  it('validates native CLI and raw config schema', () => {
    expect(kiroAdapterConfigSchema.parse({
      cli: { source: 'system' },
      configContent: { telemetry: false },
      additionalDirs: ['/workspace/shared']
    })).toEqual(expect.objectContaining({ additionalDirs: ['/workspace/shared'] }))
  })

  it('maps Kiro native hooks without changing their blocking boundary', () => {
    expect(mapKiroHookInputToOneWorks({
      hook_event_name: 'preToolUse',
      cwd: '/workspace',
      tool_name: 'write_file',
      tool_input: { path: 'a.ts' }
    })).toEqual(expect.objectContaining({
      adapter: 'kiro',
      canBlock: true,
      hookEventName: 'PreToolUse',
      toolName: 'write_file'
    }))
  })
})
