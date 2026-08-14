/* eslint-disable max-lines -- managed CLI resolver tests cover several source fallback combinations. */
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildManagedNpmCliChildEnv,
  buildManagedNpmCliInstallEnv,
  ensureManagedNpmCli,
  resolveManagedNpmCliBinaryPath,
  resolveManagedNpmCliInstallOptions,
  resolveManagedNpmCliPaths,
  resolveUserShellBinaryPath
} from '#~/managed-npm-cli.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('managed npm cli utils', () => {
  it('preserves inherited process env for legacy login-shell resolver callers', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-shell-binary-resolver-'))
    const shellPath = join(workspace, 'capture-shell')
    const recordPath = join(workspace, 'resolver-env.txt')
    const binaryPath = join(workspace, 'legacy-tool')
    const previousSentinel = process.env.ONEWORKS_LEGACY_RESOLVER_TEST
    process.env.ONEWORKS_LEGACY_RESOLVER_TEST = 'legacy-inherited-value'
    await writeFile(
      shellPath,
      `#!/bin/sh
/usr/bin/printenv ONEWORKS_LEGACY_RESOLVER_TEST > '${recordPath}'
printf '%s\n' '${binaryPath}'
`,
      'utf8'
    )
    await chmod(shellPath, 0o755)

    try {
      await expect(resolveUserShellBinaryPath({
        binaryName: 'legacy-tool',
        env: { SHELL: shellPath }
      })).resolves.toBe(binaryPath)
      await expect(readFile(recordPath, 'utf8')).resolves.toBe('legacy-inherited-value\n')
    } finally {
      if (previousSentinel == null) {
        delete process.env.ONEWORKS_LEGACY_RESOLVER_TEST
      } else {
        process.env.ONEWORKS_LEGACY_RESOLVER_TEST = previousSentinel
      }
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps legacy inheritance by default and enforces minimal allowlist plus tombstones when selected', () => {
    vi.stubEnv('FACTORY_API_KEY', 'process-factory-secret')
    vi.stubEnv('OPENAI_API_KEY', 'process-openai-secret')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'process-aws-secret')
    vi.stubEnv('GIT_INTERNAL_TOKEN', 'process-git-secret')
    vi.stubEnv('INTERNAL_CANARY', 'process-internal-secret')
    const projectEnv = {
      FACTORY_TOKEN: 'project-factory-secret',
      OPENAI_API_KEY: 'project-openai-secret',
      PATH: '/safe/bin',
      NPM_CONFIG_REGISTRY: 'https://registry.example.test'
    }

    const legacy = buildManagedNpmCliChildEnv({ cwd: '/workspace', env: projectEnv })
    expect(legacy).toEqual(expect.objectContaining({
      FACTORY_API_KEY: 'process-factory-secret',
      FACTORY_TOKEN: 'project-factory-secret',
      OPENAI_API_KEY: 'project-openai-secret',
      AWS_SECRET_ACCESS_KEY: 'process-aws-secret'
    }))

    const minimal = buildManagedNpmCliChildEnv({
      cwd: '/workspace',
      env: projectEnv,
      policy: {
        mode: 'minimal',
        tombstoneKeys: ['FACTORY_API_KEY', 'FACTORY_TOKEN'],
        tombstonePrefixes: ['FACTORY_']
      }
    })
    expect(minimal).toEqual(expect.objectContaining({
      PATH: '/safe/bin',
      NPM_CONFIG_REGISTRY: 'https://registry.example.test'
    }))
    for (
      const key of [
        'FACTORY_API_KEY',
        'FACTORY_TOKEN',
        'OPENAI_API_KEY',
        'AWS_SECRET_ACCESS_KEY',
        'GIT_INTERNAL_TOKEN',
        'INTERNAL_CANARY'
      ]
    ) expect(minimal[key]).toBeUndefined()
  })

  it('applies the selected child-env policy to user-shell discovery', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-shell-env-'))
    const shellPath = join(workspace, 'capture-shell')
    const minimalLog = join(workspace, 'minimal.log')
    const legacyLog = join(workspace, 'legacy.log')
    vi.stubEnv('FACTORY_API_KEY', 'process-factory-secret')
    vi.stubEnv('OPENAI_API_KEY', 'process-openai-secret')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'process-aws-secret')
    await writeFile(
      shellPath,
      `#!/bin/sh
printf '%s|%s|%s|%s\n' "\${FACTORY_API_KEY-unset}" "\${FACTORY_TOKEN-unset}" "\${OPENAI_API_KEY-unset}" "\${AWS_SECRET_ACCESS_KEY-unset}" >> "\${CAPTURE_LOG}"
printf '%s\n' '/safe/tool'
`
    )
    await chmod(shellPath, 0o755)

    try {
      await expect(resolveUserShellBinaryPath({
        binaryName: 'tool',
        childEnvPolicy: {
          mode: 'minimal',
          allowKeys: ['CAPTURE_LOG'],
          tombstoneKeys: ['FACTORY_API_KEY', 'FACTORY_TOKEN'],
          tombstonePrefixes: ['FACTORY_']
        },
        cwd: workspace,
        env: {
          SHELL: shellPath,
          CAPTURE_LOG: minimalLog,
          FACTORY_TOKEN: 'project-factory-secret',
          OPENAI_API_KEY: 'project-openai-secret'
        }
      })).resolves.toBe('/safe/tool')
      expect(await readFile(minimalLog, 'utf8')).toBe('unset|unset|unset|unset\n')

      await expect(resolveUserShellBinaryPath({
        binaryName: 'tool',
        cwd: workspace,
        env: {
          SHELL: shellPath,
          CAPTURE_LOG: legacyLog,
          FACTORY_TOKEN: 'project-factory-secret',
          OPENAI_API_KEY: 'project-openai-secret'
        }
      })).resolves.toBe('/safe/tool')
      expect(await readFile(legacyLog, 'utf8')).toBe(
        'process-factory-secret|project-factory-secret|project-openai-secret|process-aws-secret\n'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('does not reintroduce an inherited exact project home when building install env', () => {
    const previousWorkspace = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    const previousPrimary = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
    const previousExactHome = process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__

    try {
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '/workspace-a'
      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = '/workspace-a'
      process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

      const env: NodeJS.ProcessEnv = buildManagedNpmCliInstallEnv({
        cwd: '/workspace-b',
        env: {
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/workspace-b'
        },
        homeDir: '/isolated-cli-home',
        paths: {
          rootDir: '/cache-root',
          installDir: '/cache-root/install',
          cacheDir: '/cache-root/npm-cache',
          binDir: '/cache-root/bin',
          binaryPath: '/cache-root/bin/tool'
        }
      })

      expect(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe('/workspace-b')
      expect(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
      expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
      expect(env.HOME).toBe('/isolated-cli-home')
      expect(env.USERPROFILE).toBe('/isolated-cli-home')
      expect(env.npm_config_cache).toBe('/cache-root/npm-cache')
    } finally {
      if (previousWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspace
      }
      if (previousPrimary == null) {
        delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimary
      }
      if (previousExactHome == null) {
        delete process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = previousExactHome
      }
    }
  })

  it('resolves managed CLI paths from the global bootstrap package cache', () => {
    const paths = resolveManagedNpmCliPaths({
      adapterKey: 'codex',
      binaryName: 'codex',
      cwd: '/tmp/worktree',
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
      },
      packageName: '@openai/codex',
      version: '0.121.0'
    })

    expect(paths.rootDir).toBe('/tmp/home/.oneworks/bootstrap/npm')
    const [packageSegment, versionSegment] = relative(paths.rootDir, paths.installDir).split(sep)
    expect(packageSegment).toMatch(/^openai-codex--[0-9a-f]{64}$/u)
    expect(versionSegment).toMatch(/^0\.121\.0--[0-9a-f]{64}$/u)
    expect(paths.binaryPath).toBe(join(paths.installDir, 'node_modules/.bin/codex'))
  })

  it('omits caller-selected credentials from the final login-shell environment', async () => {
    if (process.platform === 'win32') return
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-shell-'))
    const shellPath = join(workspace, 'shell')
    const previousKey = process.env.DEEPSEEK_API_KEY
    const previousBaseUrl = process.env.DEEPSEEK_BASE_URL
    await writeFile(
      shellPath,
      `#!/bin/sh
if [ -n "$DEEPSEEK_API_KEY" ] || [ -n "$DEEPSEEK_BASE_URL" ]; then
  exit 91
fi
printf '%s\n' '/safe/tool'
`
    )
    await chmod(shellPath, 0o755)
    process.env.DEEPSEEK_API_KEY = 'host-key'
    process.env.DEEPSEEK_BASE_URL = 'https://host-secret.example.invalid'

    try {
      await expect(resolveUserShellBinaryPath({
        binaryName: 'tool',
        env: {
          DEEPSEEK_API_KEY: 'project-key',
          DEEPSEEK_BASE_URL: 'https://project-secret.example.invalid',
          SHELL: shellPath
        },
        omitKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']
      })).resolves.toBe('/safe/tool')
    } finally {
      if (previousKey == null) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previousKey
      if (previousBaseUrl == null) delete process.env.DEEPSEEK_BASE_URL
      else process.env.DEEPSEEK_BASE_URL = previousBaseUrl
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('separates managed CLI installs by extra install key segments', () => {
    const paths = resolveManagedNpmCliPaths({
      adapterKey: 'skills_cli',
      binaryName: 'skills',
      cwd: '/tmp/worktree',
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
      },
      installKey: ['registry', 'https://registry.example.com'],
      packageName: 'skills',
      version: 'latest'
    })

    const segments = relative(paths.rootDir, paths.installDir).split(sep)
    expect(segments).toHaveLength(4)
    expect(segments[0]).toMatch(/^registry--[0-9a-f]{64}$/u)
    expect(segments[1]).toMatch(/^https-registry\.example\.com--[0-9a-f]{64}$/u)
    expect(segments[2]).toMatch(/^skills--[0-9a-f]{64}$/u)
    expect(segments[3]).toMatch(/^latest--[0-9a-f]{64}$/u)
  })

  it('uses collision-resistant identity segments for scoped and custom package artifacts', () => {
    const base = {
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: '/tmp/worktree',
      env: { __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home' },
      version: '0.195.0'
    }
    const official = resolveManagedNpmCliPaths({ ...base, packageName: '@factory/cli' })
    const lookalike = resolveManagedNpmCliPaths({ ...base, packageName: 'factory-cli' })

    expect(official.installDir).not.toBe(lookalike.installDir)
    expect(relative(official.rootDir, official.installDir)).toMatch(
      /^factory-cli--[0-9a-f]{64}[/\\]0\.195\.0--[0-9a-f]{64}$/u
    )
    expect(relative(lookalike.rootDir, lookalike.installDir)).toMatch(
      /^factory-cli--[0-9a-f]{64}[/\\]0\.195\.0--[0-9a-f]{64}$/u
    )
  })

  it('does not migrate a compatible-looking legacy cache with the wrong package identity', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-identity-'))
    const home = join(workspace, 'home')
    const legacyInstallDir = join(home, '.oneworks/bootstrap/npm/factory-cli/0.195.0')
    const legacyBinary = join(legacyInstallDir, 'node_modules/.bin/droid')
    const lookalikePackageDir = join(legacyInstallDir, 'node_modules/factory-cli')
    const officialPackageDir = join(legacyInstallDir, 'node_modules/@factory/cli')
    await mkdir(join(legacyInstallDir, 'node_modules/.bin'), { recursive: true })
    await mkdir(lookalikePackageDir, { recursive: true })
    await mkdir(join(officialPackageDir, 'bin'), { recursive: true })
    await writeFile(legacyBinary, '#!/bin/sh\necho "droid 0.195.0"\n')
    await chmod(legacyBinary, 0o755)
    await writeFile(
      join(lookalikePackageDir, 'package.json'),
      JSON.stringify({ name: 'factory-cli', version: '0.195.0' })
    )
    await writeFile(join(officialPackageDir, 'bin/droid'), '#!/bin/sh\necho "droid 0.195.0"\n')
    await chmod(join(officialPackageDir, 'bin/droid'), 0o755)
    await writeFile(
      join(officialPackageDir, 'package.json'),
      JSON.stringify({ bin: { droid: 'bin/droid' }, name: '@factory/cli', version: '0.195.0' })
    )

    try {
      await expect(ensureManagedNpmCli({
        adapterKey: 'droid',
        binaryName: 'droid',
        cwd: workspace,
        defaultPackageName: '@factory/cli',
        defaultVersion: '0.195.0',
        env: {
          __ONEWORKS_PROJECT_ADAPTER_DROID_AUTO_INSTALL__: 'false',
          __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_SOURCE__: 'managed',
          __ONEWORKS_PROJECT_REAL_HOME__: home
        },
        logger: { info: () => undefined },
        versionRange: '>=0.195.0 <0.196.0'
      })).rejects.toThrow('automatic install is disabled')
      await expect(access(legacyBinary)).resolves.toBeUndefined()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('uses env version and package overrides when building install options', () => {
    expect(resolveManagedNpmCliInstallOptions({
      adapterKey: 'gemini',
      defaultPackageName: '@google/gemini-cli',
      defaultVersion: '0.38.2',
      env: {
        __ONEWORKS_PROJECT_ADAPTER_GEMINI_INSTALL_PACKAGE__: '@example/gemini',
        __ONEWORKS_PROJECT_ADAPTER_GEMINI_INSTALL_VERSION__: '1.2.3',
        __ONEWORKS_PROJECT_ADAPTER_GEMINI_CLI_SOURCE__: 'managed',
        __ONEWORKS_PROJECT_ADAPTER_GEMINI_NPM_PATH__: '/opt/npm'
      }
    })).toMatchObject({
      npmPath: '/opt/npm',
      packageName: '@example/gemini',
      packageSpec: '@example/gemini@1.2.3',
      source: 'managed',
      version: '1.2.3'
    })
  })

  it('returns the managed candidate path when source is forced to managed', () => {
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home',
      __ONEWORKS_PROJECT_ADAPTER_OPENCODE_CLI_SOURCE__: 'managed'
    }
    const params = {
      adapterKey: 'opencode',
      binaryName: 'opencode',
      cwd: '/tmp/worktree',
      defaultPackageName: 'opencode-ai',
      defaultVersion: '1.14.18',
      env
    }
    expect(resolveManagedNpmCliBinaryPath(params)).toBe(
      resolveManagedNpmCliPaths({
        adapterKey: params.adapterKey,
        binaryName: params.binaryName,
        cwd: params.cwd,
        env,
        packageName: params.defaultPackageName,
        version: params.defaultVersion
      }).binaryPath
    )
  })

  it('supports CLIs that use custom version arguments for managed install validation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const npmPath = join(workspace, 'npm')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done

if [ -z "$prefix" ]; then
  exit 2
fi

mkdir -p "$prefix/node_modules/.bin"
tool="$prefix/node_modules/.bin/tool"
{
  printf '%s\\n' '#!/bin/sh'
  printf '%s\\n' 'if [ "$1" = "version" ]; then echo "tool 1.0.0"; exit 0; fi'
  printf '%s\\n' 'exit 42'
} > "$tool"
chmod +x "$tool"
`
    )
    await chmod(npmPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_NPM_PATH__: npmPath
        },
        logger: {
          info: () => undefined
        },
        versionArgs: ['version']
      })

      expect(binaryPath.endsWith('/node_modules/.bin/tool')).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('can disable lifecycle scripts for managed CLI installs', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const npmPath = join(workspace, 'npm')
    const recordPath = join(workspace, 'install-args.txt')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

printf '%s\\n' "$@" > "$ONEWORKS_MANAGED_TEST_RECORD"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done

mkdir -p "$prefix/node_modules/.bin"
tool="$prefix/node_modules/.bin/tool"
{
  printf '%s\\n' '#!/bin/sh'
  printf '%s\\n' 'echo "tool 1.0.0"'
} > "$tool"
chmod +x "$tool"
`
    )
    await chmod(npmPath, 0o755)

    try {
      await ensureManagedNpmCli({
        adapterKey: 'script_safe_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          ONEWORKS_MANAGED_TEST_RECORD: recordPath,
          __ONEWORKS_PROJECT_ADAPTER_SCRIPT_SAFE_TOOL_NPM_PATH__: npmPath
        },
        ignoreInstallScripts: true,
        logger: { info: () => undefined }
      })

      expect((await readFile(recordPath, 'utf8')).trim().split('\n')).toContain('--ignore-scripts')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('omits caller-selected credentials from npm probes and install lifecycle environment', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const npmPath = join(workspace, 'npm')
    const recordPath = join(workspace, 'install-env.txt')
    const previousKey = process.env.DEEPSEEK_API_KEY
    const previousBaseUrl = process.env.DEEPSEEK_BASE_URL
    const previousUnrelatedSecret = process.env.UNRELATED_PROVIDER_SECRET
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ -n "$DEEPSEEK_API_KEY" ] || [ -n "$DEEPSEEK_BASE_URL" ] || [ -n "$UNRELATED_PROVIDER_SECRET" ]; then
  exit 91
fi
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

printf '%s|%s\n' "\${DEEPSEEK_API_KEY-unset}" "\${DEEPSEEK_BASE_URL-unset}" > "$ONEWORKS_MANAGED_TEST_RECORD"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$prefix/node_modules/.bin/tool"
chmod +x "$prefix/node_modules/.bin/tool"
`
    )
    await chmod(npmPath, 0o755)
    process.env.DEEPSEEK_API_KEY = 'host-key'
    process.env.DEEPSEEK_BASE_URL = 'https://host-secret.example.invalid'
    process.env.UNRELATED_PROVIDER_SECRET = 'must-not-reach-install'

    try {
      await ensureManagedNpmCli({
        adapterKey: 'credential_safe_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          DEEPSEEK_API_KEY: 'project-key',
          DEEPSEEK_BASE_URL: 'https://project-secret.example.invalid',
          HOME: workspace,
          ONEWORKS_MANAGED_TEST_RECORD: recordPath,
          __ONEWORKS_PROJECT_ADAPTER_CREDENTIAL_SAFE_TOOL_NPM_PATH__: npmPath
        },
        logger: { info: () => undefined },
        subprocessEnvAllowKeys: ['HOME', 'ONEWORKS_MANAGED_TEST_RECORD'],
        subprocessEnvOmitKeys: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']
      })

      expect((await readFile(recordPath, 'utf8')).trim()).toBe('unset|unset')
    } finally {
      if (previousKey == null) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previousKey
      if (previousBaseUrl == null) delete process.env.DEEPSEEK_BASE_URL
      else process.env.DEEPSEEK_BASE_URL = previousBaseUrl
      if (previousUnrelatedSecret == null) delete process.env.UNRELATED_PROVIDER_SECRET
      else process.env.UNRELATED_PROVIDER_SECRET = previousUnrelatedSecret
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('installs companion packages and validates the resulting composition', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const npmPath = join(workspace, 'npm')
    const recordPath = join(workspace, 'install-args.txt')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

printf '%s\\n' "$@" > "$ONEWORKS_MANAGED_TEST_RECORD"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done

mkdir -p "$prefix/node_modules/.bin"
tool="$prefix/node_modules/.bin/tool"
printf '%s\\n' '#!/bin/sh' 'exit 0' > "$tool"
chmod +x "$tool"
`
    )
    await chmod(npmPath, 0o755)
    const validatedPaths: string[] = []

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'composed_tool',
        binaryName: 'tool',
        companionPackageSpecs: ['@example/plugin-a@1.0.0', '@example/plugin-b@1.0.0'],
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          ONEWORKS_MANAGED_TEST_RECORD: recordPath,
          __ONEWORKS_PROJECT_ADAPTER_COMPOSED_TOOL_NPM_PATH__: npmPath
        },
        logger: { info: () => undefined },
        validateBinary: async (candidatePath) => {
          validatedPaths.push(candidatePath)
          return access(candidatePath).then(() => true, () => false)
        }
      })

      const installArgs = (await readFile(recordPath, 'utf8')).trim().split('\n')
      expect(installArgs).toContain('@example/tool@1.0.0')
      expect(installArgs).toContain('@example/plugin-a@1.0.0')
      expect(installArgs).toContain('@example/plugin-b@1.0.0')
      expect(validatedPaths).toContain(binaryPath)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('prefers the global managed install over a user PATH binary by default', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    const npmPath = join(workspace, 'npm')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done

if [ -z "$prefix" ]; then
  exit 2
fi

mkdir -p "$prefix/node_modules/.bin"
tool="$prefix/node_modules/.bin/tool"
{
  printf '%s\\n' '#!/bin/sh'
  printf '%s\\n' 'if [ "$1" = "--version" ]; then echo "managed 1.0.0"; exit 0; fi'
  printf '%s\\n' 'exit 42'
} > "$tool"
chmod +x "$tool"
`
    )
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "system 0.1.0"
  exit 0
fi
exit 42
`
    )
    await chmod(npmPath, 0o755)
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`,
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_NPM_PATH__: npmPath
        },
        logger: {
          info: () => undefined
        }
      })

      expect(binaryPath).not.toBe('tool')
      expect(binaryPath).toMatch(
        /[/\\]\.oneworks[/\\]bootstrap[/\\]npm[/\\]example-tool--[0-9a-f]{64}[/\\]1\.0\.0--[0-9a-f]{64}[/\\]/u
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('can prefer a user PATH binary when it satisfies a minimum version', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "system 2.0.0"
  exit 0
fi
exit 42
`
    )
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`
        },
        logger: {
          info: () => undefined
        },
        minimumVersion: '1.0.0',
        preferSystem: true
      })

      expect(binaryPath).toBe('tool')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('can prefer a user PATH binary when it satisfies a semver range', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.142.0-alpha.6"
  exit 0
fi
exit 42
`
    )
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: 'latest',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`
        },
        logger: {
          info: () => undefined
        },
        preferSystem: true,
        versionRange: '>=0.130.0'
      })

      expect(binaryPath).toBe('tool')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('can prefer an extra system binary path when PATH is below range', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    const appToolPath = join(workspace, 'Applications/Tool.app/Contents/Resources/tool')
    await mkdir(systemBinDir, { recursive: true })
    await mkdir(join(workspace, 'Applications/Tool.app/Contents/Resources'), { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.120.0"
  exit 0
fi
exit 42
`
    )
    await writeFile(
      appToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.142.0-alpha.6"
  exit 0
fi
exit 42
`
    )
    await chmod(systemToolPath, 0o755)
    await chmod(appToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: 'latest',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`
        },
        logger: {
          info: () => undefined
        },
        preferSystem: true,
        systemBinaryPaths: [appToolPath],
        versionRange: '>=0.130.0'
      })

      expect(binaryPath).toBe(await realpath(appToolPath))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects an extra system binary path when it is outside range', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const appToolPath = join(workspace, 'Applications/Tool.app/Contents/Resources/tool')
    await mkdir(join(workspace, 'Applications/Tool.app/Contents/Resources'), { recursive: true })
    await writeFile(
      appToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.120.0"
  exit 0
fi
exit 42
`
    )
    await chmod(appToolPath, 0o755)

    try {
      await expect(ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: 'latest',
        env: {
          HOME: workspace,
          PATH: '',
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_CLI_SOURCE__: 'system'
        },
        logger: {
          info: () => undefined
        },
        systemBinaryPaths: [appToolPath],
        versionRange: '>=0.130.0'
      })).rejects.toThrow('version requirement >=0.130.0')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('skips a bundled fallback when it is outside range', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const bundledToolPath = join(workspace, 'bundled', 'tool')
    const systemToolPath = join(workspace, 'system', 'tool')
    await mkdir(join(workspace, 'bundled'), { recursive: true })
    await mkdir(join(workspace, 'system'), { recursive: true })
    await writeFile(
      bundledToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.120.0"
  exit 0
fi
exit 42
`
    )
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tool 0.142.0"
  exit 0
fi
exit 42
`
    )
    await chmod(bundledToolPath, 0o755)
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        bundledPath: bundledToolPath,
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: 'latest',
        env: {
          HOME: workspace,
          PATH: '',
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_AUTO_INSTALL__: 'false'
        },
        logger: {
          info: () => undefined
        },
        systemBinaryPaths: [systemToolPath],
        versionRange: '>=0.130.0'
      })

      expect(binaryPath).toBe(await realpath(systemToolPath))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('skips a preferred user PATH binary when it is below the minimum version', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    const npmPath = join(workspace, 'npm')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi

prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix="$1"
  fi
  shift
done

if [ -z "$prefix" ]; then
  exit 2
fi

mkdir -p "$prefix/node_modules/.bin"
tool="$prefix/node_modules/.bin/tool"
{
  printf '%s\\n' '#!/bin/sh'
  printf '%s\\n' 'if [ "$1" = "--version" ]; then echo "managed 1.0.0"; exit 0; fi'
  printf '%s\\n' 'exit 42'
} > "$tool"
chmod +x "$tool"
`
    )
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "system 0.5.0"
  exit 0
fi
exit 42
`
    )
    await chmod(npmPath, 0o755)
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`,
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_NPM_PATH__: npmPath
        },
        logger: {
          info: () => undefined
        },
        minimumVersion: '1.0.0',
        preferSystem: true
      })

      expect(binaryPath).not.toBe('tool')
      expect(binaryPath).toMatch(
        /[/\\]\.oneworks[/\\]bootstrap[/\\]npm[/\\]example-tool--[0-9a-f]{64}[/\\]1\.0\.0--[0-9a-f]{64}[/\\]/u
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('falls back to PATH when the global managed install is stale', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    const env = {
      PATH: `${systemBinDir}:${process.env.PATH ?? ''}`,
      __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_AUTO_INSTALL__: 'false',
      __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'home')
    }
    const globalPaths = resolveManagedNpmCliPaths({
      adapterKey: 'custom_tool',
      binaryName: 'tool',
      cwd: workspace,
      env,
      packageName: '@example/tool',
      version: '1.0.0'
    })
    await mkdir(globalPaths.binDir, { recursive: true })
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(globalPaths.binaryPath, '#!/bin/sh\nexit 1\n')
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "system 0.1.0"
  exit 0
fi
exit 42
`
    )
    await chmod(globalPaths.binaryPath, 0o755)
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env,
        logger: {
          info: () => undefined
        }
      })

      expect(binaryPath).toBe('tool')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('falls back to an existing legacy workspace managed install', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const legacyCacheDir = join(workspace, '.oo/caches')
    const legacyBinDir = join(legacyCacheDir, 'adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/.bin')
    const legacyToolPath = join(legacyBinDir, 'tool')
    const legacyPackageDir = join(
      legacyCacheDir,
      'adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/@example/tool'
    )
    const legacyPackageBinary = join(legacyPackageDir, 'bin/tool')
    await mkdir(legacyBinDir, { recursive: true })
    await mkdir(join(legacyPackageDir, 'bin'), { recursive: true })
    await writeFile(
      legacyPackageBinary,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "legacy 1.0.0"
  exit 0
fi
exit 42
`
    )
    await chmod(legacyPackageBinary, 0o755)
    await symlink('../@example/tool/bin/tool', legacyToolPath)
    await writeFile(
      join(legacyPackageDir, 'package.json'),
      JSON.stringify({ bin: { tool: 'bin/tool' }, name: '@example/tool', version: '1.0.0' })
    )

    try {
      expect(resolveManagedNpmCliBinaryPath({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          __ONEWORKS_PROJECT_CACHE_DIR__: legacyCacheDir,
          __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'home')
        }
      })).toBe(await realpath(legacyToolPath))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('moves an existing legacy workspace managed install into the global cache', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const legacyCacheDir = join(workspace, '.oo/caches')
    const legacyBinDir = join(legacyCacheDir, 'adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/.bin')
    const legacyToolPath = join(legacyBinDir, 'tool')
    const legacyPackageDir = join(
      legacyCacheDir,
      'adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/@example/tool'
    )
    const legacyPackageBinary = join(legacyPackageDir, 'bin/tool')
    const env = {
      __ONEWORKS_PROJECT_CACHE_DIR__: legacyCacheDir,
      __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_AUTO_INSTALL__: 'false',
      __ONEWORKS_PROJECT_REAL_HOME__: join(workspace, 'home')
    }
    const globalPaths = resolveManagedNpmCliPaths({
      adapterKey: 'custom_tool',
      binaryName: 'tool',
      cwd: workspace,
      env,
      packageName: '@example/tool',
      version: '1.0.0'
    })
    await mkdir(globalPaths.binDir, { recursive: true })
    await writeFile(globalPaths.binaryPath, '#!/bin/sh\nexit 1\n')
    await chmod(globalPaths.binaryPath, 0o755)
    await mkdir(legacyBinDir, { recursive: true })
    await mkdir(join(legacyPackageDir, 'bin'), { recursive: true })
    await writeFile(
      legacyPackageBinary,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "legacy 1.0.0"
  exit 0
fi
exit 42
`
    )
    await chmod(legacyPackageBinary, 0o755)
    await symlink('../@example/tool/bin/tool', legacyToolPath)
    await writeFile(
      join(legacyPackageDir, 'package.json'),
      JSON.stringify({ bin: { tool: 'bin/tool' }, name: '@example/tool', version: '1.0.0' })
    )

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env,
        logger: {
          info: () => undefined
        }
      })

      expect(await realpath(binaryPath)).toBe(await realpath(globalPaths.binaryPath))
      await expect(access(globalPaths.binaryPath)).resolves.toBeUndefined()
      await expect(access(legacyToolPath)).rejects.toThrow()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('uses the user PATH binary when source is explicitly system', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "system 0.1.0"
  exit 0
fi
exit 42
`
    )
    await chmod(systemToolPath, 0o755)

    try {
      const binaryPath = await ensureManagedNpmCli({
        adapterKey: 'custom_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`,
          __ONEWORKS_PROJECT_ADAPTER_CUSTOM_TOOL_CLI_SOURCE__: 'system'
        },
        logger: {
          info: () => undefined
        }
      })

      expect(binaryPath).toBe('tool')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps minimal probe children isolated while preserving legacy inheritance by default', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-env-'))
    const systemBinDir = join(workspace, 'system-bin')
    const systemToolPath = join(systemBinDir, 'tool')
    const recordPath = join(workspace, 'probe-env.jsonl')
    const sentinelEntries = {
      OPENAI_API_KEY: 'sentinel-openai',
      AWS_SECRET_ACCESS_KEY: 'sentinel-aws',
      AZURE_OPENAI_API_KEY: 'sentinel-azure',
      GITHUB_TOKEN: 'sentinel-git',
      INTERNAL_SECRET: 'sentinel-internal'
    }
    const previousEntries = Object.fromEntries(
      Object.keys(sentinelEntries).map(key => [key, process.env[key]])
    )
    Object.assign(process.env, sentinelEntries)
    await mkdir(systemBinDir, { recursive: true })
    await writeFile(
      systemToolPath,
      `#!${process.execPath}
const { appendFileSync } = require('node:fs')
appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.env) + '\\n')
console.log('tool 1.0.0')
`
    )
    await chmod(systemToolPath, 0o755)

    try {
      const baseParams = {
        adapterKey: 'env_probe_tool',
        binaryName: 'tool',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          PATH: `${systemBinDir}:${process.env.PATH ?? ''}`,
          REQUIRED_BASIC: 'present',
          __ONEWORKS_PROJECT_ADAPTER_ENV_PROBE_TOOL_CLI_SOURCE__: 'system'
        },
        logger: { info: () => undefined }
      }
      await expect(ensureManagedNpmCli({
        ...baseParams,
        childEnvPolicy: 'minimal'
      })).resolves.toBe('tool')
      await expect(ensureManagedNpmCli(baseParams)).resolves.toBe('tool')

      const [minimalEnv, legacyEnv] = (await readFile(recordPath, 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as NodeJS.ProcessEnv)
      expect(minimalEnv).toEqual(expect.objectContaining({
        HOME: workspace,
        REQUIRED_BASIC: 'present'
      }))
      for (const key of Object.keys(sentinelEntries)) expect(minimalEnv).not.toHaveProperty(key)
      expect(legacyEnv).toEqual(expect.objectContaining(sentinelEntries))
    } finally {
      for (const [key, value] of Object.entries(previousEntries)) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('uses the minimal environment for npm install, lifecycle descendants, and managed probes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-install-env-'))
    const npmPath = join(workspace, 'npm')
    const recordPath = join(workspace, 'install-env.jsonl')
    const managedToolSource = `#!${process.execPath}
const { appendFileSync } = require('node:fs')
appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ stage: 'managed-probe', env: process.env }) + '\\n')
console.log('tool 1.0.0')
`
    const sentinelEntries = {
      JUNIE_API_KEY: 'sentinel-junie',
      OPENAI_API_KEY: 'sentinel-openai',
      AWS_SECRET_ACCESS_KEY: 'sentinel-aws',
      AZURE_OPENAI_API_KEY: 'sentinel-azure',
      GITHUB_TOKEN: 'sentinel-git',
      INTERNAL_SECRET: 'sentinel-internal'
    }
    const previousEntries = Object.fromEntries(
      Object.keys(sentinelEntries).map(key => [key, process.env[key]])
    )
    Object.assign(process.env, sentinelEntries)
    await writeFile(
      npmPath,
      `#!${process.execPath}
const { appendFileSync, chmodSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const stage = args[0] === '--version' ? 'npm-version' : 'npm-install'
appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ stage, env: process.env }) + '\\n')
if (stage === 'npm-version') {
  console.log('10.0.0')
  process.exit(0)
}
spawnSync(process.execPath, ['-e', ${
        JSON.stringify(
          `require('node:fs').appendFileSync(${
            JSON.stringify(recordPath)
          }, JSON.stringify({ stage: 'postinstall-child', env: process.env }) + '\\n')`
        )
      }], { env: process.env, stdio: 'inherit' })
const prefix = args[args.indexOf('--prefix') + 1]
const binDir = join(prefix, 'node_modules', '.bin')
mkdirSync(binDir, { recursive: true })
const toolPath = join(binDir, 'tool')
writeFileSync(toolPath, ${JSON.stringify(managedToolSource)})
chmodSync(toolPath, 0o755)
`
    )
    await chmod(npmPath, 0o755)

    try {
      await expect(ensureManagedNpmCli({
        adapterKey: 'minimal_install_tool',
        binaryName: 'tool',
        childEnvPolicy: 'minimal',
        cwd: workspace,
        defaultPackageName: '@example/tool',
        defaultVersion: '1.0.0',
        env: {
          HOME: workspace,
          PATH: process.env.PATH,
          __ONEWORKS_PROJECT_ADAPTER_MINIMAL_INSTALL_TOOL_CLI_SOURCE__: 'managed',
          __ONEWORKS_PROJECT_ADAPTER_MINIMAL_INSTALL_TOOL_NPM_PATH__: npmPath,
          __ONEWORKS_PROJECT_REAL_HOME__: workspace
        },
        installHomeDir: join(workspace, 'isolated-home'),
        logger: { info: () => undefined }
      })).resolves.toContain('/node_modules/.bin/tool')

      const records = (await readFile(recordPath, 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { env: NodeJS.ProcessEnv; stage: string })
      expect(records.map(record => record.stage)).toEqual(expect.arrayContaining([
        'npm-version',
        'npm-install',
        'postinstall-child',
        'managed-probe'
      ]))
      for (const record of records) {
        expect(record.env.HOME).toBe(
          record.stage === 'npm-version' ? workspace : join(workspace, 'isolated-home')
        )
        for (const key of Object.keys(sentinelEntries)) expect(record.env).not.toHaveProperty(key)
      }
    } finally {
      for (const [key, value] of Object.entries(previousEntries)) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('uses the minimal environment for login-shell system discovery', async () => {
    if (process.platform === 'win32') return
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-shell-env-'))
    const shellPath = join(workspace, 'capture-shell')
    const binaryPath = join(workspace, 'system-tool')
    const recordPath = join(workspace, 'shell-env.json')
    const previousSecret = process.env.INTERNAL_SECRET
    process.env.INTERNAL_SECRET = 'sentinel-internal'
    await writeFile(
      shellPath,
      `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.env))
console.log(${JSON.stringify(binaryPath)})
`
    )
    await chmod(shellPath, 0o755)

    try {
      await expect(resolveUserShellBinaryPath({
        binaryName: 'tool',
        childEnvPolicy: 'minimal',
        env: {
          HOME: workspace,
          PATH: process.env.PATH,
          SHELL: shellPath
        }
      })).resolves.toBe(binaryPath)
      const childEnv = JSON.parse(await readFile(recordPath, 'utf8')) as NodeJS.ProcessEnv
      expect(childEnv).toEqual(expect.objectContaining({ HOME: workspace, SHELL: shellPath }))
      expect(childEnv).not.toHaveProperty('INTERNAL_SECRET')
    } finally {
      if (previousSecret == null) delete process.env.INTERNAL_SECRET
      else process.env.INTERNAL_SECRET = previousSecret
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
