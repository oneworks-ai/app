/* eslint-disable max-lines -- install target resolution stays colocated with command orchestration for now. */
import { basename, extname } from 'node:path'
import process from 'node:process'

import type { ConfigSourceState } from '@oneworks/config'
import type { ConfiguredSkillInstallConfig } from '@oneworks/types'
import {
  installProjectSkill,
  normalizeProjectSkillInstall,
  resolveConfiguredSkillInstalls,
  resolveProjectOoPath,
  toSkillSlug
} from '@oneworks/utils'

import { loadSkillsConfigState, pathExists } from './shared'
import type { SkillsInstallOptions } from './types'

export type DeclaredSkillInstallTarget = string | ConfiguredSkillInstallConfig

export interface ResolvedSkillInstallTarget {
  declaration: DeclaredSkillInstallTarget
  installPathSegments?: string[]
}

export const buildDeclaredSkillEntry = (
  skillArg: string,
  options: Pick<SkillsInstallOptions, 'registry' | 'rename' | 'source' | 'version'>
): DeclaredSkillInstallTarget => {
  const skill = typeof skillArg === 'string' && skillArg.trim() !== '' ? skillArg.trim() : undefined
  if (skill == null) {
    throw new Error('Skill reference is required.')
  }

  const explicitRegistry = typeof options.registry === 'string' && options.registry.trim() !== ''
    ? options.registry.trim()
    : undefined
  const explicitSource = typeof options.source === 'string' && options.source.trim() !== ''
    ? options.source.trim()
    : undefined
  const explicitVersion = typeof options.version === 'string' && options.version.trim() !== ''
    ? options.version.trim()
    : undefined
  const rename = typeof options.rename === 'string' && options.rename.trim() !== ''
    ? options.rename.trim()
    : undefined
  const parsed = normalizeProjectSkillInstall(skill)
  if (parsed == null) {
    throw new Error(`Invalid skill reference "${skillArg}".`)
  }

  if (explicitSource != null && parsed.source != null) {
    throw new Error('--source cannot be used when the skill reference already includes a source.')
  }
  if (explicitRegistry != null && parsed.registry != null) {
    throw new Error('--registry cannot be used when the skill reference already includes a registry.')
  }
  if (explicitVersion != null && parsed.version != null) {
    throw new Error('--version cannot be used when the skill reference already includes a version.')
  }

  if (explicitRegistry == null && explicitSource == null && explicitVersion == null && rename == null) {
    return skill
  }

  return {
    name: parsed.name,
    ...(explicitRegistry != null
      ? { registry: explicitRegistry }
      : (parsed.registry != null ? { registry: parsed.registry } : {})),
    ...(explicitSource != null
      ? { source: explicitSource }
      : (parsed.source != null ? { source: parsed.source } : {})),
    ...(explicitVersion != null
      ? { version: explicitVersion }
      : (parsed.version != null ? { version: parsed.version } : {})),
    ...(rename != null ? { rename } : {})
  }
}

const basenameWithoutExtension = (filePath: string) => basename(filePath, extname(filePath))

const isPathLikeExtend = (value: string) => (
  value.startsWith('.') ||
  value.startsWith('/') ||
  /^[a-z]:[\\/]/i.test(value)
)

const resolveExtendSegmentBaseName = (source: ConfigSourceState, index: number) => {
  const requestedExtendPath = source.extendPath?.trim()
  if (requestedExtendPath != null && requestedExtendPath !== '' && !isPathLikeExtend(requestedExtendPath)) {
    return requestedExtendPath
  }

  return source.configPath == null ? `extend-${index + 1}` : basenameWithoutExtension(source.configPath)
}

const stableExtendSegment = (source: ConfigSourceState, index: number, counts: Map<string, number>) => {
  const baseName = resolveExtendSegmentBaseName(source, index)
  const slug = toSkillSlug(baseName) || `extend-${index + 1}`
  if ((counts.get(slug) ?? 0) <= 1) return slug
  return `${slug}-${index + 1}`
}

const resolveExtendSegments = (sources: ConfigSourceState[]) => {
  const counts = new Map<string, number>()
  for (let index = 0; index < sources.length; index++) {
    const baseName = resolveExtendSegmentBaseName(sources[index]!, index)
    const slug = toSkillSlug(baseName) || `extend-${index + 1}`
    counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }

  return sources.map((source, index) => stableExtendSegment(source, index, counts))
}

const resolveConfigSourceInstallTargets = (
  source: ConfigSourceState | undefined
): ResolvedSkillInstallTarget[] => {
  if (source == null) return []

  const extendSources = source.resolvedExtendSources ?? []
  const extendSegments = resolveExtendSegments(extendSources)
  const targets: ResolvedSkillInstallTarget[] = []

  for (let index = 0; index < extendSources.length; index++) {
    targets.push(
      ...resolveConfiguredSkillInstalls(extendSources[index]?.rawConfig?.skills).map(declaration => ({
        declaration,
        installPathSegments: ['.extends', extendSegments[index]!]
      }))
    )
  }

  targets.push(
    ...resolveConfiguredSkillInstalls(source.rawConfig?.skills).map(declaration => ({
      declaration,
      installPathSegments: []
    }))
  )

  return targets
}

const resolveConfiguredSkillInstallTargets = (
  state: Awaited<ReturnType<typeof loadSkillsConfigState>>
): ResolvedSkillInstallTarget[] => {
  const targets = [
    ...(state.globalConfig == null ? [] : resolveConfigSourceInstallTargets(state.globalSource)),
    ...resolveConfigSourceInstallTargets(state.projectSource),
    ...resolveConfigSourceInstallTargets(state.userSource)
  ]
  if (targets.length > 0) return targets

  return resolveConfiguredSkillInstalls(state.mergedConfig.skills).map(declaration => ({
    declaration,
    installPathSegments: []
  }))
}

export const installDeclaredSkill = async (params: {
  force?: boolean
  registry?: string
  skill: DeclaredSkillInstallTarget
  workspaceFolder: string
}) => {
  const normalized = normalizeProjectSkillInstall(params.skill)
  if (normalized == null) {
    throw new Error('Skill reference is required.')
  }

  const existingSkillPath = resolveProjectOoPath(
    params.workspaceFolder,
    process.env,
    'skills',
    normalized.targetDirName,
    'SKILL.md'
  )
  const hadExisting = await pathExists(existingSkillPath)
  const installed = params.force === true || !hadExisting
    ? await installProjectSkill({
      force: params.force,
      registry: params.registry,
      skill: normalized,
      workspaceFolder: params.workspaceFolder
    })
    : {
      dirName: normalized.targetDirName,
      installDir: resolveProjectOoPath(params.workspaceFolder, process.env, 'skills', normalized.targetDirName),
      name: normalized.targetName,
      ref: normalized.ref,
      skillPath: existingSkillPath
    }

  return {
    ...installed,
    skipped: params.force !== true && hadExisting
  }
}

export const resolveInstallTargets = async (params: {
  args: string[]
  options: Pick<SkillsInstallOptions, 'rename' | 'source'>
  workspaceFolder: string
}) => {
  if (params.args.length > 0) {
    if (params.args.length > 1 && (params.options.rename != null || params.options.source != null)) {
      throw new Error('--source and --rename only support a single explicit skill argument.')
    }
    return params.args.map((arg) => ({
      declaration: buildDeclaredSkillEntry(arg, params.options),
      installPathSegments: []
    }))
  }

  const state = await loadSkillsConfigState(params.workspaceFolder)
  return resolveConfiguredSkillInstallTargets(state)
}
