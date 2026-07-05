import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveLocalRuntimePackage, shouldResolveCliAdapterPackage } from '../src/package-launcher'

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  vi.unstubAllEnvs()
})

describe('bootstrap package launcher', () => {
  it('resolves adapter packages when the loader only defaulted CLI package dir to bootstrap itself', () => {
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', '/runtime/bootstrap')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', '/runtime/bootstrap')

    expect(shouldResolveCliAdapterPackage()).toBe(true)
  })

  it('preserves an explicit external CLI package dir', () => {
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', '/runtime/bootstrap')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', '/runtime/adapter-cache')

    expect(shouldResolveCliAdapterPackage()).toBe(false)
  })

  it('does not resolve adapter packages when a local CLI package dir is available outside the server package dir', () => {
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', '/runtime/server')

    expect(shouldResolveCliAdapterPackage('/runtime/node_modules/@oneworks/cli')).toBe(false)
  })

  it('resolves local runtime packages from the package dir when the workspace cwd has no package install', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'oneworks-bootstrap-package-launcher-'))
    const runtimeDir = path.join(tempDir, 'runtime')
    const workspaceDir = path.join(tempDir, 'workspace')
    const cliPackageDir = path.join(runtimeDir, 'node_modules/@oneworks/cli')
    await mkdir(cliPackageDir, { recursive: true })
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(path.join(runtimeDir, 'package.json'), '{"private":true}\n')
    await writeFile(path.join(workspaceDir, 'package.json'), '{"private":true}\n')
    await writeFile(
      path.join(cliPackageDir, 'package.json'),
      JSON.stringify({
        name: '@oneworks/cli',
        version: '0.0.0-packaged-smoke'
      })
    )
    process.chdir(workspaceDir)
    vi.stubEnv('__ONEWORKS_BOOTSTRAP_PREFER_LOCAL_RUNTIME__', 'true')
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', runtimeDir)

    expect(resolveLocalRuntimePackage('@oneworks/cli')).toEqual({
      packageDir: await realpath(cliPackageDir),
      version: '0.0.0-packaged-smoke'
    })
  })
})
