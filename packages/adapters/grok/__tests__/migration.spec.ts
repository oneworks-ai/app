import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { migrateGrokSession } from '../src/runtime/migration'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('grok session migration', () => {
  it('copies a native session from a previous runtime context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-grok-migration-'))
    tempDirs.push(root)
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const cacheRoot = join(root, 'caches')
    const oldHome = join(cacheRoot, 'old-context', sessionId, 'adapter-grok', 'home')
    const currentHome = join(cacheRoot, 'adapter-grok', 'sessions', sessionId, 'home')
    const nativeSession = join(oldHome, 'sessions', '%2Fworkspace', sessionId)
    await mkdir(nativeSession, { recursive: true })
    await writeFile(join(nativeSession, 'summary.json'), '{"info":{"id":"native"}}\n')

    await expect(migrateGrokSession({
      cacheRoot,
      currentGrokHome: currentHome,
      realGrokHome: join(root, 'real-grok'),
      sessionId
    })).resolves.toBe(true)
    await expect(readFile(
      join(currentHome, 'sessions', '%2Fworkspace', sessionId, 'summary.json'),
      'utf8'
    )).resolves.toContain('native')
  })

  it('does not overwrite an existing session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-grok-migration-'))
    tempDirs.push(root)
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const cacheRoot = join(root, 'caches')
    const currentHome = join(cacheRoot, 'adapter-grok', 'sessions', sessionId, 'home')
    const nativeSession = join(currentHome, 'sessions', '%2Fworkspace', sessionId)
    await mkdir(nativeSession, { recursive: true })
    await writeFile(join(nativeSession, 'summary.json'), '{"state":"current"}\n')

    await expect(migrateGrokSession({
      cacheRoot,
      currentGrokHome: currentHome,
      realGrokHome: join(root, 'real-grok'),
      sessionId
    })).resolves.toBe(false)
  })
})
