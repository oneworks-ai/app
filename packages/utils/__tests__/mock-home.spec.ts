import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { unlinkMockHomeBridgePaths } from '#~/mock-home.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('unlinkMockHomeBridgePaths', () => {
  it('materializes a symlinked ancestor instead of deleting through it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ow-mock-home-utils-'))
    tempDirs.push(dir)
    const realHome = join(dir, 'real-home')
    const mockHome = join(dir, 'mock-home')

    await mkdir(join(realHome, '.cache', 'tool'), { recursive: true })
    await mkdir(mockHome, { recursive: true })
    await writeFile(join(realHome, '.cache', 'tool', 'cache.txt'), 'cache\n')
    await symlink(join(realHome, '.cache'), join(mockHome, '.cache'), 'dir')

    await unlinkMockHomeBridgePaths({
      mockHome,
      paths: ['.cache/tool']
    })

    expect((await lstat(join(mockHome, '.cache'))).isDirectory()).toBe(true)
    await expect(lstat(join(mockHome, '.cache', 'tool'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(realHome, '.cache', 'tool', 'cache.txt'), 'utf8')).toBe('cache\n')
  })

  it('unlinks a bridged leaf without removing existing real data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ow-mock-home-utils-'))
    tempDirs.push(dir)
    const realHome = join(dir, 'real-home')
    const mockHome = join(dir, 'mock-home')

    await mkdir(join(realHome, '.codex'), { recursive: true })
    await mkdir(join(mockHome, '.codex'), { recursive: true })
    await writeFile(join(realHome, '.codex', 'config.toml'), 'model = "real"\n')
    await symlink(join(realHome, '.codex', 'config.toml'), join(mockHome, '.codex', 'config.toml'))

    await unlinkMockHomeBridgePaths({
      mockHome,
      paths: ['.codex/config.toml']
    })

    await expect(lstat(join(mockHome, '.codex', 'config.toml'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(realHome, '.codex', 'config.toml'), 'utf8')).toBe('model = "real"\n')
  })
})
