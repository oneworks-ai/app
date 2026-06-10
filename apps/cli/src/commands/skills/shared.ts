import { access } from 'node:fs/promises'
import process from 'node:process'

import type { ConfigSource } from '@oneworks/config'
import { buildConfigJsonVariables, loadConfigState } from '@oneworks/config'
import type { Config, ConfiguredSkillInstallConfig } from '@oneworks/types'
import {
  buildSkillsConfigValue,
  isSameDeclaredSkill,
  matchesDeclaredSkillSelector,
  readProjectSkills,
  toSkillSlug
} from '@oneworks/utils'

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export const printResult = (value: unknown, json = false) => {
  if (json) {
    console.log(JSON.stringify(
      value != null && typeof value === 'object' && !Array.isArray(value)
        ? { ok: true, ...(value as Record<string, unknown>) }
        : { ok: true, value },
      null,
      2
    ))
    return
  }

  if (typeof value === 'string') {
    console.log(value)
    return
  }

  console.log(JSON.stringify(value, null, 2))
}

export const exitWithError = (error: unknown, json = false): never => {
  const message = error instanceof Error ? error.message : String(error)
  if (json) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  } else {
    console.error(message)
  }
  process.exit(1)
}

export const loadSkillsConfigState = async (cwd: string) => (
  await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
)

export const getResolvedSourceConfig = (
  state: Awaited<ReturnType<typeof loadSkillsConfigState>>,
  source: ConfigSource
) => {
  switch (source) {
    case 'global':
      return state.globalConfig
    case 'project':
      return state.projectSource?.resolvedConfig
    case 'user':
      return state.userConfig
  }
}

export const getRawSourceConfig = (state: Awaited<ReturnType<typeof loadSkillsConfigState>>, source: ConfigSource) => {
  switch (source) {
    case 'global':
      return state.globalSource?.rawConfig
    case 'project':
      return state.projectSource?.rawConfig
    case 'user':
      return state.userSource?.rawConfig
  }
}

export const buildGeneralSkillsUpdateValue = (
  sourceConfig: Config | undefined,
  nextSkills: Array<string | ConfiguredSkillInstallConfig>
) => {
  const value: Record<string, unknown> = {
    skills: buildSkillsConfigValue({
      items: nextSkills,
      current: sourceConfig?.skills
    })
  }
  return value
}

export const resolveInstalledSkillDirNames = async (workspaceFolder: string, selector: string) => {
  const trimmedSelector = selector.trim()
  const selectorSlug = toSkillSlug(trimmedSelector)
  const skills = await readProjectSkills(workspaceFolder)
  return skills
    .filter(skill => (
      skill.dirName === trimmedSelector ||
      skill.name === trimmedSelector ||
      skill.dirName === selectorSlug ||
      toSkillSlug(skill.name) === selectorSlug
    ))
    .map(skill => skill.dirName)
}

export { isSameDeclaredSkill, matchesDeclaredSkillSelector as matchesSkillSelector, normalizeString, pathExists }
