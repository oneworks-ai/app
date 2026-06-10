import { App } from 'antd'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR, { useSWRConfig } from 'swr'

import type { ConfigResponse, ConfigSection } from '@oneworks/types'

import { getConfig, updateConfig } from '#~/api'
import { changeAppLanguage, clearAppLanguageOverride, getDefaultAppLanguage, normalizeAppLanguage } from '#~/i18n'

type GeneralConfig = NonNullable<ConfigSection['general']>
type DesktopInterfaceLanguageConfig = NonNullable<
  Awaited<ReturnType<NonNullable<NonNullable<Window['oneworksDesktop']>['getGlobalInterfaceLanguageConfig']>>>
>

const cloneGeneralConfig = (value: GeneralConfig | undefined): GeneralConfig => ({
  ...(value ?? {})
})

const isDesktopInterfaceLanguageConfig = (value: unknown): value is DesktopInterfaceLanguageConfig => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export function useInterfaceLanguageConfig() {
  const { message } = App.useApp()
  const { i18n, t } = useTranslation()
  const desktopApi = window.oneworksDesktop
  const canUseDesktopConfig = desktopApi?.getGlobalInterfaceLanguageConfig != null &&
    desktopApi.updateGlobalInterfaceLanguageConfig != null &&
    desktopApi.resetGlobalInterfaceLanguageConfig != null
  const canUseApiConfig = !canUseDesktopConfig && desktopApi == null
  const { data } = useSWR<ConfigResponse>(canUseApiConfig ? '/api/config' : null, getConfig)
  const { data: desktopData, mutate: mutateDesktopData } = useSWR<DesktopInterfaceLanguageConfig>(
    canUseDesktopConfig ? 'desktop:global-interface-language-config' : null,
    async () => await desktopApi?.getGlobalInterfaceLanguageConfig?.() ?? {}
  )
  const { mutate } = useSWRConfig()
  const rawGlobalGeneral = canUseApiConfig ? data?.sources?.global?.general : undefined
  const configuredGlobalLanguage = normalizeAppLanguage(rawGlobalGeneral?.interfaceLanguage) ??
    normalizeAppLanguage(desktopData?.configuredLanguage)
  const effectiveLanguage = normalizeAppLanguage(
    canUseDesktopConfig
      ? desktopData?.effectiveLanguage
      : data?.sources?.merged?.general?.interfaceLanguage
  )

  const updateGlobalInterfaceLanguage = useCallback(async (language: string) => {
    const nextLanguage = normalizeAppLanguage(language)
    if (nextLanguage == null) return

    const previousLanguage = i18n.resolvedLanguage ?? i18n.language
    clearAppLanguageOverride()
    await changeAppLanguage(nextLanguage)

    try {
      if (canUseDesktopConfig) {
        const nextConfig = await desktopApi.updateGlobalInterfaceLanguageConfig?.(nextLanguage)
        await mutateDesktopData(nextConfig ?? {}, { revalidate: false })
        void mutate('/api/config')
        return
      }

      if (!canUseApiConfig) {
        await changeAppLanguage(previousLanguage)
        void message.error(t('config.saveFailed'))
        return
      }

      await updateConfig(
        'global',
        'general',
        {
          ...cloneGeneralConfig(rawGlobalGeneral),
          interfaceLanguage: nextLanguage
        }
      )
      await mutate('/api/config')
    } catch (error) {
      console.error('[config] failed to update global interface language', error)
      await changeAppLanguage(previousLanguage)
      void message.error(t('config.saveFailed'))
    }
  }, [canUseApiConfig, canUseDesktopConfig, desktopApi, i18n, message, mutate, mutateDesktopData, rawGlobalGeneral, t])

  const resetGlobalInterfaceLanguage = useCallback(async () => {
    const previousLanguage = i18n.resolvedLanguage ?? i18n.language
    const nextGlobalGeneral = cloneGeneralConfig(rawGlobalGeneral)
    delete nextGlobalGeneral.interfaceLanguage
    clearAppLanguageOverride()

    try {
      const nextLanguage = await (async () => {
        if (canUseDesktopConfig) {
          const nextConfig = await desktopApi.resetGlobalInterfaceLanguageConfig?.()
          await mutateDesktopData(nextConfig ?? {}, { revalidate: false })
          void mutate('/api/config')
          return normalizeAppLanguage(nextConfig?.effectiveLanguage) ?? getDefaultAppLanguage()
        }

        if (!canUseApiConfig) {
          throw new Error('Config API is not available.')
        }

        await updateConfig('global', 'general', nextGlobalGeneral, {
          unsetPaths: [['interfaceLanguage']]
        })
        const nextData = await mutate('/api/config')
        return normalizeAppLanguage(nextData?.sources?.merged?.general?.interfaceLanguage) ?? getDefaultAppLanguage()
      })()
      await changeAppLanguage(nextLanguage)
    } catch (error) {
      console.error('[config] failed to reset global interface language', error)
      await changeAppLanguage(previousLanguage)
      void message.error(t('config.saveFailed'))
    }
  }, [canUseApiConfig, canUseDesktopConfig, desktopApi, i18n, message, mutate, mutateDesktopData, rawGlobalGeneral, t])

  useEffect(() => {
    if (effectiveLanguage == null || i18n.language === effectiveLanguage) return
    void changeAppLanguage(effectiveLanguage)
  }, [effectiveLanguage, i18n.language])

  useEffect(() => {
    if (!canUseDesktopConfig || desktopApi?.onGlobalInterfaceLanguageConfigChange == null) return

    return desktopApi.onGlobalInterfaceLanguageConfigChange((value) => {
      if (!isDesktopInterfaceLanguageConfig(value)) return

      void mutateDesktopData(value, { revalidate: false })
      void mutate('/api/config')
      const nextLanguage = normalizeAppLanguage(value.effectiveLanguage) ?? getDefaultAppLanguage()
      void changeAppLanguage(nextLanguage)
    })
  }, [canUseDesktopConfig, desktopApi, mutate, mutateDesktopData])

  return {
    configuredGlobalLanguage,
    hasGlobalInterfaceLanguage: configuredGlobalLanguage != null,
    resetGlobalInterfaceLanguage,
    updateGlobalInterfaceLanguage
  }
}
