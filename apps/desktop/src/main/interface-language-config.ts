import process from 'node:process'

import { buildConfigJsonVariables, buildConfigSections, loadConfigState, updateConfigFile } from '@oneworks/config'
import type { Config } from '@oneworks/types'
import { app } from 'electron'

import type { DesktopInterfaceLanguageConfig } from './types'

type GeneralConfig = ReturnType<typeof buildConfigSections>['general']

const ensureRealHomeEnv = () => {
  if (process.env.__ONEWORKS_PROJECT_REAL_HOME__ != null && process.env.__ONEWORKS_PROJECT_REAL_HOME__.trim() !== '') {
    return
  }

  process.env.__ONEWORKS_PROJECT_REAL_HOME__ = app.getPath('home')
}

const normalizeLanguageValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const language = value.trim()
  return language === '' ? undefined : language
}

const pickDefinedGeneralConfig = (config: Config | undefined): Partial<GeneralConfig> => {
  const general = buildConfigSections(config).general
  return Object.fromEntries(
    Object.entries(general).filter(([, value]) => value !== undefined)
  ) as Partial<GeneralConfig>
}

const loadGlobalConfigState = async () => {
  ensureRealHomeEnv()
  const cwd = process.cwd()
  return await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
}

const writeGlobalGeneralConfig = async (generalConfig: Partial<GeneralConfig>) => {
  ensureRealHomeEnv()
  await updateConfigFile({
    workspaceFolder: process.cwd(),
    source: 'global',
    section: 'general',
    value: generalConfig
  })
}

export const readGlobalInterfaceLanguageConfig = async (): Promise<DesktopInterfaceLanguageConfig> => {
  const state = await loadGlobalConfigState()
  return {
    configuredLanguage: normalizeLanguageValue(state.globalSource?.rawConfig?.interfaceLanguage),
    effectiveLanguage: normalizeLanguageValue(state.mergedConfig.interfaceLanguage)
  }
}

export const updateGlobalInterfaceLanguageConfig = async (
  language: unknown
): Promise<DesktopInterfaceLanguageConfig> => {
  const nextLanguage = normalizeLanguageValue(language)
  if (nextLanguage == null) {
    throw new TypeError('Interface language is required.')
  }

  const state = await loadGlobalConfigState()
  await writeGlobalGeneralConfig({
    ...pickDefinedGeneralConfig(state.globalSource?.rawConfig),
    interfaceLanguage: nextLanguage
  })
  return await readGlobalInterfaceLanguageConfig()
}

export const resetGlobalInterfaceLanguageConfig = async (): Promise<DesktopInterfaceLanguageConfig> => {
  const state = await loadGlobalConfigState()
  const nextGeneral = pickDefinedGeneralConfig(state.globalSource?.rawConfig)
  delete nextGeneral.interfaceLanguage
  await writeGlobalGeneralConfig({
    ...nextGeneral,
    interfaceLanguage: undefined
  })
  return await readGlobalInterfaceLanguageConfig()
}
