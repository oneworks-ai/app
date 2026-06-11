/* eslint-disable max-lines -- skill sync coordinates install planning, lockfile updates, and cleanup. */
import { readdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type { ConfiguredSkillInstallConfig, WorkspaceAsset } from '@oneworks/types'
import {
  assertSkillDirectoryUnchanged,
  buildProjectSkillLockEntry,
  installProjectSkill,
  installProjectSkillCollection,
  isConfiguredSkillCollectionInstall,
  isWildcardSkillInclude,
  normalizeProjectSkillInstall,
  readProjectSkillDependencies,
  readProjectSkillsLockfile,
  resolveProjectOoPath,
  toSkillSlug,
  writeProjectSkillsLockfile
} from '@oneworks/utils'
import type {
  NormalizedProjectSkillDependency,
  NormalizedProjectSkillInstall,
  ProjectSkillLockConstraint
} from '@oneworks/utils'
import { resolveWorkspaceAssetBundle } from '@oneworks/workspace-assets'

import type { ResolvedSkillInstallTarget } from './install'
import type { SkillsProgressReporter } from './progress'
import type { loadSkillsConfigState } from './shared'

type SkillAsset = Extract<WorkspaceAsset, { kind: 'skill' }>
type SkillsConfigState = Awaited<ReturnType<typeof loadSkillsConfigState>>
type SyncTarget = string | ConfiguredSkillInstallConfig | ResolvedSkillInstallTarget

interface ScopeState {
  installPathSegments: string[]
  kind: 'project' | 'plugin'
  pluginInstance?: string
  pluginInstancePath?: string
  pluginRootSeen?: Set<string>
  seen: Map<string, SeenSkill>
}

interface SeenSkill {
  constraints: ProjectSkillLockConstraint[]
  dependencyOf: string[]
  normalized: NormalizedProjectSkillInstall
}

interface SyncSkillParams {
  constraint?: ProjectSkillLockConstraint
  dependencyOf?: string
  installedResult?: {
    dirName: string
    hash: string
    installDir: string
    name: string
    ref: string
    skillPath: string
  }
  normalized: NormalizedProjectSkillInstall
  requested: boolean
  scope: ScopeState
}

const toUniqueStrings = (values: string[]) => Array.from(new Set(values.filter(value => value.trim() !== '')))

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isResolvedSkillInstallTarget = (value: SyncTarget): value is ResolvedSkillInstallTarget => (
  isRecord(value) && 'declaration' in value
)

const normalizeSyncTarget = (value: SyncTarget): ResolvedSkillInstallTarget => (
  isResolvedSkillInstallTarget(value)
    ? value
    : {
      declaration: value,
      installPathSegments: []
    }
)

const toInstallPathSegment = (value: string, fallback: string) => {
  const segment = toSkillSlug(value).replace(/:/g, '-')
  return segment === '' ? fallback : segment
}

const resolveCollectionInstallPathSegments = (
  target: ConfiguredSkillInstallConfig,
  baseSegments: string[]
) => (
  isConfiguredSkillCollectionInstall(target)
    ? [...baseSegments, toInstallPathSegment(target.source, 'source')]
    : baseSegments
)

const toPluginInstanceKey = (asset: SkillAsset) => {
  const raw = asset.scope ?? asset.instancePath ?? asset.packageId ?? asset.displayName
  const slug = toSkillSlug(raw)
  return slug === '' ? 'plugin' : slug
}

const normalizeDependencyInstall = (dependency: NormalizedProjectSkillDependency) => (
  normalizeProjectSkillInstall({
    name: dependency.name,
    ...(dependency.registry == null ? {} : { registry: dependency.registry }),
    ...(dependency.source == null ? {} : { source: dependency.source }),
    ...(dependency.version == null ? {} : { version: dependency.version })
  })
)

const compareVersions = (left: string, right: string) => {
  const leftParts = left.split('.').map(part => Number.parseInt(part, 10))
  const rightParts = right.split('.').map(part => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index]! : 0
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index]! : 0
    if (leftPart !== rightPart) return leftPart - rightPart
  }
  return 0
}

const normalizeExactVersion = (value: string | undefined) => {
  if (value == null) return undefined
  const trimmed = value.trim()
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(trimmed) ? trimmed : undefined
}

const rangeAllowsExact = (range: string, exact: string) => {
  const trimmed = range.trim()
  if (trimmed === exact) return true
  if (trimmed.startsWith('^')) {
    const base = normalizeExactVersion(trimmed.slice(1))
    if (base == null) return false
    return exact.split('.')[0] === base.split('.')[0] && compareVersions(exact, base) >= 0
  }

  const match = /^>=\s*(\d+\.\d+\.\d+)\s+<\s*(\d+\.\d+\.\d+)$/.exec(trimmed)
  if (match != null) {
    return compareVersions(exact, match[1]!) >= 0 && compareVersions(exact, match[2]!) < 0
  }

  return false
}

const assertVersionConstraintsCompatible = (params: {
  constraints: ProjectSkillLockConstraint[]
  name: string
}) => {
  const versions = toUniqueStrings(params.constraints.map(constraint => constraint.version ?? ''))
  if (versions.length <= 1) return

  const exactVersions = versions.map(normalizeExactVersion).filter((value): value is string => value != null)
  const uniqueExactVersions = toUniqueStrings(exactVersions)
  if (uniqueExactVersions.length > 1) {
    throw new Error(`Conflicting dependency versions for ${params.name}: ${versions.join(', ')}`)
  }

  if (uniqueExactVersions.length === 1) {
    const exact = uniqueExactVersions[0]!
    const incompatible = versions.filter(version =>
      normalizeExactVersion(version) == null && !rangeAllowsExact(version, exact)
    )
    if (incompatible.length > 0) {
      throw new Error(`Conflicting dependency versions for ${params.name}: ${versions.join(', ')}`)
    }
    return
  }

  throw new Error(`Conflicting dependency version ranges for ${params.name}: ${versions.join(', ')}`)
}

const assertSameSource = (left: NormalizedProjectSkillInstall, right: NormalizedProjectSkillInstall) => {
  if (
    left.name !== right.name ||
    (left.source ?? '') !== (right.source ?? '') ||
    (left.registry ?? '') !== (right.registry ?? '')
  ) {
    throw new Error(`Conflicting dependency sources for ${left.targetName}.`)
  }
}

const findPluginSkillDependency = (
  pluginSkills: SkillAsset[],
  scope: ScopeState,
  dependency: NormalizedProjectSkillDependency
) => {
  if (scope.kind !== 'plugin') return undefined
  const slug = toSkillSlug(dependency.name)
  return pluginSkills.find(asset => (
    asset.instancePath === scope.pluginInstancePath &&
    (asset.name === dependency.name || toSkillSlug(asset.name) === slug)
  ))
}

const readDependenciesOrEmpty = async (skillPath: string) => {
  try {
    return await readProjectSkillDependencies(skillPath)
  } catch {
    return []
  }
}

const formatVersionedRef = (value: {
  source: string
  version?: string
}) => (
  value.version == null || value.version.trim() === ''
    ? value.source
    : `${value.source}@${value.version}`
)

const formatCollectionIncludes = (target: ConfiguredSkillInstallConfig) => {
  if (!isConfiguredSkillCollectionInstall(target)) return undefined
  if (target.include == null || target.include.length === 0 || target.include.some(isWildcardSkillInclude)) {
    return undefined
  }

  return target.include
    .map(include => typeof include === 'string' ? include : (include.rename ?? include.name))
    .filter(value => value.trim() !== '')
    .join(', ')
}

const formatCollectionProgressLabel = (target: ConfiguredSkillInstallConfig) => {
  if (!isConfiguredSkillCollectionInstall(target)) return 'source'
  const source = formatVersionedRef(target)
  const includes = formatCollectionIncludes(target)
  return includes == null || includes === '' ? `source ${source}` : `source ${source} (${includes})`
}

const formatSkillProgressLabel = (params: SyncSkillParams) => {
  if (params.scope.kind === 'plugin') return `plugin dependency ${params.normalized.targetName}`
  return params.requested ? `skill ${params.normalized.targetName}` : `dependency ${params.normalized.targetName}`
}

const normalizeInstallPath = (installPath: string) => path.resolve(installPath)

const pruneEmptyAncestorDirs = async (params: {
  startDir: string
  stopDir: string
}) => {
  const stopDir = normalizeInstallPath(params.stopDir)
  let currentDir = path.dirname(normalizeInstallPath(params.startDir))
  while (currentDir.startsWith(`${stopDir}${path.sep}`) && currentDir !== stopDir) {
    try {
      await rmdir(currentDir)
    } catch {
      return
    }
    currentDir = path.dirname(currentDir)
  }
}

const pruneEmptyDirectoryTree = async (dir: string): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined)
  if (entries == null) return

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    await pruneEmptyDirectoryTree(path.join(dir, entry.name))
  }

  await rmdir(dir).catch(() => undefined)
}

export const syncProjectSkills = async (params: {
  force?: boolean
  progress?: SkillsProgressReporter
  registry?: string
  state: SkillsConfigState
  targets: SyncTarget[]
  workspaceFolder: string
}) => {
  const lockfile = await readProjectSkillsLockfile(params.workspaceFolder)
  const nextLockfile = {
    version: 1 as const,
    ...(lockfile.skills == null ? {} : { skills: { ...lockfile.skills } }),
    ...(lockfile.pluginSkills == null ? {} : { pluginSkills: { ...lockfile.pluginSkills } })
  }
  const installed: Array<{
    dirName: string
    hash: string
    installDir: string
    name: string
    ref: string
    skipped?: boolean
  }> = []
  const pluginSkillKeys = new Set<string>()
  const bundle = await resolveWorkspaceAssetBundle({
    cwd: params.workspaceFolder,
    configs: [params.state.effectiveProjectConfig ?? params.state.projectConfig, params.state.userConfig],
    useDefaultOneworksMcpServer: false
  })
  const pluginSkills = bundle.skills.filter(asset => asset.origin === 'plugin')

  const runProgressStep = async <T>(label: string, callback: () => Promise<T>) => {
    params.progress?.startStep(label)
    try {
      const result = await callback()
      params.progress?.completeStep(label)
      return result
    } catch (error) {
      params.progress?.failStep(label)
      throw error
    }
  }

  const syncSkill = async (syncParams: SyncSkillParams): Promise<void> => {
    const lockKey = syncParams.scope.kind === 'project'
      ? syncParams.normalized.targetDirName
      : `${syncParams.scope.pluginInstance}/${syncParams.normalized.targetDirName}`
    const existing = syncParams.scope.seen.get(lockKey)
    const constraints = [
      ...(existing?.constraints ?? []),
      ...(syncParams.constraint == null ? [] : [syncParams.constraint])
    ]
    const dependencyOf = toUniqueStrings([
      ...(existing?.dependencyOf ?? []),
      ...(syncParams.dependencyOf == null ? [] : [syncParams.dependencyOf])
    ])

    if (existing != null) {
      assertSameSource(existing.normalized, syncParams.normalized)
      assertVersionConstraintsCompatible({
        constraints,
        name: syncParams.normalized.targetName
      })
      existing.constraints = constraints
      existing.dependencyOf = dependencyOf
      const entry = syncParams.scope.kind === 'project'
        ? nextLockfile.skills?.[lockKey]
        : nextLockfile.pluginSkills?.[lockKey]
      if (entry != null) {
        entry.constraints = constraints.length === 0 ? undefined : constraints
        entry.dependencyOf = dependencyOf.length === 0 ? undefined : dependencyOf
      }
      return
    }

    syncParams.scope.seen.set(lockKey, {
      constraints,
      dependencyOf,
      normalized: syncParams.normalized
    })
    assertVersionConstraintsCompatible({
      constraints,
      name: syncParams.normalized.targetName
    })

    const previousEntry = syncParams.scope.kind === 'project'
      ? lockfile.skills?.[lockKey]
      : lockfile.pluginSkills?.[lockKey]
    const result = syncParams.installedResult ?? await runProgressStep(
      formatSkillProgressLabel(syncParams),
      () =>
        installProjectSkill({
          expectedHash: previousEntry?.hash,
          force: params.force,
          installPathSegments: syncParams.scope.installPathSegments,
          registry: params.registry,
          skill: syncParams.normalized,
          workspaceFolder: params.workspaceFolder
        })
    )
    const previousInstallDir = previousEntry == null
      ? undefined
      : path.resolve(params.workspaceFolder, previousEntry.installPath)
    const movedPreviousInstall = previousInstallDir != null &&
      normalizeInstallPath(previousInstallDir) !== normalizeInstallPath(result.installDir)
    if (movedPreviousInstall) {
      await assertSkillDirectoryUnchanged({
        expectedHash: previousEntry?.hash,
        installDir: previousInstallDir
      })
      await rm(previousInstallDir, { recursive: true, force: true })
      await pruneEmptyAncestorDirs({
        startDir: previousInstallDir,
        stopDir: resolveProjectOoPath(params.workspaceFolder, process.env, 'skills')
      })
    }

    installed.push({
      dirName: result.dirName,
      hash: result.hash,
      installDir: result.installDir,
      name: result.name,
      ref: result.ref,
      skipped: params.force !== true && previousEntry != null && !movedPreviousInstall
    })

    const dependencies = await readDependenciesOrEmpty(result.skillPath)
    const dependencyNames = dependencies
      .map(dependency => normalizeDependencyInstall(dependency)?.targetDirName)
      .filter((value): value is string => value != null)

    const entry = buildProjectSkillLockEntry({
      constraints,
      dependencies: dependencyNames,
      dependencyOf,
      hash: result.hash,
      installDir: result.installDir,
      name: syncParams.normalized.targetName,
      ...(syncParams.scope.pluginInstance == null ? {} : { pluginInstance: syncParams.scope.pluginInstance }),
      ...(syncParams.scope.pluginInstancePath == null
        ? {}
        : { pluginInstancePath: syncParams.scope.pluginInstancePath }),
      registry: params.registry ?? syncParams.normalized.registry,
      requested: syncParams.requested,
      source: syncParams.normalized.source,
      version: syncParams.normalized.version,
      workspaceFolder: params.workspaceFolder
    })

    if (syncParams.scope.kind === 'project') {
      nextLockfile.skills = {
        ...(nextLockfile.skills ?? {}),
        [lockKey]: entry
      }
    } else {
      nextLockfile.pluginSkills = {
        ...(nextLockfile.pluginSkills ?? {}),
        [lockKey]: entry
      }
      pluginSkillKeys.add(lockKey)
    }

    for (const dependency of dependencies) {
      const pluginDependency = findPluginSkillDependency(pluginSkills, syncParams.scope, dependency)
      if (pluginDependency != null) {
        await syncPluginSkillRoot(syncParams.scope, pluginDependency)
        continue
      }

      const normalizedDependency = normalizeDependencyInstall(dependency)
      if (normalizedDependency == null) continue
      await syncSkill({
        constraint: dependency.version == null
          ? undefined
          : {
            from: syncParams.scope.kind === 'project'
              ? syncParams.normalized.targetName
              : `plugin:${syncParams.scope.pluginInstance}`,
            version: dependency.version
          },
        dependencyOf: syncParams.scope.kind === 'project'
          ? syncParams.normalized.targetName
          : `plugin:${syncParams.scope.pluginInstance}`,
        normalized: normalizedDependency,
        requested: false,
        scope: syncParams.scope
      })
    }
  }

  const syncPluginSkillRoot = async (scope: ScopeState, asset: SkillAsset) => {
    if (scope.pluginRootSeen?.has(asset.id)) return
    scope.pluginRootSeen?.add(asset.id)

    const dependencies = await readDependenciesOrEmpty(asset.sourcePath)
    for (const dependency of dependencies) {
      const pluginDependency = findPluginSkillDependency(pluginSkills, scope, dependency)
      if (pluginDependency != null) {
        await syncPluginSkillRoot(scope, pluginDependency)
        continue
      }

      const normalizedDependency = normalizeDependencyInstall(dependency)
      if (normalizedDependency == null) continue
      await syncSkill({
        constraint: dependency.version == null
          ? undefined
          : { from: `plugin:${asset.displayName}`, version: dependency.version },
        dependencyOf: `plugin:${asset.displayName}`,
        normalized: normalizedDependency,
        requested: false,
        scope
      })
    }
  }

  const projectSeen = new Map<string, SeenSkill>()
  const createProjectScope = (installPathSegments: string[]): ScopeState => ({
    installPathSegments,
    kind: 'project',
    seen: projectSeen
  })

  for (const rawTarget of params.targets) {
    const syncTarget = normalizeSyncTarget(rawTarget)
    const target = syncTarget.declaration
    const baseInstallPathSegments = syncTarget.installPathSegments ?? []
    if (isConfiguredSkillCollectionInstall(target)) {
      const installPathSegments = resolveCollectionInstallPathSegments(target, baseInstallPathSegments)
      const collectionResults = await runProgressStep(
        formatCollectionProgressLabel(target),
        () =>
          installProjectSkillCollection({
            expectedHashes: Object.fromEntries(
              Object.entries(lockfile.skills ?? {}).map(([key, entry]) => [key, entry.hash])
            ),
            force: params.force,
            include: target.include,
            installPathSegments,
            registry: params.registry ?? target.registry,
            source: target.source,
            version: target.version,
            workspaceFolder: params.workspaceFolder
          })
      )
      for (const result of collectionResults) {
        await syncSkill({
          installedResult: result,
          normalized: result.normalized,
          requested: true,
          scope: createProjectScope(installPathSegments)
        })
      }
      continue
    }

    const normalized = normalizeProjectSkillInstall(target)
    if (normalized == null) continue
    await syncSkill({
      normalized,
      requested: true,
      scope: createProjectScope(baseInstallPathSegments)
    })
  }

  const pluginScopes = new Map<string, ScopeState>()
  for (const asset of pluginSkills) {
    const pluginInstance = toPluginInstanceKey(asset)
    const scope = pluginScopes.get(pluginInstance) ?? {
      installPathSegments: ['.plugins', pluginInstance],
      kind: 'plugin',
      pluginInstance,
      pluginInstancePath: asset.instancePath,
      pluginRootSeen: new Set<string>(),
      seen: new Map()
    } satisfies ScopeState
    pluginScopes.set(pluginInstance, scope)
    await syncPluginSkillRoot(scope, asset)
  }

  for (const [key, entry] of Object.entries(lockfile.pluginSkills ?? {})) {
    if (pluginSkillKeys.has(key)) continue
    if (!entry.installPath.startsWith('.oo/skills/.plugins/')) continue
    const installDir = path.resolve(params.workspaceFolder, entry.installPath)
    await assertSkillDirectoryUnchanged({
      expectedHash: entry.hash,
      installDir
    })
    await rm(installDir, { recursive: true, force: true })
    delete nextLockfile.pluginSkills?.[key]
  }

  await Promise.all([
    pruneEmptyDirectoryTree(resolveProjectOoPath(params.workspaceFolder, process.env, 'skills', '.extends')),
    pruneEmptyDirectoryTree(resolveProjectOoPath(params.workspaceFolder, process.env, 'skills', '.plugins'))
  ])

  await writeProjectSkillsLockfile(params.workspaceFolder, nextLockfile)
  return {
    installed,
    lockfile: nextLockfile
  }
}
