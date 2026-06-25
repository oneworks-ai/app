import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePackageManagerEnv, resolvePublishedPackageVersion } from '../src/npm-package'

describe('bootstrap npm package env', () => {
  const originalCwd = process.cwd()
  const originalPath = process.env.PATH
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-bootstrap-npm-'))
    process.chdir(tempDir)
    vi.restoreAllMocks()
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempDir)
    vi.stubEnv('ONEWORKS_BOOTSTRAP_DISABLE_BACKGROUND_REFRESH', '1')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', undefined)
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_LOOKUP_TIMEOUT_MS', '1000')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_TAG', undefined)
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_VERSION', undefined)
    vi.stubEnv('NPM_CONFIG_USERCONFIG', undefined)
    vi.stubEnv('npm_config_userconfig', undefined)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(tempDir, { force: true, recursive: true })
  })

  const installFakeNpm = async () => {
    const binDir = path.join(tempDir, 'bin')
    const npmBin = path.join(binDir, 'npm')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      npmBin,
      `#!/usr/bin/env node
const delay = Number.parseInt(process.env.ONEWORKS_TEST_NPM_VIEW_DELAY_MS || '0', 10)
const version = process.env.ONEWORKS_TEST_NPM_VIEW_VERSION || '1.0.0'
const exactVersions = JSON.parse(process.env.ONEWORKS_TEST_NPM_VIEW_EXACT_VERSIONS || '{}')
const versions = JSON.parse(process.env.ONEWORKS_TEST_NPM_VIEW_VERSIONS || '[]')
if (process.argv[2] === 'view') {
  const spec = process.argv[3]
  const field = process.argv[4]
  setTimeout(() => {
    if (field === 'versions') {
      process.stdout.write(JSON.stringify(versions.length > 0 ? versions : [version]) + '\\n')
      return
    }
    if (Object.prototype.hasOwnProperty.call(exactVersions, spec)) {
      process.stdout.write(JSON.stringify(exactVersions[spec]) + '\\n')
      return
    }
    if (process.env.ONEWORKS_TEST_NPM_VIEW_FAIL_EXACT === '1' && /@\\d+\\.\\d+\\.\\d+/.test(spec)) {
      process.stderr.write('not found\\n')
      process.exitCode = 1
      return
    }
    process.stdout.write(JSON.stringify(version) + '\\n')
  }, delay)
} else {
  process.exit(1)
}
`,
      'utf8'
    )
    await chmod(npmBin, 0o755)
    vi.stubEnv('PATH', [binDir, originalPath].filter(Boolean).join(path.delimiter))
  }

  const writeCachedPackage = async (packageName: string, version: string) => {
    const sanitizedName = packageName.replace(/^@/, '').replace(/[\\/]/g, '__')
    const packageDir = path.join(
      tempDir,
      '.oneworks/bootstrap/npm',
      sanitizedName,
      version,
      'node_modules',
      ...packageName.split('/')
    )
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }),
      'utf8'
    )
  }

  it('uses the project npmrc as npm userconfig', async () => {
    const projectNpmrc = path.join(process.cwd(), '.npmrc')
    await writeFile(projectNpmrc, '@oneworks:registry=https://registry.npmjs.org/\n')

    const env = resolvePackageManagerEnv()

    expect(env.NPM_CONFIG_USERCONFIG).toBe(projectNpmrc)
    expect(env.npm_config_userconfig).toBe(projectNpmrc)
    expect(env.NPM_CONFIG_REPLACE_REGISTRY_HOST).toBe('never')
    expect(env.npm_config_replace_registry_host).toBe('never')
  })

  it('keeps an explicit npm userconfig override', async () => {
    const explicitUserConfig = path.join(tempDir, 'custom.npmrc')
    await writeFile(path.join(tempDir, '.npmrc'), '@oneworks:registry=https://registry.npmjs.org/\n')
    vi.stubEnv('NPM_CONFIG_USERCONFIG', explicitUserConfig)

    const env = resolvePackageManagerEnv()

    expect(env.NPM_CONFIG_USERCONFIG).toBe(explicitUserConfig)
    expect(env.npm_config_userconfig).toBe(explicitUserConfig)
  })

  it('records fast npm view results for later launches', async () => {
    await installFakeNpm()
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', '0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '1.2.3')

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('1.2.3')

    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '2.0.0')
    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('2.0.0')
  })

  it('uses cached package versions without blocking on npm view by default', async () => {
    await installFakeNpm()
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '1.2.3')

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('1.2.3')

    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '9.9.9')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_DELAY_MS', '200')
    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('1.2.3')
  })

  it('uses installed package cache before npm view when no metadata exists', async () => {
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_TAG', 'latest')
    await writeCachedPackage('@scope/pkg', '4.5.6')

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('4.5.6')
  })

  it('uses cached package versions when npm view exceeds the startup budget in refresh-first mode', async () => {
    await installFakeNpm()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', '0')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_LOOKUP_TIMEOUT_MS', '20')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '1.2.3')

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('1.2.3')

    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '9.9.9')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_DELAY_MS', '200')
    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('1.2.3')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timed out after 20ms'))
  })

  it('prefers the exact bootstrap prerelease version for runtime package resolution', async () => {
    await installFakeNpm()
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', '0')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_VERSION', '0.1.0-beta.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '0.1.0-alpha.0')
    vi.stubEnv(
      'ONEWORKS_TEST_NPM_VIEW_EXACT_VERSIONS',
      JSON.stringify({
        '@scope/pkg@0.1.0-beta.0': '0.1.0-beta.0'
      })
    )

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('0.1.0-beta.0')
  })

  it('falls back to the highest same-core bootstrap prerelease version', async () => {
    await installFakeNpm()
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', '0')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_VERSION', '0.1.0-beta.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_FAIL_EXACT', '1')
    vi.stubEnv(
      'ONEWORKS_TEST_NPM_VIEW_VERSIONS',
      JSON.stringify([
        '0.1.0-alpha.9',
        '0.1.0-beta.1',
        '0.1.0-beta.2',
        '0.1.0-rc.0',
        '0.1.0',
        '0.1.1-beta.0'
      ])
    )

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('0.1.0-beta.2')
  })

  it('does not use an installed alpha cache for bootstrap beta resolution', async () => {
    await installFakeNpm()
    await writeCachedPackage('@scope/pkg', '0.1.0-alpha.0')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_VERSION', '0.1.0-beta.0')
    vi.stubEnv(
      'ONEWORKS_TEST_NPM_VIEW_EXACT_VERSIONS',
      JSON.stringify({
        '@scope/pkg@0.1.0-beta.0': '0.1.0-beta.0'
      })
    )

    await expect(resolvePublishedPackageVersion('@scope/pkg')).resolves.toBe('0.1.0-beta.0')
  })

  it('waits for npm view when no cached package version exists yet', async () => {
    await installFakeNpm()
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_VERSION', '3.0.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VIEW_DELAY_MS', '50')

    await expect(resolvePublishedPackageVersion('@scope/uncached')).resolves.toBe('3.0.0')
  })
})
