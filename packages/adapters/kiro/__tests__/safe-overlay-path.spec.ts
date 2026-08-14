import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import { encodeKiroOverlayLeaf, resolveKiroSkillOverlayTarget } from '../src/runtime/safe-overlay-path'
import { prepareKiroSessionRuntime } from '../src/runtime/shared'

const tempDirs: string[] = []

const createTempDir = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-kiro-overlay-'))
  tempDirs.push(root)
  return root
}

const createContext = (root: string): AdapterCtx => ({
  ctxId: 'ctx-overlay',
  cwd: root,
  env: {
    __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(root, '.oneworks-projects'),
    __ONEWORKS_PROJECT_REAL_HOME__: join(root, 'real-home')
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: '' })
  },
  configs: [undefined, undefined],
  logger: {
    stream: new PassThrough(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('kiro safe overlay paths', () => {
  it('encodes every cross-platform hostile overlay name as a direct safe leaf', () => {
    const skillsRoot = '/isolated/kiro-home/skills'
    const hostileNames = [
      '..\\..\\outside',
      '../outside',
      '..\\../outside',
      'C:\\outside',
      '\\\\server\\share',
      'trailing/',
      '.',
      '..'
    ]
    for (const name of hostileNames) {
      const targetPath = resolveKiroSkillOverlayTarget(skillsRoot, `skills/${name}`)
      const relativePath = win32.relative(win32.resolve(skillsRoot), win32.resolve(targetPath))
      expect(relativePath).not.toBe('..')
      expect(relativePath).not.toMatch(/^\.\.[\\/]/u)
      expect(relativePath).toMatch(/^encoded-[a-f0-9]{64}$/u)
      expect(relativePath).not.toContain(':')
    }

    expect(encodeKiroOverlayLeaf('研究 helper')).toBe('研究 helper')
    expect(resolveKiroSkillOverlayTarget(skillsRoot, 'skills/研究 helper'))
      .toBe(resolve(skillsRoot, '研究 helper'))
  })

  it('stages hostile and valid skill display names only inside KIRO_HOME', async () => {
    const root = await createTempDir()
    const sourcePath = join(root, 'source-skill')
    const outsidePath = join(root, 'outside')
    const sentinelPath = join(outsidePath, 'sentinel.txt')
    await mkdir(sourcePath, { recursive: true })
    await mkdir(outsidePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), '# Safe source\n', 'utf8')
    await writeFile(sentinelPath, 'unchanged', 'utf8')
    const names = [
      '..\\..\\outside',
      '../outside',
      '..\\../outside',
      'C:\\outside',
      '\\\\server\\share',
      'trailing/',
      '.',
      '..',
      '研究 helper'
    ]
    const options: AdapterQueryOptions = {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-hostile-skills',
      assetPlan: {
        adapter: 'kiro',
        diagnostics: [],
        mcpServers: {},
        overlays: names.map((name, index) => ({
          assetId: `skill:${index}`,
          kind: 'skill' as const,
          sourcePath,
          targetPath: `skills/${name}`
        }))
      },
      onEvent: () => undefined
    }

    const runtime = await prepareKiroSessionRuntime(createContext(root), options, {})
    const skillsRoot = join(runtime.kiroHome, 'skills')
    const stagedNames = await readdir(skillsRoot)
    expect(stagedNames).toContain('研究 helper')
    expect(stagedNames.filter(name => name.startsWith('encoded-'))).toHaveLength(names.length - 1)
    for (const name of stagedNames) expect(await readlink(join(skillsRoot, name))).toBe(sourcePath)
    expect(await readFile(sentinelPath, 'utf8')).toBe('unchanged')
  })

  it.each(['skills-root', 'kiro-home'] as const)(
    'rejects a preexisting escaping %s symlink before staging overlays',
    async (attack) => {
      const root = await createTempDir()
      const sourcePath = join(root, 'source-skill')
      const outsidePath = join(root, `outside-${attack}`)
      const sentinelPath = join(outsidePath, 'sentinel.txt')
      await mkdir(sourcePath, { recursive: true })
      await mkdir(outsidePath, { recursive: true })
      await writeFile(join(sourcePath, 'SKILL.md'), '# Source\n', 'utf8')
      await writeFile(sentinelPath, 'unchanged', 'utf8')
      const ctx = createContext(root)
      const options: AdapterQueryOptions = {
        type: 'create',
        runtime: 'server',
        sessionId: `session-symlink-${attack}`,
        assetPlan: {
          adapter: 'kiro',
          diagnostics: [],
          mcpServers: {},
          overlays: [{
            assetId: 'skill:attack',
            kind: 'skill',
            sourcePath,
            targetPath: 'skills/safe-name'
          }]
        },
        onEvent: () => undefined
      }
      const firstRuntime = await prepareKiroSessionRuntime(ctx, { ...options, assetPlan: undefined }, {})
      const attackedPath = attack === 'skills-root'
        ? join(firstRuntime.kiroHome, 'skills')
        : firstRuntime.kiroHome
      await rm(attackedPath, { recursive: true, force: true })
      await symlink(outsidePath, attackedPath, 'dir')

      await expect(prepareKiroSessionRuntime(ctx, options, {})).rejects.toThrow('must not be a symlink')
      expect(await readFile(sentinelPath, 'utf8')).toBe('unchanged')
    }
  )
})
