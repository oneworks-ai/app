import { App, Tooltip } from 'antd'
import { useEffect, useState } from 'react'

import { usePluginThemes } from '#~/plugins/plugin-themes'
import { applyAppearanceConfigPatch } from '#~/utils/appearance-config'
import type { ConfigOneWorksIconMode } from '#~/utils/oneworks-icon'

import { ProjectThemeColorSettingsControls } from './ProjectThemeColorSettingsControls'
import { normalizeDesktopIconSettings } from './app-icon-settings-model'
import type {
  DesktopIconAppearance,
  DesktopIconBackground,
  DesktopIconSync,
  DesktopIconTheme,
  NormalizedDesktopIconSettings
} from './app-icon-settings-model'
import type { TranslationFn } from './configUtils'
import {
  getEffectiveProjectPrimaryColor,
  getPresetByPrimaryColor,
  getPresetByTheme,
  getProjectIconBackground,
  getProjectThemePackPrimaryColor,
  getSyncAppIconCopy
} from './project-theme-color-settings-model'
import { useProjectThemePreviewSources } from './use-project-theme-preview-sources'

export function ProjectThemeColorSettings({
  appearance,
  iconAppearance,
  iconMode,
  onAppearanceChange,
  rawAppearance = appearance,
  t
}: {
  appearance: Record<string, unknown>
  iconAppearance: DesktopIconAppearance
  iconMode: ConfigOneWorksIconMode
  onAppearanceChange: (value: Record<string, unknown>) => void
  rawAppearance?: Record<string, unknown>
  t: TranslationFn
}) {
  const { message } = App.useApp()
  const themes = usePluginThemes()
  const desktopApi = window.oneworksDesktop
  const [desktopSettings, setDesktopSettings] = useState<NormalizedDesktopIconSettings>(() =>
    normalizeDesktopIconSettings(undefined)
  )
  const [savingDesktopSettings, setSavingDesktopSettings] = useState(false)
  const canUpdateDesktopIcon = desktopApi?.getDesktopSettings != null &&
    desktopApi.updateDesktopSettings != null
  const isThemePackManaged = getProjectThemePackPrimaryColor(appearance, themes) != null
  const projectPrimaryColor = getEffectiveProjectPrimaryColor(appearance, themes)
  const selectedTheme = getPresetByPrimaryColor(projectPrimaryColor).theme
  const iconBackground = canUpdateDesktopIcon
    ? desktopSettings.iconBackground
    : getProjectIconBackground(appearance) ?? desktopSettings.iconBackground
  const label = t('config.appSettings.projectThemeColor.label')
  const description = isThemePackManaged
    ? t('config.appSettings.projectThemeColor.themeManagedDesc')
    : t('config.appSettings.projectThemeColor.desc')
  const previewSources = useProjectThemePreviewSources({
    desktopApi,
    iconAppearance,
    iconBackground,
    iconMode,
    t
  })
  const syncAppIconCopy = getSyncAppIconCopy(desktopApi?.platform, t)

  useEffect(() => {
    if (!canUpdateDesktopIcon) return

    let disposed = false
    void desktopApi?.getDesktopSettings?.()
      .then((value) => {
        if (!disposed) {
          setDesktopSettings(normalizeDesktopIconSettings(value))
        }
      })
      .catch(() => undefined)

    const dispose = desktopApi?.onDesktopSettingsChange?.((value) => {
      setDesktopSettings(normalizeDesktopIconSettings(value))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [canUpdateDesktopIcon, desktopApi])

  const updateAppearance = (patch: Record<string, unknown>) => {
    onAppearanceChange(applyAppearanceConfigPatch(rawAppearance, patch))
  }

  const updateDesktopIconSettings = (
    patch: Partial<
      Pick<
        DesktopSettings,
        'iconAppearance' | 'iconBackground' | 'iconTheme' | 'syncAppIcon'
      >
    >
  ) => {
    if (desktopApi?.updateDesktopSettings == null) return

    const previousSettings = desktopSettings
    setDesktopSettings(prev => normalizeDesktopIconSettings({ ...prev, ...patch }))
    setSavingDesktopSettings(true)

    void desktopApi.updateDesktopSettings(patch)
      .then(value => setDesktopSettings(normalizeDesktopIconSettings(value)))
      .catch((error) => {
        console.error('[desktop-settings] failed to update project theme icon settings', error)
        setDesktopSettings(previousSettings)
        void message.error(t('config.appSettings.projectThemeColor.saveFailed'))
      })
      .finally(() => setSavingDesktopSettings(false))
  }

  const updateTheme = (theme: DesktopIconTheme) => {
    if (isThemePackManaged) return

    const preset = getPresetByTheme(theme)
    updateAppearance({
      primaryColor: preset.primaryColor
    })
    updateDesktopIconSettings({
      iconAppearance,
      iconBackground,
      iconTheme: theme
    })
  }

  const updateIconBackground = (nextIconBackground: DesktopIconBackground) => {
    if (!canUpdateDesktopIcon) {
      updateAppearance({
        iconBackground: nextIconBackground
      })
    }
    updateDesktopIconSettings({
      iconAppearance,
      iconBackground: nextIconBackground
    })
  }

  const updateSyncAppIcon = (syncAppIcon: DesktopIconSync) => {
    updateDesktopIconSettings({
      syncAppIcon
    })
  }

  return (
    <div
      className='config-view__field-row config-view__project-theme-field-row'
      aria-label={label}
    >
      <div className='config-view__field-meta config-view__project-theme-field-meta'>
        <Tooltip title={`${label}: ${description}`}>
          <div
            className='config-view__project-theme-preview'
            role='img'
            aria-label={t('config.appSettings.projectThemeColor.previewAlt')}
          >
            {previewSources[selectedTheme] != null && (
              <img
                className='config-view__project-theme-preview-image'
                src={previewSources[selectedTheme]}
                alt=''
              />
            )}
          </div>
        </Tooltip>
      </div>
      <div className='config-view__field-control config-view__project-theme-field-control'>
        <ProjectThemeColorSettingsControls
          canUpdateDesktopIcon={canUpdateDesktopIcon}
          disabled={isThemePackManaged}
          iconPreferencesDisabled={false}
          iconBackground={iconBackground}
          previewSources={previewSources}
          saving={savingDesktopSettings}
          selectedTheme={selectedTheme}
          syncAppIcon={desktopSettings.syncAppIcon}
          syncAppIconDescription={syncAppIconCopy.description}
          syncAppIconLabel={syncAppIconCopy.label}
          t={t}
          themeAriaLabel={label}
          onIconBackgroundChange={updateIconBackground}
          onSyncAppIconChange={updateSyncAppIcon}
          onThemeChange={updateTheme}
        />
      </div>
    </div>
  )
}
