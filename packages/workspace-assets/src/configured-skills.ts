/* eslint-disable max-lines -- configured skill resolution keeps matching, warnings, and CLI sync policy together. */
import { access } from 'node:fs/promises'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import process from 'node:process'

import type {
  Config,
  ConfiguredSkillCollectionConfig,
  ConfiguredSkillIncludeConfig,
  ConfiguredSkillInstallConfig
} from '@oneworks/types'
import {
  isConfiguredSkillCollectionInstall,
  isWildcardSkillInclude,
  normalizeProjectSkillInstall,
  readProjectSkillsLockfile,
  resolveConfiguredSkillInstalls as resolveDeclaredConfiguredSkillInstalls,
  resolveProjectOoPath,
  toSkillSlug
} from '@oneworks/utils'
import type { NormalizedProjectSkillInstall, ProjectSkillLockEntry } from '@oneworks/utils'

interface NormalizedConfiguredSkillCollection {
  include?: ConfiguredSkillCollectionConfig['include']
  registry?: string
  source: string
  version?: string
}

interface MissingConfiguredProjectSkillCollection extends NormalizedConfiguredSkillCollection {
  missingTargets?: string[]
}

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const resolveConfiguredProjectSkillDeclarations = (configs: [Config?, Config?]) => [
  ...resolveDeclaredConfiguredSkillInstalls(configs[0]?.skills),
  ...resolveDeclaredConfiguredSkillInstalls(configs[1]?.skills)
]

export const resolveConfiguredProjectSkillInstalls = (configs: [Config?, Config?]) => (
  resolveConfiguredProjectSkillDeclarations(configs)
    .map((item) => normalizeProjectSkillInstall(item as string | ConfiguredSkillInstallConfig))
    .filter((item): item is NormalizedProjectSkillInstall => item != null)
)

export const resolveConfiguredProjectSkillCollections = (configs: [Config?, Config?]) => (
  resolveConfiguredProjectSkillDeclarations(configs)
    .map((item) => {
      if (!isConfiguredSkillCollectionInstall(item)) return undefined
      const source = normalizeNonEmptyString(item.source)
      if (source == null) return undefined
      const registry = normalizeNonEmptyString(item.registry)
      const version = normalizeNonEmptyString(item.version)
      return {
        ...(item.include == null ? {} : { include: item.include }),
        ...(registry == null ? {} : { registry }),
        source,
        ...(version == null ? {} : { version })
      }
    })
    .filter((item): item is NormalizedConfiguredSkillCollection => item != null)
)

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

const isWildcardCollection = (collection: NormalizedConfiguredSkillCollection) => (
  collection.include == null ||
  collection.include.length === 0 ||
  collection.include.some(isWildcardSkillInclude)
)

const normalizeCollectionTarget = (
  include: ConfiguredSkillIncludeConfig
) => {
  if (isWildcardSkillInclude(include)) return undefined

  const name = normalizeNonEmptyString(typeof include === 'string' ? include : include.name)
  if (name == null) return undefined
  const rename = typeof include === 'string' ? undefined : normalizeNonEmptyString(include.rename)
  const targetName = rename ?? name
  const targetDirName = toSkillSlug(targetName)
  if (targetDirName === '') return undefined

  return {
    targetDirName,
    targetName
  }
}

const lockEntryMatchesCollection = (
  entry: ProjectSkillLockEntry,
  collection: NormalizedConfiguredSkillCollection
) => (
  entry.source === collection.source &&
  (collection.registry == null || entry.registry === collection.registry) &&
  (collection.version == null || entry.version === collection.version)
)

const resolveLockEntrySkillPath = (workspaceFolder: string, entry: ProjectSkillLockEntry) => {
  const installDir = isAbsolute(entry.installPath)
    ? entry.installPath
    : resolvePath(workspaceFolder, entry.installPath)
  return join(installDir, 'SKILL.md')
}

const hasInstalledCollectionLockEntry = async (params: {
  collection: NormalizedConfiguredSkillCollection
  entries: Record<string, ProjectSkillLockEntry>
  workspaceFolder: string
}) => {
  for (const entry of Object.values(params.entries)) {
    if (!lockEntryMatchesCollection(entry, params.collection)) continue
    if (await pathExists(resolveLockEntrySkillPath(params.workspaceFolder, entry))) return true
  }

  return false
}

const hasInstalledSkillTarget = async (params: {
  entries: Record<string, ProjectSkillLockEntry>
  targetDirName: string
  workspaceFolder: string
}) => {
  const entry = params.entries[params.targetDirName]
  if (entry != null && await pathExists(resolveLockEntrySkillPath(params.workspaceFolder, entry))) return true

  const skillPath = resolveProjectOoPath(
    params.workspaceFolder,
    process.env,
    'skills',
    params.targetDirName,
    'SKILL.md'
  )
  return pathExists(skillPath)
}

export const ensureUniqueConfiguredSkillTargets = (skills: NormalizedProjectSkillInstall[]) => {
  const seen = new Map<string, string>()

  for (const skill of skills) {
    const previous = seen.get(skill.targetDirName)
    if (previous != null) {
      throw new Error(
        `Configured skills "${previous}" and "${skill.ref}" resolve to the same target "${skill.targetDirName}"`
      )
    }
    seen.set(skill.targetDirName, skill.ref)
  }
}

export const findMissingConfiguredProjectSkills = async (params: {
  configs: [Config?, Config?]
  workspaceFolder: string
}) => {
  const installs = resolveConfiguredProjectSkillInstalls(params.configs)
  if (installs.length === 0) {
    return []
  }

  ensureUniqueConfiguredSkillTargets(installs)

  const lockfile = await readProjectSkillsLockfile(params.workspaceFolder)
  const missing: NormalizedProjectSkillInstall[] = []
  for (const skill of installs) {
    if (
      !await hasInstalledSkillTarget({
        entries: lockfile.skills ?? {},
        targetDirName: skill.targetDirName,
        workspaceFolder: params.workspaceFolder
      })
    ) {
      missing.push(skill)
    }
  }

  return missing
}

export const findMissingConfiguredProjectSkillCollections = async (params: {
  configs: [Config?, Config?]
  workspaceFolder: string
}) => {
  const collections = resolveConfiguredProjectSkillCollections(params.configs)
  if (collections.length === 0) return []

  const lockfile = await readProjectSkillsLockfile(params.workspaceFolder)
  const missing: MissingConfiguredProjectSkillCollection[] = []
  const seen = new Set<string>()

  const addMissing = (collection: MissingConfiguredProjectSkillCollection) => {
    const key = [
      collection.source,
      collection.registry ?? '',
      collection.version ?? '',
      collection.missingTargets?.join('|') ?? '*'
    ].join('\0')
    if (seen.has(key)) return
    seen.add(key)
    missing.push(collection)
  }

  for (const collection of collections) {
    if (isWildcardCollection(collection)) {
      if (
        !await hasInstalledCollectionLockEntry({
          collection,
          entries: lockfile.skills ?? {},
          workspaceFolder: params.workspaceFolder
        })
      ) {
        addMissing(collection)
      }
      continue
    }

    const missingTargets: string[] = []
    for (const include of collection.include ?? []) {
      const target = normalizeCollectionTarget(include)
      if (target == null) continue
      if (
        !await hasInstalledSkillTarget({
          entries: lockfile.skills ?? {},
          targetDirName: target.targetDirName,
          workspaceFolder: params.workspaceFolder
        })
      ) {
        missingTargets.push(target.targetName)
      }
    }

    if (missingTargets.length > 0) {
      addMissing({
        ...collection,
        missingTargets
      })
    }
  }

  return missing
}

const formatMissingCollectionLabel = (collection: MissingConfiguredProjectSkillCollection) => {
  const sourceLabel = collection.version == null
    ? collection.source
    : `${collection.source}@${collection.version}`
  if (collection.missingTargets == null || collection.missingTargets.length === 0) return sourceLabel
  return `${sourceLabel} (${collection.missingTargets.join(', ')})`
}

export const warnMissingConfiguredProjectSkills = async (params: {
  configs: [Config?, Config?]
  workspaceFolder: string
}) => {
  const missing = await findMissingConfiguredProjectSkills(params)
  const missingCollections = await findMissingConfiguredProjectSkillCollections(params)
  if (missing.length === 0 && missingCollections.length === 0) return []

  if (missing.length > 0) {
    const names = missing.map(skill => skill.targetName).join(', ')
    console.warn(
      `[oneworks] Declared skills are not installed: ${names}. ` +
        'Run `oneworks skills install` to install all declared skills, or `oneworks skills install <name>` for one skill.'
    )
  }

  if (missingCollections.length > 0) {
    const sources = missingCollections.map(formatMissingCollectionLabel).join(', ')
    console.warn(
      `[oneworks] Declared skill sources are not installed: ${sources}. ` +
        'Run `oneworks skills install` to install all declared skills.'
    )
  }

  return missing
}
