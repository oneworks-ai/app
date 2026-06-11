/* eslint-disable max-lines -- lockfile schema, YAML IO, and deterministic serialization stay together. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'

import { dump, load } from 'js-yaml'

import { resolveProjectOoPath } from '../ai-path'
import { pathExists } from './shared'

export interface ProjectSkillLockConstraint {
  from: string
  version?: string
}

export interface ProjectSkillLockEntry {
  constraints?: ProjectSkillLockConstraint[]
  dependencies?: string[]
  dependencyOf?: string[]
  hash: string
  installedAt: string
  installPath: string
  name?: string
  pluginInstance?: string
  pluginInstancePath?: string
  registry?: string
  requested: boolean
  resolved?: string
  source?: string
  version?: string
}

export interface ProjectSkillsLockfile {
  pluginSkills?: Record<string, ProjectSkillLockEntry>
  skills?: Record<string, ProjectSkillLockEntry>
  version: 1
}

const LOCKFILE_NAME = 'skills.lock.yaml'

const shouldIgnoreHashEntry = (name: string) => (
  name === '.DS_Store' ||
  name.endsWith('.tmp') ||
  name.endsWith('.lock')
)

const toRelativeInstallPath = (workspaceFolder: string, installDir: string) => (
  relative(workspaceFolder, installDir).split(/[\\/]+/).join('/')
)

const normalizeRecord = (value: unknown) => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeStringList = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeString).filter((item): item is string => item != null)
    : undefined
)

const normalizeConstraints = (value: unknown) => (
  Array.isArray(value)
    ? value
      .map((item) => {
        const record = normalizeRecord(item)
        const from = normalizeString(record?.from)
        if (from == null) return undefined
        const version = normalizeString(record?.version)
        return {
          from,
          ...(version == null ? {} : { version })
        }
      })
      .filter((item): item is ProjectSkillLockConstraint => item != null)
    : undefined
)

const normalizeLockEntry = (value: unknown): ProjectSkillLockEntry | undefined => {
  const record = normalizeRecord(value)
  if (record == null) return undefined
  const hash = normalizeString(record.hash)
  const installedAt = normalizeString(record.installedAt)
  const installPath = normalizeString(record.installPath)
  if (hash == null || installedAt == null || installPath == null) return undefined

  return {
    ...(normalizeConstraints(record.constraints) == null
      ? {}
      : { constraints: normalizeConstraints(record.constraints) }),
    ...(normalizeStringList(record.dependencies) == null
      ? {}
      : { dependencies: normalizeStringList(record.dependencies) }),
    ...(normalizeStringList(record.dependencyOf) == null
      ? {}
      : { dependencyOf: normalizeStringList(record.dependencyOf) }),
    hash,
    installedAt,
    installPath,
    ...(normalizeString(record.name) == null ? {} : { name: normalizeString(record.name) }),
    ...(normalizeString(record.pluginInstance) == null
      ? {}
      : { pluginInstance: normalizeString(record.pluginInstance) }),
    ...(normalizeString(record.pluginInstancePath) == null
      ? {}
      : { pluginInstancePath: normalizeString(record.pluginInstancePath) }),
    ...(normalizeString(record.registry) == null ? {} : { registry: normalizeString(record.registry) }),
    requested: record.requested === true,
    ...(normalizeString(record.resolved) == null ? {} : { resolved: normalizeString(record.resolved) }),
    ...(normalizeString(record.source) == null ? {} : { source: normalizeString(record.source) }),
    ...(normalizeString(record.version) == null ? {} : { version: normalizeString(record.version) })
  }
}

const normalizeLockEntries = (value: unknown) => {
  const record = normalizeRecord(value)
  if (record == null) return undefined
  const entries = Object.entries(record)
    .map(([key, entry]) => [key, normalizeLockEntry(entry)] as const)
    .filter((entry): entry is readonly [string, ProjectSkillLockEntry] => entry[1] != null)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(stripUndefined)
      .filter(item => item !== undefined)
  }

  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, stripUndefined(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
    return Object.fromEntries(entries)
  }

  return value
}

const parseLockfile = (content: string): ProjectSkillsLockfile => {
  const parsed = normalizeRecord(load(content)) ?? {}
  return {
    version: 1,
    ...(normalizeLockEntries(parsed.skills) == null ? {} : { skills: normalizeLockEntries(parsed.skills) }),
    ...(normalizeLockEntries(parsed.pluginSkills) == null
      ? {}
      : { pluginSkills: normalizeLockEntries(parsed.pluginSkills) })
  }
}

export const resolveProjectSkillsLockfilePath = (workspaceFolder: string) => (
  resolveProjectOoPath(workspaceFolder, process.env, LOCKFILE_NAME)
)

export const readProjectSkillsLockfile = async (
  workspaceFolder: string
): Promise<ProjectSkillsLockfile> => {
  const lockfilePath = resolveProjectSkillsLockfilePath(workspaceFolder)
  if (!await pathExists(lockfilePath)) return { version: 1 }

  const content = await readFile(lockfilePath, 'utf8')
  try {
    return parseLockfile(content)
  } catch {
    return { version: 1 }
  }
}

export const writeProjectSkillsLockfile = async (
  workspaceFolder: string,
  lockfile: ProjectSkillsLockfile
) => {
  const lockfilePath = resolveProjectSkillsLockfilePath(workspaceFolder)
  const content = dump(
    stripUndefined({
      version: 1,
      ...(lockfile.skills == null || Object.keys(lockfile.skills).length === 0 ? {} : { skills: lockfile.skills }),
      ...(lockfile.pluginSkills == null || Object.keys(lockfile.pluginSkills).length === 0
        ? {}
        : { pluginSkills: lockfile.pluginSkills })
    }),
    {
      lineWidth: 120,
      noRefs: true
    }
  )
  await mkdir(dirname(lockfilePath), { recursive: true })
  await writeFile(lockfilePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
}

const collectHashFiles = async (rootDir: string, currentDir = rootDir): Promise<string[]> => {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (shouldIgnoreHashEntry(entry.name)) continue
    const entryPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectHashFiles(rootDir, entryPath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

export const computeSkillDirectoryHash = async (installDir: string) => {
  const hash = createHash('sha256')
  const files = (await collectHashFiles(installDir))
    .sort((left, right) => left.localeCompare(right))

  for (const file of files) {
    const relativePath = relative(installDir, file).split(/[\\/]+/).join('/')
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }

  return `sha256:${hash.digest('hex')}`
}

export const assertSkillDirectoryUnchanged = async (params: {
  expectedHash?: string
  installDir: string
}) => {
  if (params.expectedHash == null || !await pathExists(params.installDir)) return
  const currentHash = await computeSkillDirectoryHash(params.installDir)
  if (currentHash !== params.expectedHash) {
    throw new Error(
      `Installed skill at ${params.installDir} has local changes. Refusing to overwrite or remove it.`
    )
  }
}

export const buildProjectSkillLockEntry = (params: {
  constraints?: ProjectSkillLockConstraint[]
  dependencies?: string[]
  dependencyOf?: string[]
  hash: string
  installDir: string
  name?: string
  pluginInstance?: string
  pluginInstancePath?: string
  registry?: string
  requested: boolean
  resolved?: string
  source?: string
  version?: string
  workspaceFolder: string
}): ProjectSkillLockEntry => ({
  ...(params.constraints == null || params.constraints.length === 0 ? {} : { constraints: params.constraints }),
  ...(params.dependencies == null || params.dependencies.length === 0 ? {} : { dependencies: params.dependencies }),
  ...(params.dependencyOf == null || params.dependencyOf.length === 0 ? {} : { dependencyOf: params.dependencyOf }),
  hash: params.hash,
  installedAt: new Date().toISOString(),
  installPath: toRelativeInstallPath(params.workspaceFolder, params.installDir),
  ...(params.name == null ? {} : { name: params.name }),
  ...(params.pluginInstance == null ? {} : { pluginInstance: params.pluginInstance }),
  ...(params.pluginInstancePath == null ? {} : { pluginInstancePath: params.pluginInstancePath }),
  ...(params.registry == null ? {} : { registry: params.registry }),
  requested: params.requested,
  ...(params.resolved == null ? {} : { resolved: params.resolved }),
  ...(params.source == null ? {} : { source: params.source }),
  ...(params.version == null ? {} : { version: params.version })
})
