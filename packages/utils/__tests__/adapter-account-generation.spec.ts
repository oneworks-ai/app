import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  persistAdapterAccountArtifacts,
  removeStoredAdapterAccount,
  resolveAdapterAccountReadDirs
} from '#~/adapter-account.js'

import { createAdapterAccountTestContext } from './adapter-account-test-helpers'

const { cleanup, createTempDir, pathExists } = createAdapterAccountTestContext()
afterEach(cleanup)

describe('adapter account artifact generations', () => {
  it('replaces the complete artifact generation with private permissions', async () => {
    const workspace = await createTempDir('ow-account-artifact-replace-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }

    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'auth.json', content: 'first' },
        { path: 'nested/meta.json', content: 'stale' }
      ]
    })
    const second = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'auth.json', content: 'second' },
        { path: 'fresh/state.json', content: 'fresh' }
      ]
    })

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([second.accountDir])
    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('first')
    expect(await readFile(join(first.accountDir, 'nested/meta.json'), 'utf8')).toBe('stale')
    expect(await readFile(join(second.accountDir, 'auth.json'), 'utf8')).toBe('second')
    expect(await pathExists(join(second.accountDir, 'nested/meta.json'))).toBe(false)
    expect(await readFile(join(second.accountDir, 'fresh/state.json'), 'utf8')).toBe('fresh')
    if (process.platform !== 'win32') {
      expect((await stat(second.accountDir)).mode & 0o777).toBe(0o700)
      expect((await stat(join(second.accountDir, 'fresh'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(second.accountDir, 'auth.json'))).mode & 0o777).toBe(0o600)
      expect((await stat(join(second.accountDir, 'fresh/state.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('serializes concurrent artifact generations and shares the same lock with removal', async () => {
    const workspace = await createTempDir('ow-account-artifact-concurrent-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }

    await Promise.all([
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'one' },
          { path: 'only-one.txt', content: 'one' }
        ]
      }),
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'two' },
          { path: 'only-two.txt', content: 'two' }
        ]
      })
    ])

    const accountDir = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
    const generation = await readFile(join(accountDir, 'generation.txt'), 'utf8')
    expect((await readdir(accountDir)).sort()).toEqual(
      generation === 'one'
        ? ['generation.txt', 'only-one.txt']
        : ['generation.txt', 'only-two.txt']
    )

    await Promise.all([
      removeStoredAdapterAccount(params),
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'three' },
          { path: 'only-three.txt', content: 'three' }
        ]
      })
    ])
    if (await pathExists(accountDir)) {
      expect((await readdir(accountDir)).sort()).toEqual(['generation.txt', 'only-three.txt'])
    }
  })

  it('preserves the prior generation when staging fails', async () => {
    const workspace = await createTempDir('ow-account-artifact-rollback-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'stable' }]
    })

    await expect(persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: `${'a'.repeat(300)}.json`, content: 'failed' }]
    })).rejects.toThrow()

    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('stable')
    expect((await readdir(first.accountDir)).sort()).toEqual(['auth.json'])
  })

  it('keeps resolved generations readable during publication and cleans them on explicit removal', async () => {
    const workspace = await createTempDir('ow-account-artifact-reader-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'generation.txt', content: '0' },
        { path: 'only-0.txt', content: '0' }
      ]
    })

    const readerController = new AbortController()
    const errors: unknown[] = []
    const reader = async () => {
      while (!readerController.signal.aborted) {
        try {
          const current = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
          const generation = await readFile(join(current, 'generation.txt'), 'utf8')
          expect((await readdir(current)).sort()).toEqual(['generation.txt', `only-${generation}.txt`])
        } catch (error) {
          errors.push(error)
        }
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
    const readers = [reader(), reader()]
    try {
      for (let generation = 1; generation <= 4; generation += 1) {
        await persistAdapterAccountArtifacts({
          ...params,
          artifacts: [
            { path: 'generation.txt', content: String(generation) },
            { path: `only-${generation}.txt`, content: String(generation) }
          ]
        })
      }
    } finally {
      readerController.abort()
      await Promise.all(readers)
    }
    expect(errors).toEqual([])

    const current = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
    const generationsDir = dirname(current)
    const stateDir = dirname(generationsDir)
    expect((await readdir(generationsDir)).length).toBeGreaterThan(1)
    await removeStoredAdapterAccount(params)
    expect(await pathExists(stateDir)).toBe(false)
    expect(await pathExists(current)).toBe(false)
  }, 30_000)

  it('keeps the old generation current after an unpublished generation or pointer switch failure', async () => {
    const workspace = await createTempDir('ow-account-artifact-pointer-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'stable' }]
    })
    const generationsDir = dirname(first.accountDir)
    const stateDir = dirname(generationsDir)
    const orphanGeneration = join(generationsDir, '00000000-0000-4000-8000-000000000001')
    await mkdir(orphanGeneration, { mode: 0o700 })
    await writeFile(join(orphanGeneration, 'auth.json'), 'unpublished', { mode: 0o600 })

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([first.accountDir])
    const pointerPath = join(stateDir, 'current')
    const savedPointerPath = join(stateDir, 'current.saved')
    await rename(pointerPath, savedPointerPath)
    await mkdir(pointerPath)
    await expect(persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'must-not-publish' }]
    })).rejects.toThrow(/generation pointer.*real file/i)
    await rm(pointerPath, { recursive: true })
    await rename(savedPointerPath, pointerPath)

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([first.accountDir])
    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('stable')
    expect(await readFile(join(orphanGeneration, 'auth.json'), 'utf8')).toBe('unpublished')
  })
})
