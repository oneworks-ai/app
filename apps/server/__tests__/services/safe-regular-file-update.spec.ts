import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openVerifiedRegularFileForUpdate } from '#~/services/safe-regular-file-update.js'

const tempDirs: string[] = []

const createTempDir = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ow-safe-file-update-'))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('verified regular file updates', () => {
  it('rejects a symlink even when the platform provides no O_NOFOLLOW protection', async () => {
    const directory = await createTempDir()
    const outsidePath = join(directory, 'outside.txt')
    const linkPath = join(directory, '.gitignore')
    await writeFile(outsidePath, 'outside\n', 'utf8')
    await symlink(outsidePath, linkPath)

    await expect(openVerifiedRegularFileForUpdate(linkPath, { noFollowFlag: 0 })).rejects.toThrow(
      'Unsafe regular file update path'
    )
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside\n')
  })

  it('updates the verified handle for a regular file without replacing it', async () => {
    const directory = await createTempDir()
    const filePath = join(directory, '.gitignore')
    await writeFile(filePath, 'existing\n', 'utf8')

    const handle = await openVerifiedRegularFileForUpdate(filePath, { noFollowFlag: 0 })
    try {
      await handle.writeFile('next\n', 'utf8')
    } finally {
      await handle.close()
    }

    await expect(readFile(filePath, 'utf8')).resolves.toBe('existing\nnext\n')
  })
})
