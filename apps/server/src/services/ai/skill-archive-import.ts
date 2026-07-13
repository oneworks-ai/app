/* eslint-disable max-lines -- archive safety, validation, and rollback must share one bounded import pipeline. */
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { dirname, join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import type { IncomingMessage } from 'node:http'

import { resolveProjectOoPath, resolveProjectRealHome } from '@oneworks/utils'
import { DirectoryInstallLockBusyError, withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ENTRY_PATH_BYTES = 4_096
const MAX_EXTRACTED_FILES = 10_000
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024
const ARCHIVE_TOOL_TIMEOUT_MS = 60_000
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024
const MAX_ARCHIVE_STDERR_BYTES = 64 * 1024
const execFileAsync = promisify(execFile)

export type SkillArchiveImportTarget = 'global' | 'project'
export interface SkillArchiveImportLimits {
  archiveBytes: number
  archiveEntries: number
  expandedBytes: number
  extractedFiles: number
}
export interface SkillArchiveImportOptions {
  beforeStage?: () => Promise<void>
  force?: boolean
  limits?: Partial<SkillArchiveImportLimits>
}
const DEFAULT_IMPORT_LIMITS: SkillArchiveImportLimits = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  archiveEntries: MAX_ARCHIVE_ENTRIES,
  expandedBytes: MAX_EXPANDED_BYTES,
  extractedFiles: MAX_EXTRACTED_FILES
}

export const normalizeSkillArchiveImportTarget = (
  value: string | undefined
): SkillArchiveImportTarget | undefined => {
  if (value == null || value === '') return 'project'
  return value === 'project' || value === 'global' ? value : undefined
}

export const normalizeSkillArchiveImportForce = (value: string | undefined): boolean | undefined => {
  if (value == null || value === '') return false
  return value === 'true' ? true : value === 'false' ? false : undefined
}

export const resolveSkillArchiveImportDir = (
  workspaceRoot: string,
  target: SkillArchiveImportTarget,
  env: Record<string, string | null | undefined> = process.env
) =>
  target === 'global'
    ? join(resolveProjectRealHome(env), '.agents', 'skills')
    : resolveProjectOoPath(workspaceRoot, env, 'skills')

const decodeArchiveName = (value: string | undefined) => {
  if (value == null || value.trim() === '') return 'skills-archive'
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const sanitizeArchiveName = (value: string) => {
  const base = path.basename(value).replace(/[^\w.-]+/g, '-')
  return base === '' ? 'skills-archive' : base
}

let archiveToolPromise: Promise<string> | undefined
const resolveArchiveTool = () => {
  archiveToolPromise ??= (async () => {
    const candidates = Array.from(
      new Set([
        process.env.__ONEWORKS_BSDTAR_PATH__,
        'bsdtar',
        ...(process.platform === 'win32' ? ['bsdtar.exe', 'tar.exe'] : [])
      ].filter((candidate): candidate is string => candidate != null && candidate.trim() !== ''))
    )
    for (const candidate of candidates) {
      try {
        const { stderr, stdout } = await execFileAsync(candidate, ['--version'], {
          encoding: 'utf8',
          maxBuffer: MAX_ARCHIVE_STDERR_BYTES,
          timeout: 5_000
        })
        if (/bsdtar|libarchive/iu.test(`${stdout}\n${stderr}`)) return candidate
      } catch {
        // Try the next libarchive-compatible candidate.
      }
    }
    throw internalServerError('Skill archive tool is unavailable', {
      code: 'skill_archive_tool_unavailable'
    })
  })()
  return archiveToolPromise
}

const writeArchiveWithLimit = async (req: IncomingMessage, archivePath: string, maxArchiveBytes: number) => {
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxArchiveBytes) {
    throw badRequest('Archive is too large', { maxBytes: maxArchiveBytes }, 'archive_too_large')
  }

  const file = await open(archivePath, 'wx')
  let bytes = 0
  const iteratorFactory = (req as IncomingMessage & {
    iterator?: (options: { destroyOnReturn: boolean }) => AsyncIterator<unknown>
  }).iterator
  const iterator = iteratorFactory == null
    ? req[Symbol.asyncIterator]()
    : iteratorFactory.call(req, { destroyOnReturn: false })
  try {
    while (true) {
      const next = await iterator.next()
      if (next.done) break
      const chunk = typeof next.value === 'string'
        ? Buffer.from(next.value)
        : Buffer.from(next.value as Uint8Array)
      bytes += chunk.byteLength
      if (bytes > maxArchiveBytes) {
        req.resume()
        throw badRequest('Archive is too large', { maxBytes: maxArchiveBytes }, 'archive_too_large')
      }
      await file.write(chunk)
    }
  } finally {
    await file.close()
  }
  return bytes
}

const assertSafeArchiveEntries = async (archiveTool: string, archivePath: string, maxEntries: number) => {
  let stdout: string
  try {
    stdout = (await execFileAsync(archiveTool, ['-tf', archivePath], {
      encoding: 'utf8',
      maxBuffer: MAX_ARCHIVE_LIST_BYTES,
      timeout: ARCHIVE_TOOL_TIMEOUT_MS
    })).stdout
  } catch (error) {
    throw badRequest('Archive could not be listed', {
      cause: error instanceof Error ? error.message : String(error)
    }, 'invalid_skill_archive')
  }
  const entries = stdout.split('\n').map(entry => entry.trim()).filter(Boolean)
  if (entries.length === 0) throw badRequest('Archive is empty', undefined, 'empty_archive')
  if (entries.length > maxEntries) {
    throw badRequest('Archive contains too many entries', { maxEntries }, 'archive_too_many_entries')
  }

  const normalizedEntries = new Set<string>()
  for (const entry of entries) {
    if (Buffer.byteLength(entry) > MAX_ENTRY_PATH_BYTES) {
      throw badRequest(
        'Archive entry path is too long',
        { maxBytes: MAX_ENTRY_PATH_BYTES },
        'archive_entry_path_too_long'
      )
    }
    if (entry.includes('\0') || entry.startsWith('/') || /^[a-z]:/iu.test(entry)) {
      throw badRequest('Archive contains unsafe paths', { entry }, 'unsafe_archive_path')
    }
    const normalized = path.posix.normalize(entry).replace(/\/$/u, '')
    if (normalized === '..' || normalized.startsWith('../')) {
      throw badRequest('Archive contains unsafe paths', { entry }, 'unsafe_archive_path')
    }
    if (normalizedEntries.has(normalized)) {
      throw badRequest('Archive contains duplicate paths', { entry }, 'duplicate_archive_path')
    }
    normalizedEntries.add(normalized)
  }
}

const assertExpandedArchiveWithinLimit = async (
  archiveTool: string,
  archivePath: string,
  maxExpandedBytes: number
) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(archiveTool, ['-xOf', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let bytes = 0
    let stderr = ''
    let exceeded = false
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error == null) resolve()
      else reject(error)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(badRequest('Archive expansion timed out', undefined, 'archive_expansion_timeout'))
    }, ARCHIVE_TOOL_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (!exceeded && bytes > maxExpandedBytes) {
        exceeded = true
        child.kill()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_ARCHIVE_STDERR_BYTES) stderr += chunk.toString('utf8')
    })
    child.once('error', finish)
    child.once('close', (code) => {
      if (exceeded) {
        finish(badRequest(
          'Archive expands beyond the allowed size',
          { maxBytes: maxExpandedBytes },
          'archive_expanded_too_large'
        ))
      } else if (code !== 0) {
        finish(badRequest('Archive could not be expanded', { stderr }, 'invalid_skill_archive'))
      } else {
        finish()
      }
    })
  })
}

const assertPathWithin = (baseDir: string, targetPath: string) => {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw badRequest('Skill import target escapes its root', { targetPath }, 'unsafe_skill_import_target')
  }
}

const resolvePhysicalSkillsRoot = async (
  skillsDir: string,
  target: SkillArchiveImportTarget,
  allowedRoot: string
) => {
  await mkdir(dirname(skillsDir), { recursive: true })
  const physicalAllowedRoot = await realpath(allowedRoot).catch(() => path.resolve(allowedRoot))
  try {
    const entry = await lstat(skillsDir)
    if (entry.isSymbolicLink()) {
      if (target !== 'global') {
        throw badRequest('Skill import root cannot be a symbolic link', { skillsDir }, 'unsafe_skill_import_target')
      }
      const resolved = await realpath(skillsDir).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          throw badRequest(
            'Global skill import bridge target does not exist',
            { skillsDir },
            'unsafe_skill_import_target'
          )
        }
        throw error
      })
      assertPathWithin(physicalAllowedRoot, resolved)
      if (!(await lstat(resolved)).isDirectory()) {
        throw badRequest('Skill import root is not a directory', { skillsDir }, 'unsafe_skill_import_target')
      }
      return resolved
    }
    if (!entry.isDirectory()) {
      throw badRequest('Skill import root is not a directory', { skillsDir }, 'unsafe_skill_import_target')
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    await mkdir(skillsDir, { recursive: true })
  }
  const resolvedSkillsDir = await realpath(skillsDir)
  assertPathWithin(physicalAllowedRoot, resolvedSkillsDir)
  return resolvedSkillsDir
}

interface ExtractedSkill {
  fileCount: number
  name: string
  sourceDir: string
}

const inspectExtractedSkills = async (
  extractDir: string,
  limits: Pick<SkillArchiveImportLimits, 'expandedBytes' | 'extractedFiles'>
): Promise<ExtractedSkill[]> => {
  const topLevel = await readdir(extractDir, { withFileTypes: true })
  const skills: ExtractedSkill[] = []
  let totalBytes = 0
  let totalFiles = 0

  for (const topEntry of topLevel) {
    if (!topEntry.isDirectory() || topEntry.isSymbolicLink()) {
      throw badRequest('Archive must contain skill directories at its root', {
        entry: topEntry.name
      }, 'invalid_skill_archive_layout')
    }
    const sourceDir = join(extractDir, topEntry.name)
    const pending = [sourceDir]
    let fileCount = 0
    while (pending.length > 0) {
      const directory = pending.pop()!
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = join(directory, entry.name)
        const entryStat = await lstat(entryPath)
        if (entryStat.isSymbolicLink() || (!entryStat.isDirectory() && !entryStat.isFile())) {
          throw badRequest('Archive contains unsupported entries', { entry: entry.name }, 'unsafe_archive_entry')
        }
        if (entryStat.isDirectory()) {
          pending.push(entryPath)
          continue
        }
        fileCount += 1
        totalFiles += 1
        totalBytes += entryStat.size
        if (totalFiles > limits.extractedFiles) {
          throw badRequest('Archive contains too many files', {
            maxFiles: limits.extractedFiles
          }, 'archive_too_many_files')
        }
        if (totalBytes > limits.expandedBytes) {
          throw badRequest('Archive expands beyond the allowed size', {
            maxBytes: limits.expandedBytes
          }, 'archive_expanded_too_large')
        }
      }
    }
    try {
      if (!(await lstat(join(sourceDir, 'SKILL.md'))).isFile()) throw new Error('not a file')
    } catch {
      throw badRequest('Each imported skill directory must contain SKILL.md', {
        skill: topEntry.name
      }, 'invalid_skill_archive_layout')
    }
    skills.push({ fileCount, name: topEntry.name, sourceDir })
  }
  if (skills.length === 0) throw badRequest('Archive is empty', undefined, 'empty_archive')
  return skills
}

interface SkillReplacement {
  backupDir?: string
  installed: boolean
  sourceDir: string
  stagingDir: string
  targetDir: string
}

const skillTargetExists = async (targetDir: string) => {
  try {
    const targetStat = await lstat(targetDir)
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw badRequest('Skill import target is not a safe directory', {
        targetDir
      }, 'unsafe_skill_import_target')
    }
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    return false
  }
}

const rollbackSkillReplacements = async (replacements: SkillReplacement[], originalError: unknown) => {
  const rollbackErrors: unknown[] = []
  for (const replacement of [...replacements].reverse()) {
    try {
      if (replacement.installed) await rm(replacement.targetDir, { recursive: true, force: true })
      if (replacement.backupDir != null) await rename(replacement.backupDir, replacement.targetDir)
      await rm(replacement.stagingDir, { recursive: true, force: true })
    } catch (error) {
      rollbackErrors.push(error)
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError([originalError, ...rollbackErrors], 'Skill import rollback failed')
  }
}

const withSkillArchiveInstallLock = async <T>(
  physicalSkillsRoot: string,
  callback: () => Promise<T>
) => {
  try {
    return await withDirectoryInstallLock({
      lockDir: `${physicalSkillsRoot}.oneworks-skill-import-lock`,
      waitTimeoutMs: 0
    }, callback)
  } catch (error) {
    if (error instanceof DirectoryInstallLockBusyError) {
      throw conflict(
        'Another skill archive import is already in progress',
        undefined,
        'skill_import_in_progress'
      )
    }
    throw error
  }
}

const installExtractedSkills = async (params: {
  beforeStage?: () => Promise<void>
  force: boolean
  physicalSkillsRoot: string
  skills: ExtractedSkill[]
}) =>
  withSkillArchiveInstallLock(params.physicalSkillsRoot, async () => {
    const operationId = randomUUID()
    const replacements: SkillReplacement[] = []
    try {
      for (const skill of params.skills) {
        const targetDir = join(params.physicalSkillsRoot, skill.name)
        assertPathWithin(params.physicalSkillsRoot, targetDir)
        if (await skillTargetExists(targetDir) && !params.force) {
          throw conflict('Skill already exists; explicit force is required to replace it', {
            skill: skill.name
          }, 'skill_import_conflict')
        }
        const stagingDir = join(
          params.physicalSkillsRoot,
          `.oneworks-skill-import-staging-${operationId}-${skill.name}`
        )
        replacements.push({ installed: false, sourceDir: skill.sourceDir, stagingDir, targetDir })
      }

      await params.beforeStage?.()
      for (const replacement of replacements) {
        await cp(replacement.sourceDir, replacement.stagingDir, {
          recursive: true,
          errorOnExist: true,
          force: false
        })
      }

      for (const replacement of replacements) {
        if (await skillTargetExists(replacement.targetDir)) {
          if (!params.force) {
            throw conflict('Skill already exists; explicit force is required to replace it', {
              skill: path.basename(replacement.targetDir)
            }, 'skill_import_conflict')
          }
          const backupDir = `${replacement.targetDir}.oneworks-skill-import-backup-${operationId}`
          await rename(replacement.targetDir, backupDir)
          replacement.backupDir = backupDir
        }
      }
      for (const replacement of replacements) {
        await rename(replacement.stagingDir, replacement.targetDir)
        replacement.installed = true
      }
    } catch (error) {
      await rollbackSkillReplacements(replacements, error)
      throw error
    }

    await Promise.all(replacements.map(replacement =>
      replacement.backupDir == null
        ? Promise.resolve()
        : rm(replacement.backupDir, { recursive: true, force: true }).catch(() => undefined)
    ))
  })

export const importSkillArchive = async (
  workspaceRoot: string,
  req: IncomingMessage,
  archiveNameHeader: string | undefined,
  target: SkillArchiveImportTarget = 'project',
  options: SkillArchiveImportOptions = {}
) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'ow-skill-import-'))
  const archiveName = sanitizeArchiveName(decodeArchiveName(archiveNameHeader))
  const archivePath = join(tempRoot, archiveName)
  const extractDir = join(tempRoot, 'extract')
  const skillsDir = resolveSkillArchiveImportDir(workspaceRoot, target)
  const allowedRoot = target === 'global' ? resolveProjectRealHome(process.env) : workspaceRoot
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits }

  try {
    const archiveTool = await resolveArchiveTool()
    await mkdir(extractDir, { recursive: true })
    await writeArchiveWithLimit(req, archivePath, limits.archiveBytes)
    await assertSafeArchiveEntries(archiveTool, archivePath, limits.archiveEntries)
    await assertExpandedArchiveWithinLimit(archiveTool, archivePath, limits.expandedBytes)
    await execFileAsync(archiveTool, [
      '-xf',
      archivePath,
      '-C',
      extractDir,
      '--no-same-owner',
      '--no-same-permissions'
    ], {
      encoding: 'utf8',
      maxBuffer: MAX_ARCHIVE_STDERR_BYTES,
      timeout: ARCHIVE_TOOL_TIMEOUT_MS
    })
    const skills = await inspectExtractedSkills(extractDir, limits)
    const physicalSkillsRoot = await resolvePhysicalSkillsRoot(skillsDir, target, allowedRoot)
    await installExtractedSkills({
      beforeStage: options.beforeStage,
      force: options.force === true,
      physicalSkillsRoot,
      skills
    })

    return {
      fileCount: skills.reduce((sum, skill) => sum + skill.fileCount, 0),
      targetDir: target === 'global' ? '~/.agents/skills' : '.oo/skills'
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error
    throw internalServerError('Failed to import skill archive', {
      cause: error,
      code: 'skill_archive_import_failed'
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
