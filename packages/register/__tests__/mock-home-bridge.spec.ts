import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('bridgeRealHomeToMockHome', () => {
  it('bridges real home dot entries while directly reusing shared caches', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)

    await mkdir(path.join(realHome, '.cache', 'tool'), { recursive: true })
    await mkdir(path.join(realHome, '.aws'), { recursive: true })
    await mkdir(path.join(realHome, '.config', 'opencode'), { recursive: true })
    await mkdir(path.join(realHome, '.codex'), { recursive: true })
    await mkdir(path.join(realHome, '.oneworks'), { recursive: true })
    await mkdir(path.join(realHome, 'Library', 'Keychains'), { recursive: true })
    await mkdir(path.join(realHome, 'Library', 'Application Support', 'lark-cli'), { recursive: true })
    await mkdir(path.join(realHome, 'Library', 'Application Support', 'other-tool'), { recursive: true })
    await mkdir(path.join(realHome, 'Library', 'Preferences'), { recursive: true })
    await mkdir(path.join(realHome, 'Documents'), { recursive: true })
    await writeFile(path.join(realHome, '.cache', 'tool', 'cache.txt'), 'cache\n')
    await writeFile(path.join(realHome, '.zcompdump-YiJie-MBP-Max-5.9'), 'zsh cache\n')
    await writeFile(path.join(realHome, '.zcompdump-YiJie-MBP-Max-5.9.zwc'), 'compiled zsh cache\n')
    await writeFile(path.join(realHome, '.aws', 'config'), '[profile]\n')
    await writeFile(path.join(realHome, '.config', 'opencode', 'opencode.json'), '{}\n')
    await writeFile(path.join(realHome, '.codex', 'config.toml'), 'model = "real"\n')
    await writeFile(path.join(realHome, '.oneworks', 'db.sqlite'), 'db\n')
    await writeFile(path.join(realHome, 'Library', 'Keychains', 'login.keychain-db'), 'keychain\n')
    await writeFile(path.join(realHome, 'Library', 'Application Support', 'lark-cli', 'token.enc'), 'token\n')
    await writeFile(path.join(realHome, 'Library', 'Application Support', 'other-tool', 'auth.json'), 'auth\n')
    await writeFile(path.join(realHome, 'Library', 'Preferences', 'tool.plist'), 'skip\n')
    await writeFile(path.join(realHome, '.npmrc'), 'registry=https://example.invalid\n')
    await writeFile(path.join(realHome, 'Documents', 'note.txt'), 'skip\n')

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({ realHome, mockHome })

    expect(await readlink(path.join(mockHome, '.cache'))).toBe(path.join(realHome, '.cache'))
    expect(await readFile(path.join(mockHome, '.cache', 'tool', 'cache.txt'), 'utf8')).toBe('cache\n')
    expect((await lstat(path.join(mockHome, '.aws'))).isDirectory()).toBe(true)
    expect(await readlink(path.join(mockHome, '.aws', 'config'))).toBe(path.join(realHome, '.aws', 'config'))
    expect((await lstat(path.join(mockHome, '.config'))).isDirectory()).toBe(true)
    expect(await readlink(path.join(mockHome, '.config', 'opencode'))).toBe(
      path.join(realHome, '.config', 'opencode')
    )
    expect(await readlink(path.join(mockHome, '.codex', 'config.toml'))).toBe(
      path.join(realHome, '.codex', 'config.toml')
    )
    await expect(lstat(path.join(mockHome, '.oneworks'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform === 'darwin') {
      expect(await readlink(path.join(mockHome, 'Library', 'Keychains'))).toBe(
        path.join(realHome, 'Library', 'Keychains')
      )
      expect(await readFile(path.join(mockHome, 'Library', 'Keychains', 'login.keychain-db'), 'utf8')).toBe(
        'keychain\n'
      )
      expect(await readlink(path.join(mockHome, 'Library', 'Application Support'))).toBe(
        path.join(realHome, 'Library', 'Application Support')
      )
      expect(await readFile(path.join(mockHome, 'Library', 'Application Support', 'lark-cli', 'token.enc'), 'utf8'))
        .toBe(
          'token\n'
        )
      expect(await readFile(path.join(mockHome, 'Library', 'Application Support', 'other-tool', 'auth.json'), 'utf8'))
        .toBe(
          'auth\n'
        )
    } else {
      await expect(lstat(path.join(mockHome, 'Library', 'Keychains'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(lstat(path.join(mockHome, 'Library', 'Application Support'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
    await expect(lstat(path.join(mockHome, 'Library', 'Preferences'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readlink(path.join(mockHome, '.npmrc'))).toBe(path.join(realHome, '.npmrc'))
    await expect(lstat(path.join(mockHome, '.zcompdump-YiJie-MBP-Max-5.9'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(lstat(path.join(mockHome, '.zcompdump-YiJie-MBP-Max-5.9.zwc'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(lstat(path.join(mockHome, 'Documents'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes stale excluded .oneworks bridge entries from mock home', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)

    await mkdir(path.join(realHome, '.oneworks'), { recursive: true })
    await mkdir(path.join(mockHome, '.oneworks'), { recursive: true })
    await writeFile(path.join(realHome, '.oneworks', 'db.sqlite'), 'db\n')
    await symlink(path.join(realHome, '.oneworks', 'db.sqlite'), path.join(mockHome, '.oneworks', 'db.sqlite'))

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({ realHome, mockHome })

    await expect(lstat(path.join(mockHome, '.oneworks'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(realHome, '.oneworks', 'db.sqlite'), 'utf8')).toBe('db\n')
  })

  it('removes stale volatile shell cache bridge symlinks from mock home', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)

    const cacheName = '.zcompdump-YiJie-MBP-Max-5.9'
    await writeFile(path.join(realHome, cacheName), 'zsh cache\n')
    await symlink(path.join(realHome, cacheName), path.join(mockHome, cacheName))

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({ realHome, mockHome })

    await expect(lstat(path.join(mockHome, cacheName))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(realHome, cacheName), 'utf8')).toBe('zsh cache\n')
  })

  it('repairs existing direct-link directories while preserving a mock-home backup', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)
    const bridgeEntry = path.join('Library', 'Application Support')
    const sourcePath = path.join(realHome, bridgeEntry)
    const targetPath = path.join(mockHome, bridgeEntry)

    await mkdir(path.join(sourcePath, 'lark-cli'), { recursive: true })
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(sourcePath, 'lark-cli', 'token.enc'), 'token\n')
    await writeFile(path.join(targetPath, 'local-only.txt'), 'local\n')

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({
      realHome,
      mockHome,
      entries: [bridgeEntry],
      directLinkEntries: [bridgeEntry],
      includeDotEntries: false,
      includePlatformEntries: false
    })

    expect(await readlink(targetPath)).toBe(sourcePath)
    expect(await readFile(path.join(targetPath, 'lark-cli', 'token.enc'), 'utf8')).toBe('token\n')

    const backupNames = (await readdir(path.dirname(targetPath)))
      .filter(entry => entry.startsWith(`${path.basename(targetPath)}.backup-`))
    expect(backupNames).toHaveLength(1)
    expect(await readFile(path.join(path.dirname(targetPath), backupNames[0], 'local-only.txt'), 'utf8')).toBe(
      'local\n'
    )
  })

  it('repairs stale direct-link symlinks', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const previousHome = await mkdtemp(path.join(os.tmpdir(), 'ow-previous-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, previousHome, mockHome)
    const bridgeEntry = path.join('Library', 'Application Support')
    const sourcePath = path.join(realHome, bridgeEntry)
    const previousSourcePath = path.join(previousHome, bridgeEntry)
    const targetPath = path.join(mockHome, bridgeEntry)

    await mkdir(sourcePath, { recursive: true })
    await mkdir(previousSourcePath, { recursive: true })
    await mkdir(path.dirname(targetPath), { recursive: true })
    await symlink(previousSourcePath, targetPath, 'dir')

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({
      realHome,
      mockHome,
      entries: [bridgeEntry],
      directLinkEntries: [bridgeEntry],
      includeDotEntries: false,
      includePlatformEntries: false
    })

    expect(await readlink(targetPath)).toBe(sourcePath)
    expect((await lstat(previousSourcePath)).isDirectory()).toBe(true)
  })

  it('materializes symlinked ancestors before repairing nested direct links', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)
    const bridgeEntry = path.join('Library', 'Application Support')
    const sourcePath = path.join(realHome, bridgeEntry)
    const targetPath = path.join(mockHome, bridgeEntry)

    await mkdir(path.join(sourcePath, 'lark-cli'), { recursive: true })
    await mkdir(mockHome, { recursive: true })
    await writeFile(path.join(sourcePath, 'lark-cli', 'token.enc'), 'token\n')
    await symlink(path.join(realHome, 'Library'), path.join(mockHome, 'Library'), 'dir')

    const { bridgeRealHomeToMockHome } = require('../mock-home-bridge.js') as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({
      realHome,
      mockHome,
      entries: [bridgeEntry],
      directLinkEntries: [bridgeEntry],
      includeDotEntries: false,
      includePlatformEntries: false
    })

    const libraryStat = await lstat(path.join(mockHome, 'Library'))
    expect(libraryStat.isDirectory()).toBe(true)
    expect(libraryStat.isSymbolicLink()).toBe(false)
    expect(await readlink(targetPath)).toBe(sourcePath)
    expect(await readFile(path.join(sourcePath, 'lark-cli', 'token.enc'), 'utf8')).toBe('token\n')
  })
})

describe('claimMockHomePaths', () => {
  it('removes bridged leaf symlinks without touching the real home file', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)

    await mkdir(path.join(realHome, '.codex'), { recursive: true })
    await writeFile(path.join(realHome, '.codex', 'config.toml'), 'model = "real"\n')

    const { bridgeRealHomeToMockHome, claimMockHomePaths } = require(
      '../mock-home-bridge.js'
    ) as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({ realHome, mockHome })
    claimMockHomePaths({ mockHome, paths: ['.codex/config.toml'] })

    await expect(lstat(path.join(mockHome, '.codex', 'config.toml'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(realHome, '.codex', 'config.toml'), 'utf8')).toBe('model = "real"\n')
  })

  it('materializes bridged ancestors before adapter-owned paths are claimed', async () => {
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-real-home-'))
    const mockHome = await mkdtemp(path.join(os.tmpdir(), 'ow-mock-home-'))
    tempDirs.push(realHome, mockHome)

    await mkdir(path.join(realHome, '.cache', 'tool'), { recursive: true })
    await writeFile(path.join(realHome, '.cache', 'tool', 'cache.txt'), 'cache\n')

    const { bridgeRealHomeToMockHome, claimMockHomePaths } = require(
      '../mock-home-bridge.js'
    ) as typeof import('../mock-home-bridge')
    bridgeRealHomeToMockHome({ realHome, mockHome })
    claimMockHomePaths({ mockHome, paths: ['.cache/tool'] })

    expect((await lstat(path.join(mockHome, '.cache'))).isDirectory()).toBe(true)
    await expect(lstat(path.join(mockHome, '.cache', 'tool'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(realHome, '.cache', 'tool', 'cache.txt'), 'utf8')).toBe('cache\n')
  })
})
