import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { loadOrTransformSync, resolveCompilerConfigFingerprint, resolveRuntimeTranspileCacheDir } = require(
  '../runtime-transpile-cache.js'
) as typeof import('../runtime-transpile-cache.js')

describe('runtime transpile cache', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
  })

  it('reuses a content-addressed transform across calls', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-transpile-cache-'))
    tempDirs.push(cacheDir)
    const transform = vi.fn(() => 'module.exports = 42')
    const input = {
      cacheDir,
      code: 'export default 42',
      filename: '/fixture/entry.ts',
      options: { format: 'cjs', loader: 'ts' },
      transform,
      transformVersion: 'test'
    }

    expect(loadOrTransformSync(input)).toBe('module.exports = 42')
    expect(loadOrTransformSync(input)).toBe('module.exports = 42')
    expect(transform).toHaveBeenCalledOnce()
    expect((await readdir(cacheDir)).length).toBe(1)
  })

  it('separates cache entries when source content changes', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-transpile-cache-'))
    tempDirs.push(cacheDir)
    const transform = vi.fn(() => `compiled-${transform.mock.calls.length}`)
    const input = {
      cacheDir,
      filename: '/fixture/entry.ts',
      options: { format: 'cjs', loader: 'ts' },
      transform,
      transformVersion: 'test'
    }

    expect(loadOrTransformSync({ ...input, code: 'export default 1' })).toBe('compiled-1')
    expect(loadOrTransformSync({ ...input, code: 'export default 2' })).toBe('compiled-2')
    expect(transform).toHaveBeenCalledTimes(2)
  })

  it('separates cache entries when the resolved compiler config changes', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-transpile-cache-'))
    tempDirs.push(cacheDir)
    const transform = vi.fn(() => `compiled-${transform.mock.calls.length}`)
    const input = {
      cacheDir,
      code: 'module.exports = <fixture />',
      filename: '/fixture/entry.tsx',
      options: { format: 'cjs', loader: 'tsx' },
      transform,
      transformVersion: 'test'
    }

    expect(loadOrTransformSync({ ...input, compilerConfigFingerprint: 'jsx-a' })).toBe('compiled-1')
    expect(loadOrTransformSync({ ...input, compilerConfigFingerprint: 'jsx-b' })).toBe('compiled-2')
    expect(transform).toHaveBeenCalledTimes(2)
  })

  it('fingerprints resolved extends inputs rather than only the nearest tsconfig', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-tsconfig-'))
    tempDirs.push(tempDir)
    const configDir = path.join(tempDir, 'config')
    const sourceDir = path.join(tempDir, 'src')
    await Promise.all([
      mkdir(configDir, { recursive: true }),
      mkdir(sourceDir, { recursive: true }),
      writeFile(
        path.join(tempDir, 'tsconfig.json'),
        JSON.stringify({ extends: './config/base.json' })
      ),
      writeFile(
        path.join(configDir, 'base.json'),
        JSON.stringify({ compilerOptions: { jsxFactory: 'fixtureA' } })
      )
    ])
    const filename = path.join(sourceDir, 'entry.tsx')
    const firstFingerprint = resolveCompilerConfigFingerprint(filename)

    await writeFile(
      path.join(configDir, 'base.json'),
      JSON.stringify({ compilerOptions: { jsxFactory: 'fixtureB' } })
    )

    expect(resolveCompilerConfigFingerprint(filename)).not.toBe(firstFingerprint)
  })

  it('falls back to raw config content when a packaged extends target is unavailable', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-tsconfig-'))
    tempDirs.push(tempDir)
    const sourceDir = path.join(tempDir, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ extends: '../../missing/tsconfig.base.json' })
    )

    expect(() => resolveCompilerConfigFingerprint(path.join(sourceDir, 'entry.ts'))).not.toThrow()
  })

  it('only enables the default cache for a versioned runtime', () => {
    expect(resolveRuntimeTranspileCacheDir({ HOME: '/tmp/home' })).toBeUndefined()
    expect(resolveRuntimeTranspileCacheDir({
      HOME: '/tmp/home',
      __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-build'
    })).toBe(`/tmp/home/.oneworks/bootstrap/transpile-cache/dev-build/node-${process.versions.node}`)
  })
})
