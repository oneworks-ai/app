import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  importSkillArchive,
  normalizeSkillArchiveImportTarget,
  resolveSkillArchiveImportDir
} from '#~/services/ai/skill-archive-import.js'

const execFileAsync = promisify(execFile)

const createArchive = async (root: string, skills: Record<string, string>) => {
  const sourceDir = path.join(root, 'archive-source')
  const archivePath = path.join(root, `skills-${Math.random().toString(36).slice(2)}.tar`)
  await mkdir(sourceDir, { recursive: true })
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(path.join(sourceDir, name), { recursive: true })
    await writeFile(path.join(sourceDir, name, 'SKILL.md'), body)
  }
  await execFileAsync('/usr/bin/bsdtar', ['-cf', archivePath, '-C', sourceDir, ...Object.keys(skills)])
  return readFile(archivePath)
}

const createRequest = (archive: Buffer, contentLength: string | undefined = String(archive.length)) => {
  const request = Readable.from(archive) as unknown as IncomingMessage
  request.headers = contentLength == null ? {} : { 'content-length': contentLength }
  return request
}

describe('skill archive import target', () => {
  const workspace = '/tmp/example-workspace'
  const env = {
    __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/example-home'
  }

  it('defaults an omitted target to project and rejects unknown targets', () => {
    expect(normalizeSkillArchiveImportTarget(undefined)).toBe('project')
    expect(normalizeSkillArchiveImportTarget('')).toBe('project')
    expect(normalizeSkillArchiveImportTarget('project')).toBe('project')
    expect(normalizeSkillArchiveImportTarget('global')).toBe('global')
    expect(normalizeSkillArchiveImportTarget('workspace')).toBeUndefined()
  })

  it('keeps project imports in the workspace skill directory', () => {
    expect(resolveSkillArchiveImportDir(workspace, 'project', env)).toBe(
      path.join(workspace, '.oo', 'skills')
    )
  })

  it('places global imports in the real-home skill bridge', () => {
    expect(resolveSkillArchiveImportDir(workspace, 'global', env)).toBe(
      path.join('/tmp/example-home', '.agents', 'skills')
    )
  })

  it('rejects a pre-existing target symlink when importing a real archive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-test-'))
    const testWorkspace = path.join(root, 'workspace')
    const archiveSource = path.join(root, 'archive-source')
    const archivePath = path.join(root, 'skills.tar')
    const outsideDir = path.join(root, 'outside')

    try {
      await mkdir(path.join(archiveSource, 'foo'), { recursive: true })
      await writeFile(path.join(archiveSource, 'foo', 'SKILL.md'), '# Imported skill\n')
      await execFileAsync('/usr/bin/bsdtar', ['-cf', archivePath, '-C', archiveSource, 'foo'])
      await mkdir(path.join(testWorkspace, '.oo', 'skills'), { recursive: true })
      await mkdir(outsideDir, { recursive: true })
      await symlink(outsideDir, path.join(testWorkspace, '.oo', 'skills', 'foo'))

      const archive = await readFile(archivePath)
      const request = Readable.from(archive) as unknown as IncomingMessage
      request.headers = { 'content-length': String(archive.length) }

      await expect(
        importSkillArchive(testWorkspace, request, 'skills.tar', 'project')
      ).rejects.toMatchObject({
        status: 400,
        code: 'unsafe_skill_import_target'
      })
      await expect(readFile(path.join(outsideDir, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing', undefined],
    ['forged', '1']
  ])('enforces streamed archive bytes when content-length is %s', async (_caseName, contentLength) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-stream-limit-'))
    try {
      const request = createRequest(Buffer.from('123456'), contentLength)
      await expect(importSkillArchive(root, request, 'skills.tar', 'project', {
        limits: { archiveBytes: 5 }
      })).rejects.toMatchObject({ status: 400, code: 'archive_too_large' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects excessive archive entries and expanded bytes before extraction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-expansion-limit-'))
    try {
      const archive = await createArchive(root, { foo: '# Imported skill with content\n' })
      await expect(importSkillArchive(root, createRequest(archive), 'skills.tar', 'project', {
        limits: { archiveEntries: 1 }
      })).rejects.toMatchObject({ status: 400, code: 'archive_too_many_entries' })
      await expect(importSkillArchive(root, createRequest(archive), 'skills.tar', 'project', {
        limits: { expandedBytes: 5 }
      })).rejects.toMatchObject({ status: 400, code: 'archive_expanded_too_large' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires explicit force before replacing a skill and swaps the whole directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-force-'))
    const workspaceRoot = path.join(root, 'workspace')
    const targetDir = path.join(workspaceRoot, '.oo', 'skills', 'foo')
    try {
      const archive = await createArchive(root, { foo: '# New skill\n' })
      await mkdir(targetDir, { recursive: true })
      await writeFile(path.join(targetDir, 'SKILL.md'), '# Old skill\n')
      await writeFile(path.join(targetDir, 'old-only.md'), 'old\n')

      await expect(
        importSkillArchive(workspaceRoot, createRequest(archive), 'skills.tar', 'project')
      ).rejects.toMatchObject({ status: 409, code: 'skill_import_conflict' })
      await expect(readFile(path.join(targetDir, 'SKILL.md'), 'utf8')).resolves.toContain('Old skill')

      await expect(
        importSkillArchive(workspaceRoot, createRequest(archive), 'skills.tar', 'project', { force: true })
      ).resolves.toMatchObject({ fileCount: 1, targetDir: '.oo/skills' })
      await expect(readFile(path.join(targetDir, 'SKILL.md'), 'utf8')).resolves.toContain('New skill')
      await expect(readFile(path.join(targetDir, 'old-only.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses one physical lock for concurrent imports through workspace aliases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-concurrent-'))
    const workspaceRoot = path.join(root, 'workspace')
    const workspaceAlias = path.join(root, 'workspace-alias')
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstEnteredResolve: () => void = () => undefined
    const firstEntered = new Promise<void>((resolve) => {
      firstEnteredResolve = resolve
    })
    let secondEnteredStaging = false
    let firstImport: Promise<unknown> | undefined
    let secondImport: Promise<unknown> | undefined

    try {
      await mkdir(workspaceRoot, { recursive: true })
      await symlink(workspaceRoot, workspaceAlias)
      const archive = await createArchive(root, { foo: '# Concurrent skill\n' })
      firstImport = importSkillArchive(workspaceRoot, createRequest(archive), 'skills.tar', 'project', {
        beforeStage: async () => {
          firstEnteredResolve()
          await firstGate
        }
      })
      await firstEntered

      secondImport = importSkillArchive(workspaceAlias, createRequest(archive), 'skills.tar', 'project', {
        beforeStage: async () => {
          secondEnteredStaging = true
        }
      })
      const secondResult = await secondImport.then(
        value => ({ status: 'fulfilled' as const, value }),
        reason => ({ status: 'rejected' as const, reason })
      )
      expect(secondResult).toMatchObject({
        status: 'rejected',
        reason: {
          status: 409,
          code: 'skill_import_in_progress'
        }
      })
      expect(secondEnteredStaging).toBe(false)

      releaseFirst()
      await expect(firstImport).resolves.toMatchObject({ fileCount: 1 })
      await expect(
        readFile(path.join(workspaceRoot, '.oo', 'skills', 'foo', 'SKILL.md'), 'utf8')
      ).resolves.toContain('Concurrent skill')
    } finally {
      releaseFirst()
      await Promise.allSettled(
        [firstImport, secondImport].filter((promise): promise is Promise<unknown> => promise != null)
      )
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows the global skills root bridge only when it resolves inside the real home', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-global-bridge-'))
    const home = path.join(root, 'home')
    const physicalSkills = path.join(home, '.codex', 'skills')
    const bridge = path.join(home, '.agents', 'skills')
    const previousHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = home
      await mkdir(path.dirname(bridge), { recursive: true })
      await mkdir(physicalSkills, { recursive: true })
      await symlink(physicalSkills, bridge)
      const archive = await createArchive(root, { foo: '# Global skill\n' })

      await expect(
        importSkillArchive(path.join(root, 'workspace'), createRequest(archive), 'skills.tar', 'global')
      ).resolves.toMatchObject({ targetDir: '~/.agents/skills' })
      await expect(readFile(path.join(physicalSkills, 'foo', 'SKILL.md'), 'utf8')).resolves.toContain('Global skill')
    } finally {
      if (previousHome == null) delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      else process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a dangling global skills bridge with a stable client error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-archive-dangling-bridge-'))
    const home = path.join(root, 'home')
    const physicalSkills = path.join(home, '.codex', 'skills')
    const bridge = path.join(home, '.agents', 'skills')
    const previousHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = home
      await mkdir(path.dirname(bridge), { recursive: true })
      await symlink(physicalSkills, bridge)
      const archive = await createArchive(root, { foo: '# Global skill\n' })

      await expect(
        importSkillArchive(path.join(root, 'workspace'), createRequest(archive), 'skills.tar', 'global')
      ).rejects.toMatchObject({
        status: 400,
        code: 'unsafe_skill_import_target'
      })
      await expect(readFile(path.join(physicalSkills, 'foo', 'SKILL.md'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      if (previousHome == null) delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      else process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
