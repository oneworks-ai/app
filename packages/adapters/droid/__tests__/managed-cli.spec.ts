import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureManagedNpmCli, resolveManagedNpmCliPaths } from '@oneworks/utils/managed-npm-cli'

import prepareDroidCli from '../src/cli-prepare'
import { DROID_CLI_PACKAGE, DROID_CLI_VERSION, DROID_CLI_VERSION_ENV, DROID_CLI_VERSION_RANGE } from '../src/paths'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('factory Droid managed CLI', () => {
  it('does not reuse a legacy lookalike package whose normalized cache key collides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-cache-identity-'))
    tempDirs.push(root)
    const legacyInstall = join(root, '.oneworks/bootstrap/npm/factory-cli/0.195.0')
    const legacyBinary = join(legacyInstall, 'node_modules/.bin/droid')
    const legacyPackage = join(legacyInstall, 'node_modules/factory-cli')
    const legacyLog = join(root, 'legacy-used.log')
    await mkdir(join(legacyInstall, 'node_modules/.bin'), { recursive: true })
    await mkdir(legacyPackage, { recursive: true })
    await writeFile(legacyBinary, `#!/bin/sh\necho used >> "${legacyLog}"\necho "droid 0.195.0"\n`)
    await chmod(legacyBinary, 0o755)
    await writeFile(
      join(legacyPackage, 'package.json'),
      JSON.stringify({ name: 'factory-cli', version: DROID_CLI_VERSION })
    )

    const installedBinary = join(root, 'installed-droid')
    await writeFile(installedBinary, '#!/bin/sh\necho "droid 0.195.0"\n')
    await chmod(installedBinary, 0o755)
    const npmPath = join(root, 'fake-npm')
    const npmLog = join(root, 'npm.log')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "10.0.0"; exit 0; fi
echo "$*" >> "${npmLog}"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then shift; prefix="$1"; fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cp "${installedBinary}" "$prefix/node_modules/.bin/droid"
chmod +x "$prefix/node_modules/.bin/droid"
`
    )
    await chmod(npmPath, 0o755)

    const result = await prepareDroidCli.prepare({
      cwd: root,
      env: { __ONEWORKS_PROJECT_REAL_HOME__: root },
      configs: [{ adapters: { droid: { cli: { source: 'managed', npmPath } } } }, undefined],
      logger: { info: () => undefined }
    })

    expect(result.binaryPath).not.toBe(legacyBinary)
    expect(await readFile(npmLog, 'utf8')).toContain(`${DROID_CLI_PACKAGE}@${DROID_CLI_VERSION}`)
    await expect(readFile(legacyLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not let adapter prepare substitute the cached default artifact for a custom managed identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-custom-identity-'))
    tempDirs.push(root)
    const env: Record<string, string> = { __ONEWORKS_PROJECT_REAL_HOME__: root }
    const defaultPaths = resolveManagedNpmCliPaths({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      env,
      packageName: DROID_CLI_PACKAGE,
      version: DROID_CLI_VERSION
    })
    const defaultLog = join(root, 'default-cache-used.log')
    await mkdir(defaultPaths.binDir, { recursive: true })
    await writeFile(
      defaultPaths.binaryPath,
      `#!/bin/sh
echo used >> "${defaultLog}"
echo "droid 0.195.0"
`
    )
    await chmod(defaultPaths.binaryPath, 0o755)

    const customBinarySource = join(root, 'custom-droid')
    await writeFile(customBinarySource, '#!/bin/sh\necho "droid 0.195.8"\n')
    await chmod(customBinarySource, 0o755)
    const npmPath = join(root, 'fake-npm')
    const npmLog = join(root, 'npm.log')
    await writeFile(
      npmPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "10.0.0"; exit 0; fi
echo "$*" >> "${npmLog}"
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then shift; prefix="$1"; fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cp "${customBinarySource}" "$prefix/node_modules/.bin/droid"
chmod +x "$prefix/node_modules/.bin/droid"
`
    )
    await chmod(npmPath, 0o755)

    const result = await prepareDroidCli.prepare({
      cwd: root,
      env,
      configs: [{
        adapters: {
          droid: {
            cli: {
              source: 'managed',
              package: '@fixture/custom-factory-cli',
              version: '9.8.7',
              npmPath
            }
          }
        }
      }, undefined],
      logger: { info: () => undefined }
    })

    expect(result.binaryPath).not.toBe(defaultPaths.binaryPath)
    expect(await readFile(npmLog, 'utf8')).toContain('@fixture/custom-factory-cli@9.8.7')
    await expect(readFile(defaultLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses contribution-layered nested CLI config during adapter prepare', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-prepare-layers-'))
    tempDirs.push(root)
    const projectBinary = join(root, 'project-droid')
    await writeFile(projectBinary, '#!/bin/sh\necho "droid 0.195.3"\n')
    await chmod(projectBinary, 0o755)
    const effectiveProjectConfig = {
      adapters: { droid: { cli: { source: 'path' as const, path: projectBinary } } }
    }
    const userConfig = {
      adapters: { droid: { cli: { autoInstall: false } } }
    }
    const projectSnapshot = structuredClone(effectiveProjectConfig)
    const userSnapshot = structuredClone(userConfig)

    const result = await prepareDroidCli.prepare(
      {
        cwd: root,
        env: { __ONEWORKS_PROJECT_REAL_HOME__: root },
        configs: [effectiveProjectConfig, userConfig],
        configState: {
          effectiveProjectConfig,
          projectConfig: { adapters: { droid: { cli: { path: '/raw/source/path' } } } },
          userConfig,
          mergedConfig: { adapters: { droid: { cli: { autoInstall: false } } } }
        },
        logger: { info: () => undefined }
      } as Parameters<typeof prepareDroidCli.prepare>[0]
    )

    expect(result.binaryPath).toBe(projectBinary)
    expect(effectiveProjectConfig).toEqual(projectSnapshot)
    expect(userConfig).toEqual(userSnapshot)
  })

  it('uses the minimal child env for explicit adapter prepare probes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-prepare-env-'))
    tempDirs.push(root)
    const binaryPath = join(root, 'droid')
    const envLog = join(root, 'prepare-env.log')
    await writeFile(
      binaryPath,
      `#!/bin/sh
printf '%s|%s|%s|%s|%s|%s|%s\n' "\${FACTORY_API_KEY-unset}" "\${FACTORY_TOKEN-unset}" "\${OPENAI_API_KEY-unset}" "\${AWS_SECRET_ACCESS_KEY-unset}" "\${GIT_INTERNAL_TOKEN-unset}" "\${INTERNAL_CANARY-unset}" "\${CTX_INTERNAL_CANARY-unset}" >> "${envLog}"
echo 'droid 0.195.6'
`
    )
    await chmod(binaryPath, 0o755)
    vi.stubEnv('FACTORY_API_KEY', 'process-factory-secret')
    vi.stubEnv('FACTORY_TOKEN', 'process-factory-token')
    vi.stubEnv('OPENAI_API_KEY', 'process-openai-secret')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'process-aws-secret')
    vi.stubEnv('GIT_INTERNAL_TOKEN', 'process-git-secret')
    vi.stubEnv('INTERNAL_CANARY', 'process-internal-secret')
    const env: Record<string, string> = {
      __ONEWORKS_PROJECT_REAL_HOME__: root,
      AWS_SECRET_ACCESS_KEY: 'ctx-aws-secret',
      CTX_INTERNAL_CANARY: 'ctx-internal-secret',
      FACTORY_API_KEY: 'ctx-factory-secret',
      FACTORY_TOKEN: 'ctx-factory-token'
    }

    const result = await prepareDroidCli.prepare({
      cwd: root,
      env,
      configs: [{ adapters: { droid: { cli: { source: 'path', path: binaryPath } } } }, undefined],
      logger: { info: () => undefined }
    })

    expect(result.binaryPath).toBe(binaryPath)
    expect(env[DROID_CLI_VERSION_ENV]).toBe('0.195.6')
    expect((await readFile(envLog, 'utf8')).trim().split('\n')).toEqual([
      'unset|unset|unset|unset|unset|unset|unset',
      'unset|unset|unset|unset|unset|unset|unset'
    ])
  })

  it('contains untrusted package/version path segments inside the bootstrap cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-managed-paths-'))
    tempDirs.push(root)
    const paths = resolveManagedNpmCliPaths({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      env: { __ONEWORKS_PROJECT_REAL_HOME__: root },
      packageName: '../../outside/@factory/cli',
      version: '../../0.195.0'
    })
    const relativeInstall = relative(paths.rootDir, paths.installDir)
    expect(isAbsolute(relativeInstall)).toBe(false)
    expect(relativeInstall).not.toMatch(/(^|[/\\])\.\.([/\\]|$)/u)
    expect(paths.binaryPath.startsWith(`${paths.rootDir}/`)).toBe(true)
  })

  it('removes staging state when the managed npm install fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-managed-failure-'))
    tempDirs.push(root)
    const npmPath = join(root, 'fake-npm')
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
mkdir -p "$prefix/node_modules/.bin"
printf '%s\\n' '#!/bin/sh' 'echo "droid 0.195.0"' > "$prefix/node_modules/.bin/droid"
exit 23
`
    )
    await chmod(npmPath, 0o755)
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: root,
      __ONEWORKS_PROJECT_ADAPTER_DROID_NPM_PATH__: npmPath,
      __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_SOURCE__: 'managed'
    }
    const paths = resolveManagedNpmCliPaths({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      env,
      packageName: DROID_CLI_PACKAGE,
      version: DROID_CLI_VERSION
    })

    await expect(ensureManagedNpmCli({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      defaultPackageName: DROID_CLI_PACKAGE,
      defaultVersion: DROID_CLI_VERSION,
      env,
      logger: { info: () => undefined },
      validateExplicitPathVersion: true,
      versionRange: DROID_CLI_VERSION_RANGE
    })).rejects.toMatchObject({ code: 23 })

    const parentEntries = await readdir(dirname(paths.installDir))
      .catch(() => [])
    expect(parentEntries.some(entry => entry.includes('.tmp-'))).toBe(false)
  })

  it('rejects an explicit Droid binary outside the pinned version range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-explicit-version-'))
    tempDirs.push(root)
    const binaryPath = join(root, 'explicit-droid')
    await writeFile(binaryPath, '#!/bin/sh\necho "droid 0.194.9"\n')
    await chmod(binaryPath, 0o755)
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: root,
      __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__: binaryPath
    }

    await expect(ensureManagedNpmCli({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      defaultPackageName: DROID_CLI_PACKAGE,
      defaultVersion: DROID_CLI_VERSION,
      env,
      logger: { info: () => undefined },
      validateExplicitPathVersion: true,
      versionRange: DROID_CLI_VERSION_RANGE
    })).rejects.toThrow(`does not satisfy version requirement ${DROID_CLI_VERSION_RANGE}`)

    await writeFile(binaryPath, '#!/bin/sh\necho "droid 0.195.0"\n')
    await expect(ensureManagedNpmCli({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      defaultPackageName: DROID_CLI_PACKAGE,
      defaultVersion: DROID_CLI_VERSION,
      env,
      logger: { info: () => undefined },
      validateExplicitPathVersion: true,
      versionRange: DROID_CLI_VERSION_RANGE
    })).resolves.toBe(binaryPath)
  })

  it('removes a committed managed install when post-install validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-managed-invalid-'))
    tempDirs.push(root)
    const npmPath = join(root, 'fake-npm')
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
mkdir -p "$prefix/node_modules/.bin"
printf '%s\\n' '#!/bin/sh' 'echo "droid 0.194.9"' > "$prefix/node_modules/.bin/droid"
chmod +x "$prefix/node_modules/.bin/droid"
exit 0
`
    )
    await chmod(npmPath, 0o755)
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: root,
      __ONEWORKS_PROJECT_ADAPTER_DROID_NPM_PATH__: npmPath,
      __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_SOURCE__: 'managed'
    }
    const paths = resolveManagedNpmCliPaths({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      env,
      packageName: DROID_CLI_PACKAGE,
      version: DROID_CLI_VERSION
    })

    await expect(ensureManagedNpmCli({
      adapterKey: 'droid',
      binaryName: 'droid',
      cwd: root,
      defaultPackageName: DROID_CLI_PACKAGE,
      defaultVersion: DROID_CLI_VERSION,
      env,
      logger: { info: () => undefined },
      versionRange: DROID_CLI_VERSION_RANGE
    })).rejects.toThrow('managed binary could not be executed')
    await expect(stat(paths.installDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
