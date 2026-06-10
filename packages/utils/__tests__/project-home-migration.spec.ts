import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '#~/ai-path.js'
import {
  copyDirectoryContentsWithoutOverwrite,
  migrateProjectHomeSegment,
  removeLegacyProjectHomeSegmentPath,
  resolveLegacyProjectHomeSegmentPaths
} from '#~/project-home-migration.js'

describe('project home migration', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('does not backfill legacy cache entries into the project home', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-project-home-migration-'))
    tempDirs.push(cwd)
    const env = {
      ...process.env,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(cwd, '.oneworks-projects')
    }
    const legacyCacheRoot = join(cwd, '.oo', 'caches')
    const homeCacheRoot = resolveProjectHomePath(cwd, env, 'caches')

    await mkdir(legacyCacheRoot, { recursive: true })
    await writeFile(join(legacyCacheRoot, 'legacy.json'), '{"legacy":true}\n', 'utf8')

    await expect(migrateProjectHomeSegment(cwd, env, 'caches')).resolves.toEqual({
      migratedSources: [],
      targetDir: homeCacheRoot
    })
    expect(resolveLegacyProjectHomeSegmentPaths(cwd, env, 'caches')).toEqual({
      sourceDirs: [],
      targetDir: homeCacheRoot
    })
    await expect(readFile(join(homeCacheRoot, 'legacy.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not remove files from legacy project-home paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-project-home-remove-legacy-'))
    tempDirs.push(cwd)
    const env = {
      ...process.env,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(cwd, '.oneworks-projects')
    }
    const legacyAccountFile = join(cwd, '.oo', '.local', 'adapters', 'codex', 'accounts', 'work', 'auth.json')

    await mkdir(join(legacyAccountFile, '..'), { recursive: true })
    await writeFile(legacyAccountFile, '{"legacy":true}\n', 'utf8')

    await removeLegacyProjectHomeSegmentPath(cwd, env, '.local', 'adapters', 'codex', 'accounts', 'work')

    await expect(readFile(legacyAccountFile, 'utf8')).resolves.toBe('{"legacy":true}\n')
  })

  it('keeps the explicit copy helper available for non-legacy migrations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ow-project-home-copy-helper-'))
    tempDirs.push(cwd)
    const sourceDir = join(cwd, 'source')
    const targetDir = join(cwd, 'target')

    await mkdir(sourceDir, { recursive: true })
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(sourceDir, 'copied.txt'), 'copied\n', 'utf8')
    await writeFile(join(sourceDir, 'existing.txt'), 'source\n', 'utf8')
    await writeFile(join(targetDir, 'existing.txt'), 'target\n', 'utf8')

    await expect(copyDirectoryContentsWithoutOverwrite({ sourceDir, targetDir })).resolves.toBe(true)

    await expect(readFile(join(targetDir, 'copied.txt'), 'utf8')).resolves.toBe('copied\n')
    await expect(readFile(join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe('target\n')
  })
})
