/* eslint-disable max-lines -- managed CLI resolver tests cover several source fallback combinations. */
import { access, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildManagedNpmCliInstallEnv,
  ensureManagedNpmCli,
  resolveManagedNpmCliBinaryPath,
  resolveManagedNpmCliInstallOptions,
  resolveManagedNpmCliPaths
} from '#~/managed-npm-cli.js'

describe('managed npm cli utils', () => {
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

    expect(paths.binaryPath).toBe(
      '/tmp/home/.oneworks/bootstrap/npm/openai-codex/0.121.0/node_modules/.bin/codex'
    )
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

    expect(paths.binaryPath).toBe(
      '/tmp/home/.oneworks/bootstrap/npm/registry/https-registry.example.com/skills/latest/node_modules/.bin/skills'
    )
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
    expect(resolveManagedNpmCliBinaryPath({
      adapterKey: 'opencode',
      binaryName: 'opencode',
      cwd: '/tmp/worktree',
      defaultPackageName: 'opencode-ai',
      defaultVersion: '1.14.18',
      env
    })).toBe(
      '/tmp/home/.oneworks/bootstrap/npm/opencode-ai/1.14.18/node_modules/.bin/opencode'
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
      expect(binaryPath).toContain('/.oneworks/bootstrap/npm/example-tool/1.0.0/')
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
      expect(binaryPath).toContain('/.oneworks/bootstrap/npm/example-tool/1.0.0/')
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
    await mkdir(legacyBinDir, { recursive: true })
    await writeFile(
      legacyToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "legacy 1.0.0"
  exit 0
fi
exit 42
`
    )
    await chmod(legacyToolPath, 0o755)

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
      })).toContain('/.oo/caches/adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/.bin/tool')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('moves an existing legacy workspace managed install into the global cache', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ow-managed-npm-cli-'))
    const legacyCacheDir = join(workspace, '.oo/caches')
    const legacyBinDir = join(legacyCacheDir, 'adapter-custom_tool/cli/npm/example-tool/1.0.0/node_modules/.bin')
    const legacyToolPath = join(legacyBinDir, 'tool')
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
    await writeFile(
      legacyToolPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "legacy 1.0.0"
  exit 0
fi
exit 42
`
    )
    await chmod(legacyToolPath, 0o755)

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

      expect(binaryPath).toContain('/.oneworks/bootstrap/npm/example-tool/1.0.0/')
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
})
