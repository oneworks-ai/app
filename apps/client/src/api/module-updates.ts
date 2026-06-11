import type { ModuleUpdateInstallResponse, ModuleUpdateSettingsPatch, ModuleUpdatesResponse } from '@oneworks/types'

import appI18n from '#~/i18n'

import { fetchApiJson, fetchApiJsonOrThrow, jsonHeaders } from './base'

const getModuleUpdateLanguageHeaders = (): Record<string, string> => {
  const language = appI18n.resolvedLanguage ?? appI18n.language
  return language == null || language.trim() === ''
    ? {}
    : { 'Accept-Language': language }
}

const getModuleUpdateJsonHeaders = (): Record<string, string> => ({
  ...jsonHeaders,
  ...getModuleUpdateLanguageHeaders()
})

export const checkModuleUpdates = () => (
  fetchApiJson<ModuleUpdatesResponse>('/api/module-updates/check', {
    method: 'POST',
    headers: getModuleUpdateJsonHeaders(),
    body: JSON.stringify({}),
    timeoutMs: 60_000
  })
)

export const getModuleUpdates = () => (
  fetchApiJson<ModuleUpdatesResponse>('/api/module-updates', {
    headers: getModuleUpdateLanguageHeaders(),
    timeoutMs: 60_000
  })
)

export const installModuleUpdate = (id: string, version?: string) => (
  fetchApiJsonOrThrow<ModuleUpdateInstallResponse>(
    `/api/module-updates/${encodeURIComponent(id)}/install`,
    {
      method: 'POST',
      headers: getModuleUpdateJsonHeaders(),
      body: JSON.stringify(version == null ? {} : { version }),
      timeoutMs: 180_000
    },
    '[api] install module update failed:'
  )
)

export const updateModuleUpdateSettings = (patch: ModuleUpdateSettingsPatch) => (
  fetchApiJsonOrThrow<ModuleUpdatesResponse>(
    '/api/module-updates/settings',
    {
      method: 'PATCH',
      headers: getModuleUpdateJsonHeaders(),
      body: JSON.stringify(patch),
      timeoutMs: 90_000
    },
    '[api] update module update settings failed:'
  )
)
