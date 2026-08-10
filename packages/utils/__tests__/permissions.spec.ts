import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import {
  parseStrictPermissionMirror,
  withPrivatePermissionMirrorLock,
  writePrivatePermissionMirror
} from '#~/permissions.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

it('atomically writes permission mirrors with private permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-private-permission-mirror-'))
  tempDirs.push(root)
  const parent = join(root, 'permission-state', 'pi')
  const mirrorPath = join(parent, 'session.json')
  await mkdir(parent, { recursive: true, mode: 0o755 })
  await writeFile(mirrorPath, 'old', { mode: 0o644 })
  await writePrivatePermissionMirror(mirrorPath, '{"permissionState":{}}\n')

  expect((await stat(parent)).mode & 0o777).toBe(0o700)
  expect((await stat(mirrorPath)).mode & 0o777).toBe(0o600)
  await expect(readFile(mirrorPath, 'utf8')).resolves.toBe('{"permissionState":{}}\n')
  expect((await readdir(parent)).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('releases the shared private mirror lock when a protected operation throws', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-private-permission-lock-'))
  tempDirs.push(root)
  const mirrorPath = join(root, 'permission-state', 'pi', 'session.json')

  await expect(withPrivatePermissionMirrorLock(mirrorPath, async () => {
    throw new Error('write failed')
  })).rejects.toThrow('write failed')
  await expect(withPrivatePermissionMirrorLock(mirrorPath, async () => 'released')).resolves.toBe('released')
})

it('recovers an empty stale proper-lockfile directory before entering the mirror critical section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-private-permission-stale-lock-'))
  tempDirs.push(root)
  const mirrorPath = join(root, 'permission-state', 'pi', 'session.json')
  const lockPath = `${mirrorPath}.lock`
  await mkdir(lockPath, { recursive: true })
  const staleAt = new Date(Date.now() - 31_000)
  await utimes(lockPath, staleAt, staleAt)

  await expect(withPrivatePermissionMirrorLock(mirrorPath, async () => 'recovered')).resolves.toBe('recovered')
})

it.each([
  ['a non-object', '[]'],
  [
    'a mismatched adapter',
    JSON.stringify({
      adapter: 'codex',
      sessionId: 'session-1',
      permissionState: { allow: [], deny: [], onceAllow: [], onceDeny: [] }
    })
  ],
  [
    'a mismatched session',
    JSON.stringify({
      adapter: 'pi',
      sessionId: 'other',
      permissionState: { allow: [], deny: [], onceAllow: [], onceDeny: [] }
    })
  ],
  [
    'a missing state list',
    JSON.stringify({ adapter: 'pi', sessionId: 'session-1', permissionState: { allow: [], deny: [], onceAllow: [] } })
  ]
])('rejects a permission mirror with %s', (_label, content) => {
  expect(() => parseStrictPermissionMirror(content, { adapter: 'pi', sessionId: 'session-1' })).toThrow(
    'invalid identity or permission state'
  )
})
