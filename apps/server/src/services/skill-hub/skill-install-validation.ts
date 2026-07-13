import type { ConfigSource, ResolvedConfigState } from '@oneworks/config'
import type { Config, ConfiguredSkillInstallConfig } from '@oneworks/types'
import { normalizeProjectSkillInstall } from '@oneworks/utils'

import { getRawSourceConfig, getResolvedSourceConfig, toConfigLabel } from './config-source'
import { buildInstalledSkillConfigValue } from './skills-cli-shared'

export const resolveSkillInstallConfigValue = (params: {
  currentSkills: Config['skills']
  declaredSkill: ConfiguredSkillInstallConfig
  target: ConfigSource
  workspaceFolder: string
}) => {
  const update = buildInstalledSkillConfigValue({
    currentSkills: params.currentSkills,
    declaredSkill: params.declaredSkill
  })
  if (update.duplicate != null) {
    throw new Error(
      `Configured skill target "${update.duplicate}" already exists in ${
        toConfigLabel(params.workspaceFolder, params.target)
      }.`
    )
  }
  return update.value
}

export const resolveSkillInstallConfigUpdate = (params: {
  declaredSkill: ConfiguredSkillInstallConfig
  force?: boolean
  state: ResolvedConfigState
  target: ConfigSource
  workspaceFolder: string
}) => {
  const targetName = normalizeProjectSkillInstall(params.declaredSkill)?.targetName ?? 'skill'
  const checks = (['global', 'project', 'user'] as const).map(configSource => ({
    configSource,
    result: buildInstalledSkillConfigValue({
      currentSkills: getResolvedSourceConfig(params.state, configSource)?.skills,
      declaredSkill: params.declaredSkill
    })
  }))
  const conflict = checks.find(check => check.result.duplicate != null)
  if (conflict != null) {
    throw new Error(
      `Configured skill target "${conflict.result.duplicate}" already exists in ${
        toConfigLabel(params.workspaceFolder, conflict.configSource)
      }.`
    )
  }

  const targetCheck = checks.find(check => check.configSource === params.target)!.result
  if (targetCheck.alreadyConfigured && params.force !== true) {
    throw new Error(
      `Configured skill target "${targetName}" already exists in ${
        toConfigLabel(params.workspaceFolder, params.target)
      }.`
    )
  }

  const value = resolveSkillInstallConfigValue({
    currentSkills: getRawSourceConfig(params.state, params.target)?.skills,
    declaredSkill: params.declaredSkill,
    target: params.target,
    workspaceFolder: params.workspaceFolder
  })

  return {
    alreadyConfigured: targetCheck.alreadyConfigured,
    value
  }
}
