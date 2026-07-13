import React from 'react'

import type { MessageInstance } from 'antd/es/message/interface'
import type { TFunction } from 'i18next'

import type { SkillHubInstallTarget, SkillHubItem } from '#~/api.js'
import { getApiErrorMessage, importSkillArchive, installSkillHubItem } from '#~/api.js'

export const useSkillsTabActions = (params: {
  marketMutate: () => Promise<unknown>
  message: MessageInstance
  mutateConfig: () => Promise<unknown>
  mutateSkills: () => Promise<unknown>
  onRefresh: () => void | Promise<void>
  t: TFunction
}) => {
  const importInputRef = React.useRef<HTMLInputElement | null>(null)
  const importTargetRef = React.useRef<SkillHubInstallTarget>('project')
  const installingRef = React.useRef(false)
  const [installingId, setInstallingId] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)

  const handleInstall = React.useCallback(async (item: SkillHubItem, target: SkillHubInstallTarget) => {
    if (installingRef.current) return
    installingRef.current = true
    setInstallingId(`${item.id}:${target}`)
    try {
      await installSkillHubItem({
        registry: item.registry,
        skill: item.installRef ?? item.name,
        target,
        force: item.declaredSources.includes(target) || (item.installed && item.declaredSources.length === 0)
      })
      await Promise.all([params.marketMutate(), params.mutateSkills(), params.mutateConfig()])
      void params.message.success(params.t(
        target === 'global'
          ? 'knowledge.skills.installGlobalSuccess'
          : 'knowledge.skills.installProjectSuccess'
      ))
    } catch (error) {
      void params.message.error(getApiErrorMessage(error, params.t('knowledge.skills.installFailed')))
    } finally {
      installingRef.current = false
      setInstallingId(null)
    }
  }, [params])

  const handleImportArchive = React.useCallback(async (file: File) => {
    setImporting(true)
    try {
      const result = await importSkillArchive(file, importTargetRef.current)
      await Promise.all([params.mutateSkills(), params.onRefresh()])
      void params.message.success(params.t('knowledge.skills.importSuccess', { count: result.fileCount }))
    } catch (error) {
      void params.message.error(getApiErrorMessage(error, params.t('knowledge.skills.importFailed')))
    } finally {
      setImporting(false)
    }
  }, [params])

  const triggerImport = React.useCallback((target: SkillHubInstallTarget) => {
    importTargetRef.current = target
    importInputRef.current?.click()
  }, [])

  return {
    importInputRef,
    importing,
    installingId,
    handleImportArchive,
    handleInstall,
    triggerImport
  }
}
