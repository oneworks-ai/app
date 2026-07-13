/* eslint-disable max-lines -- skill routes keep list, detail, create, and import semantics together. */
import { basename, relative } from 'node:path'
import process from 'node:process'

import type Router from '@koa/router'

import { resolveWritableConfigPath } from '@oneworks/config'
import type { DefinitionLoader } from '@oneworks/definition-loader'
import type { ConfigSource, Definition, Skill } from '@oneworks/types'
import { normalizeProjectSkillInstall, resolveConfiguredSkillInstalls, resolveProjectOoPath } from '@oneworks/utils'

import {
  importSkillArchive,
  normalizeSkillArchiveImportForce,
  normalizeSkillArchiveImportTarget
} from '#~/services/ai/skill-archive-import.js'
import { createProjectSkill } from '#~/services/ai/skill-create.js'
import { loadConfigState } from '#~/services/config/index.js'
import { listNativeHostSkills } from '#~/services/plugins/native-host.js'
import { badRequest, internalServerError, isHttpError, notFound } from '#~/utils/http.js'

import { matchesDefinitionPath } from './ai-presenters.js'
import {
  presentNativeHostSkill,
  presentNativeHostSkillDetail,
  presentSkill,
  presentSkillDetail
} from './ai-skill-presenters.js'
import type { PresentedSkillSourceDetail } from './ai-skill-presenters.js'

const resolveProjectSkillDirName = (workspaceRoot: string, skillPath: string) => {
  const projectSkillsDir = resolveProjectOoPath(workspaceRoot, process.env, 'skills')
  const relativePath = relative(projectSkillsDir, skillPath)
  if (relativePath.startsWith('..') || relativePath === '') return undefined

  const segments = relativePath.split(/[\\/]/).filter(Boolean)
  return segments[0]
}

const buildConfiguredSkillSourceMap = (
  skills: ReturnType<typeof resolveConfiguredSkillInstalls>,
  detail: PresentedSkillSourceDetail
) => {
  const mapping = new Map<string, PresentedSkillSourceDetail>()

  for (const entry of skills) {
    const normalized = normalizeProjectSkillInstall(entry)
    if (normalized == null) continue
    mapping.set(normalized.targetDirName, detail)
  }

  return mapping
}

const getConfigLabel = (workspaceRoot: string, source: ConfigSource, configPath?: string) => (
  source === 'global'
    ? '~/.oneworks/.oo.config.json'
    : basename(configPath ?? resolveWritableConfigPath(workspaceRoot, source))
)

const resolvePresentedSkillSourceDetail = (params: {
  globalConfiguredSkills: Map<string, PresentedSkillSourceDetail>
  projectConfiguredSkills: Map<string, PresentedSkillSourceDetail>
  skill: Definition<Skill>
  userConfiguredSkills: Map<string, PresentedSkillSourceDetail>
  workspaceRoot: string
}): PresentedSkillSourceDetail => {
  const source = params.skill.resolvedSource ?? 'project'
  if (source === 'plugin') return { kind: 'plugin' }
  if (source === 'home') return { kind: 'home' }

  const dirName = resolveProjectSkillDirName(params.workspaceRoot, params.skill.path)
  if (dirName != null) {
    const userConfigured = params.userConfiguredSkills.get(dirName)
    if (userConfigured != null) return userConfigured
    const projectConfigured = params.projectConfiguredSkills.get(dirName)
    if (projectConfigured != null) return projectConfigured
    const globalConfigured = params.globalConfiguredSkills.get(dirName)
    if (globalConfigured != null) return globalConfigured
  }

  return { kind: 'projectDefault' }
}

const loadSkillSourceMaps = async (workspaceRoot: string) => {
  const configState = await loadConfigState(workspaceRoot)
  const globalConfigLabel = getConfigLabel(workspaceRoot, 'global', configState.globalSource?.configPath)
  const projectConfigLabel = getConfigLabel(workspaceRoot, 'project', configState.projectSource?.configPath)
  const userConfigLabel = getConfigLabel(workspaceRoot, 'user', configState.userSource?.configPath)

  return {
    globalConfiguredSkills: buildConfiguredSkillSourceMap(
      resolveConfiguredSkillInstalls(configState.globalConfig?.skills),
      {
        kind: 'globalConfig',
        configSource: 'global',
        configLabel: globalConfigLabel
      }
    ),
    projectConfiguredSkills: buildConfiguredSkillSourceMap(
      resolveConfiguredSkillInstalls(configState.projectSource?.rawConfig?.skills),
      {
        kind: 'projectConfig',
        configSource: 'project',
        configLabel: projectConfigLabel
      }
    ),
    userConfiguredSkills: buildConfiguredSkillSourceMap(
      resolveConfiguredSkillInstalls(configState.userSource?.rawConfig?.skills),
      {
        kind: 'userConfig',
        configSource: 'user',
        configLabel: userConfigLabel
      }
    )
  }
}

export const registerAiSkillRoutes = (router: Router, params: {
  loader: DefinitionLoader
  workspaceRoot: string
}) => {
  router.get('/skills', async (ctx) => {
    try {
      const [skills, nativeSkills] = await Promise.all([
        params.loader.loadDefaultSkills(),
        listNativeHostSkills()
      ])
      const sourceMaps = await loadSkillSourceMaps(params.workspaceRoot)
      const presentedSkills = skills.map((skill: Definition<Skill>) =>
        presentSkill(
          skill,
          params.workspaceRoot,
          resolvePresentedSkillSourceDetail({
            ...sourceMaps,
            skill,
            workspaceRoot: params.workspaceRoot
          })
        )
      )
      const seen = new Set(presentedSkills.map(skill => (
        `${skill.source === 'home' ? 'global' : 'project'}\0${skill.name}`
      )))
      const presentedNativeSkills = nativeSkills.skills
        .map(presentNativeHostSkill)
        .filter((skill) => {
          const key = `${skill.source === 'home' ? 'global' : 'project'}\0${skill.name}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

      ctx.body = {
        skills: [
          ...presentedSkills,
          ...presentedNativeSkills
        ]
      }
    } catch (err) {
      throw internalServerError('Failed to load skills', { cause: err, code: 'ai_skills_load_failed' })
    }
  })

  router.post('/skills', async (ctx) => {
    try {
      const skill = await createProjectSkill(
        params.workspaceRoot,
        (ctx.request.body ?? {}) as Record<string, unknown>
      )
      ctx.status = 201
      ctx.body = {
        skill: presentSkillDetail(skill, params.workspaceRoot)
      }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to create skill', { cause: err, code: 'ai_skill_create_failed' })
    }
  })

  router.post('/skills/import', async (ctx) => {
    const archiveName = ctx.get('x-file-name')
    const targetHeader = ctx.get('x-skill-target')
    const forceHeader = ctx.get('x-skill-force')
    const target = normalizeSkillArchiveImportTarget(targetHeader)
    const force = normalizeSkillArchiveImportForce(forceHeader)
    if (target == null) {
      throw badRequest('Invalid skill import target', { target: targetHeader }, 'invalid_skill_import_target')
    }
    if (force == null) {
      throw badRequest('Invalid skill import force flag', { force: forceHeader }, 'invalid_skill_import_force')
    }
    ctx.body = await importSkillArchive(params.workspaceRoot, ctx.req, archiveName, target, { force })
  })

  router.get('/skills/detail', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (!targetPath) {
      throw badRequest('Missing path', undefined, 'missing_path')
    }

    try {
      const [skills, nativeSkills] = await Promise.all([
        params.loader.loadDefaultSkills(),
        listNativeHostSkills()
      ])
      const sourceMaps = await loadSkillSourceMaps(params.workspaceRoot)
      const skill = skills.find((item: Definition<Skill>) => (
        matchesDefinitionPath(item, targetPath, params.workspaceRoot)
      ))

      const nativeSkill = targetPath.startsWith('native:')
        ? nativeSkills.skills.find(item => `native:${item.id}` === targetPath)
        : undefined
      if (!skill && nativeSkill == null) {
        throw notFound('Skill not found', { path: targetPath }, 'skill_not_found')
      }

      ctx.body = {
        skill: nativeSkill == null
          ? presentSkillDetail(
            skill as Definition<Skill>,
            params.workspaceRoot,
            resolvePresentedSkillSourceDetail({
              ...sourceMaps,
              skill: skill as Definition<Skill>,
              workspaceRoot: params.workspaceRoot
            })
          )
          : presentNativeHostSkillDetail(nativeSkill)
      }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to load skill detail', { cause: err, code: 'ai_skill_detail_load_failed' })
    }
  })
}
