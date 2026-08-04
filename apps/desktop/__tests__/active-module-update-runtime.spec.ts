import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  isPackaged: true
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.resolve(__dirname, '..'),
    get isPackaged() {
      return electronMock.isPackaged
    }
  }
}))

afterEach(() => {
  electronMock.isPackaged = true
  vi.resetModules()
})

describe('desktop activated module updates', () => {
  it('prefers explicitly activated client and server updates over the bundled desktop cache', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-active-runtime-'))
    try {
      const bundledClientDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/dev-packaged/node_modules/@oneworks/client'
      )
      const bundledServerDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/dev-packaged/node_modules/@oneworks/server'
      )
      const activeClientDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/3.5.0/node_modules/@oneworks/client'
      )
      const activeServerDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/3.5.0/node_modules/@oneworks/server'
      )
      const olderClientDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/3.3.0/node_modules/@oneworks/client'
      )
      const olderServerDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/3.3.0/node_modules/@oneworks/server'
      )
      const equalClientDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/active-same-version/node_modules/@oneworks/client'
      )
      const equalServerDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/active-same-version/node_modules/@oneworks/server'
      )
      for (
        const [packageDir, name, version] of [
          [bundledClientDir, '@oneworks/client', '3.4.0'],
          [bundledServerDir, '@oneworks/server', '3.4.0'],
          [activeClientDir, '@oneworks/client', '3.5.0'],
          [activeServerDir, '@oneworks/server', '3.5.0'],
          [olderClientDir, '@oneworks/client', '3.3.0'],
          [olderServerDir, '@oneworks/server', '3.3.0'],
          [equalClientDir, '@oneworks/client', '3.4.0'],
          [equalServerDir, '@oneworks/server', '3.4.0']
        ]
      ) {
        await mkdir(packageDir, { recursive: true })
        await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
      }
      await mkdir(path.join(bundledClientDir, 'dist'), { recursive: true })
      await mkdir(path.join(activeClientDir, 'dist'), { recursive: true })
      await mkdir(path.join(olderClientDir, 'dist'), { recursive: true })
      await mkdir(path.join(equalClientDir, 'dist'), { recursive: true })
      await writeFile(path.join(bundledClientDir, 'dist/index.html'), '<!doctype html>', 'utf8')
      await writeFile(path.join(activeClientDir, 'dist/index.html'), '<!doctype html>', 'utf8')
      await writeFile(path.join(olderClientDir, 'dist/index.html'), '<!doctype html>', 'utf8')
      await writeFile(path.join(equalClientDir, 'dist/index.html'), '<!doctype html>', 'utf8')

      const metadataDir = path.join(tempDir, '.oneworks/bootstrap/module-updates')
      await mkdir(metadataDir, { recursive: true })
      await writeFile(
        path.join(metadataDir, 'oneworks__client.json'),
        JSON.stringify({
          packageDir: activeClientDir,
          packageName: '@oneworks/client',
          updatedAt: '2026-07-30T00:00:00.000Z',
          version: '3.5.0'
        }),
        'utf8'
      )
      await writeFile(
        path.join(metadataDir, 'oneworks__server.json'),
        JSON.stringify({
          packageDir: activeServerDir,
          packageName: '@oneworks/server',
          updatedAt: '2026-07-30T00:00:00.000Z',
          version: '3.5.0'
        }),
        'utf8'
      )

      const { resolveCachedServerPackageEnv, resolveClientDistPath } = await import('../src/main/paths')
      const runtimeEnv = {
        __ONEWORKS_PROJECT_REAL_HOME__: tempDir,
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-packaged'
      }

      expect(resolveClientDistPath(runtimeEnv)).toBe(path.join(activeClientDir, 'dist'))
      expect(resolveCachedServerPackageEnv(runtimeEnv)).toEqual({
        __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: activeServerDir
      })

      await writeFile(
        path.join(metadataDir, 'oneworks__client.json'),
        JSON.stringify({
          packageDir: olderClientDir,
          packageName: '@oneworks/client',
          updatedAt: '2026-07-30T00:01:00.000Z',
          version: '3.3.0'
        }),
        'utf8'
      )
      await writeFile(
        path.join(metadataDir, 'oneworks__server.json'),
        JSON.stringify({
          packageDir: olderServerDir,
          packageName: '@oneworks/server',
          updatedAt: '2026-07-30T00:01:00.000Z',
          version: '3.3.0'
        }),
        'utf8'
      )

      expect(resolveClientDistPath(runtimeEnv)).toBe(path.join(bundledClientDir, 'dist'))
      expect(resolveCachedServerPackageEnv(runtimeEnv)).toEqual({
        __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: bundledServerDir
      })

      await writeFile(
        path.join(metadataDir, 'oneworks__client.json'),
        JSON.stringify({
          packageDir: equalClientDir,
          packageName: '@oneworks/client',
          updatedAt: '2026-07-30T00:02:00.000Z',
          version: '3.4.0'
        }),
        'utf8'
      )
      await writeFile(
        path.join(metadataDir, 'oneworks__server.json'),
        JSON.stringify({
          packageDir: equalServerDir,
          packageName: '@oneworks/server',
          updatedAt: '2026-07-30T00:02:00.000Z',
          version: '3.4.0'
        }),
        'utf8'
      )

      expect(resolveClientDistPath(runtimeEnv)).toBe(path.join(bundledClientDir, 'dist'))
      expect(resolveCachedServerPackageEnv(runtimeEnv)).toEqual({
        __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: bundledServerDir
      })
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
