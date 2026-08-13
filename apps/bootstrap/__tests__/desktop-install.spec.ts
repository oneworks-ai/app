import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureDesktopInstall } from '../src/desktop-install'

const mocks = vi.hoisted(() => ({
  downloadReleaseAsset: vi.fn(),
  fetchDesktopRelease: vi.fn(),
  selectDesktopAsset: vi.fn()
}))

vi.mock('../src/desktop-release', () => mocks)

describe('desktop install path identity', () => {
  const originalPlatform = process.platform
  const originalLocalAppData = process.env.LOCALAPPDATA
  const originalRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
  const directories: string[] = []

  afterEach(async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
    if (originalLocalAppData == null) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = originalLocalAppData
    if (originalRealHome == null) delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    else process.env.__ONEWORKS_PROJECT_REAL_HOME__ = originalRealHome
    vi.clearAllMocks()
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('installs into the exact whitespace-bearing LOCALAPPDATA root and persists that identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-bootstrap-install-'))
    directories.push(root)
    const realHome = path.join(root, 'home')
    const exactLocalAppData = path.join(root, 'local appdata ')
    const adjacentLocalAppData = path.join(root, 'local appdata')
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHome
    process.env.LOCALAPPDATA = exactLocalAppData
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    mocks.fetchDesktopRelease.mockResolvedValue({
      assets: [{ name: 'oneworks.exe', url: 'https://example.test/app.exe' }],
      tagName: 'v1'
    })
    mocks.selectDesktopAsset.mockReturnValue({ name: 'oneworks.exe', url: 'https://example.test/app.exe' })
    mocks.downloadReleaseAsset.mockImplementation(async (_asset: unknown, destinationPath: string) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'exact executable')
    })

    const install = await ensureDesktopInstall('user')
    const expectedPath = path.join(exactLocalAppData, 'Programs', 'One Works', 'oneworks.exe')
    const metadataPath = path.join(realHome, '.oneworks', 'bootstrap', 'desktop', 'user.json')

    expect(install).toMatchObject({ executablePath: expectedPath, installedPath: expectedPath })
    await expect(readFile(expectedPath, 'utf8')).resolves.toBe('exact executable')
    await expect(readFile(metadataPath, 'utf8')).resolves.toContain(exactLocalAppData)
    await expect(access(path.join(adjacentLocalAppData, 'Programs', 'One Works', 'oneworks.exe'))).rejects
      .toMatchObject({ code: 'ENOENT' })
  })
})
