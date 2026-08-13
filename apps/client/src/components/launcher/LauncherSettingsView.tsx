/* eslint-disable max-lines -- launcher settings prototype keeps local controls and searchable rows together. */
import './LauncherSettingsView.scss'
import '../ConfigView.scss'
import '../config/ConfigEditors.scss'

import { App, Empty, Switch, Tooltip } from 'antd'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { ConfigResponse, ConfigSection, LauncherWorkspaceSelectorProject } from '@oneworks/types'
import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

import { getConfig, updateConfig } from '#~/api'
import { ShortcutInput } from '#~/components/config/ConfigShortcutInput'
import { ProjectThemeColorSettingsControls } from '#~/components/config/ProjectThemeColorSettingsControls'
import { ThemeModeRadioGroup } from '#~/components/config/ThemeModeRadioGroup'
import { iconThemes, normalizeDesktopIconSettings } from '#~/components/config/app-icon-settings-model'
import type {
  DesktopIconBackground,
  DesktopIconSync,
  DesktopIconTheme,
  NormalizedDesktopIconSettings
} from '#~/components/config/app-icon-settings-model'
import {
  emptyDesktopSettings,
  fallbackLauncherShortcut,
  normalizeDesktopSettings
} from '#~/components/config/desktop-settings-model'
import {
  canUpdateLauncherPrimaryColor,
  getPresetByTheme
} from '#~/components/config/project-theme-color-settings-model'
import { useProjectThemePreviewSources } from '#~/components/config/use-project-theme-preview-sources'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { NativeTabs } from '#~/components/native-tabs'
import { useInterfaceLanguageConfig } from '#~/hooks/use-interface-language-config'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import { usePluginThemes } from '#~/plugins/plugin-themes'
import type { LauncherActivationObserver } from '#~/routes/launcher-workspace-open-lifecycle'
import { normalizeThemeMode, themeAtom } from '#~/store/index.js'
import type { ThemeMode } from '#~/store/index.js'
import { deferImeCompositionEnd, isImeCompositionKeyEvent } from '#~/utils/keyboard-events'
import { getDesktopShortcutFromEvent, parseShortcut } from '#~/utils/shortcutUtils'

import { LauncherExternalSessionsView } from './LauncherExternalSessionsView'
import type { LauncherSearchChromeExtension } from './launcher-search-chrome'
import {
  canUseLauncherApiConfig,
  getLauncherUpdateExperienceTranslationKeys,
  isLauncherSettingAvailable,
  readLauncherSettingsRuntimePolicy
} from './launcher-settings-runtime'
import type { LauncherSettingId } from './launcher-settings-runtime'

export interface LauncherKeyboardHint {
  key: string
  keys: string
  label: string
}

export interface LauncherSettingsResetAction {
  ariaLabel: string
  disabled?: boolean
  key: string
  label: string
  onClick: () => void
}

interface LauncherSettingItem {
  actionLabel?: string
  control: ReactNode
  description: string
  handleActivate?: () => void
  handleAdjust?: (direction: -1 | 1) => void
  icon: string
  id: LauncherSettingId
  keywords: string[]
  layout?: 'inline' | 'stacked'
  title: string
}

const observeAlwaysActiveLauncher = (): LauncherActivationObserver => ({
  isCurrent: () => true,
  onInvalidate: () => () => {},
  release: () => {}
})

interface LauncherSettingSection {
  content?: ReactNode
  icon: string
  id: string
  items: LauncherSettingItem[]
  keywords?: string[]
  resetAction?: () => void
  title: string
}

type GlobalDesktopConfig = NonNullable<ConfigSection['desktop']>
type GlobalAppearanceConfig = NonNullable<ConfigSection['appearance']>

const cloneGlobalDesktopConfig = (value: GlobalDesktopConfig | undefined): GlobalDesktopConfig => ({
  ...(value ?? {})
})

const cloneGlobalAppearanceConfig = (value: GlobalAppearanceConfig | undefined): GlobalAppearanceConfig => ({
  ...(value ?? {})
})

const themeModes = ['system', 'light', 'dark'] as const satisfies readonly ThemeMode[]
const appLanguageValues = appLanguageOptions.map(option => option.value)
type DesktopUpdateChannel = DesktopSettings['updateChannel']
const desktopUpdateChannels = ['stable', 'rc', 'beta', 'alpha'] as const satisfies readonly DesktopUpdateChannel[]
const textSizeValues = ['default', 'large'] as const
const windowModeValues = ['default', 'compact'] as const
const SECTION_SHORTCUT_REVEAL_DELAY_MS = 500
type LauncherTextSize = typeof textSizeValues[number]
type LauncherWindowMode = typeof windowModeValues[number]
const defaultDesktopIconSettings = normalizeDesktopIconSettings(undefined)

const getCycledValue = <T,>(values: readonly T[], value: T, direction: -1 | 1) => {
  const activeIndex = Math.max(0, values.findIndex(candidate => candidate === value))
  return values[(activeIndex + direction + values.length) % values.length] ?? values[0]
}

const matchesQuery = (query: string, item: LauncherSettingItem) => {
  if (query === '') return true
  return matchesPinyinSearch(query, [
    item.title,
    item.description,
    item.icon,
    ...item.keywords
  ])
}

const getLauncherPopupContainer = (triggerNode: HTMLElement) => {
  const launcherRoute = triggerNode.closest('.launcher-route')
  return launcherRoute instanceof HTMLElement ? launcherRoute : document.body
}

const LauncherSwitch = ({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <Switch
    size='small'
    checked={checked}
    aria-label={label}
    onChange={onChange}
  />
)

function LauncherChoiceGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onChange
}: {
  ariaLabel: string
  options: Array<{
    className?: string
    label: ReactNode
    title: string
    value: T
  }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className='launcher-settings__choice-group' role='radiogroup' aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type='button'
          className={[
            'launcher-settings__choice',
            option.className ?? '',
            option.value === value ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          role='radio'
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function LanguageSelectControl({
  currentLanguage,
  onChangeLanguage
}: {
  currentLanguage: string
  onChangeLanguage: (language: string) => void
}) {
  const { t } = useTranslation()
  const activeLanguage = getActiveAppLanguageOption(currentLanguage)

  return (
    <div className='launcher-settings__language-control'>
      <MobileAwareSelect<string>
        className='launcher-settings__select'
        value={activeLanguage?.value ?? appLanguageValues[0] ?? 'zh'}
        aria-label={t('launcher.settings.items.language.title')}
        mobileTitle={t('launcher.settings.items.language.title')}
        options={appLanguageOptions.map(option => ({ value: option.value, label: option.label }))}
        onChange={onChangeLanguage}
      />
    </div>
  )
}

export function LauncherSettingsView({
  active = true,
  getModalContainer = () => document.body,
  isSearchInputComposing,
  query,
  onExternalSessionsImportComplete,
  onKeyboardHintsChange,
  onQueryChange,
  onSearchChromeChange,
  onResetActionChange,
  observeActivation = observeAlwaysActiveLauncher,
  workspaceProjects
}: {
  active?: boolean
  getModalContainer?: () => HTMLElement
  isSearchInputComposing: () => boolean
  query: string
  onExternalSessionsImportComplete: () => Promise<void> | void
  onKeyboardHintsChange: (hints: LauncherKeyboardHint[]) => void
  onQueryChange: (query: string) => void
  onSearchChromeChange: (extension: LauncherSearchChromeExtension | undefined) => void
  onResetActionChange: (action: LauncherSettingsResetAction | undefined) => void
  observeActivation?: () => LauncherActivationObserver
  workspaceProjects: LauncherWorkspaceSelectorProject[]
}) {
  const { message } = App.useApp()
  const themes = usePluginThemes()
  const { i18n, t } = useTranslation()
  const [themeMode, setThemeMode] = useAtom(themeAtom)
  const { resolvedThemeMode } = useResolvedThemeMode()
  const desktopApi = window.oneworksDesktop
  const launcherSettingsRuntimePolicy = useMemo(readLauncherSettingsRuntimePolicy, [])
  const launcherSettingsRuntime = launcherSettingsRuntimePolicy.runtime
  const launcherUpdaterAvailable = launcherSettingsRuntimePolicy.updaterAvailable
  const electronDesktopApi = launcherSettingsRuntime === 'electron' ? desktopApi : undefined
  const desktopPlatform = electronDesktopApi?.platform
  const canUseApiConfig = canUseLauncherApiConfig(launcherSettingsRuntimePolicy)
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>(
    canUseApiConfig ? '/api/config' : null,
    getConfig
  )
  const rawGlobalDesktop = configRes?.sources?.global?.desktop
  const rawGlobalAppearance = configRes?.sources?.global?.appearance
  const isMac = desktopPlatform === 'darwin'
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language
  const { resetGlobalInterfaceLanguage, updateGlobalInterfaceLanguage } = useInterfaceLanguageConfig()
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(() => ({
    ...emptyDesktopSettings,
    launcherShortcut: fallbackLauncherShortcut
  }))
  const [desktopSettingsLoaded, setDesktopSettingsLoaded] = useState(false)
  const [desktopIconSettings, setDesktopIconSettings] = useState<NormalizedDesktopIconSettings>(() =>
    normalizeDesktopIconSettings(undefined)
  )
  const [savingDesktopIconSettings, setSavingDesktopIconSettings] = useState(false)
  const [hideAfterAction, setHideAfterAction] = useState(true)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [showStatusPin, setShowStatusPin] = useState(true)
  const [showCurrentProject, setShowCurrentProject] = useState(true)
  const [searchResources, setSearchResources] = useState(true)
  const [showFooterHints, setShowFooterHints] = useState(true)
  const [textSize, setTextSize] = useState<LauncherTextSize>('default')
  const [windowMode, setWindowMode] = useState<LauncherWindowMode>('default')
  const [showFavoritesInCompactMode, setShowFavoritesInCompactMode] = useState(false)
  const [showSectionShortcuts, setShowSectionShortcuts] = useState(false)
  const isSettingsComposingRef = useRef(false)
  const sectionShortcutRevealTimerRef = useRef<number>()
  const [activeSectionId, setActiveSectionId] = useState<string>()
  const canUpdateDesktopIcon = electronDesktopApi?.getDesktopSettings != null &&
    electronDesktopApi.updateDesktopSettings != null
  const canUpdateAppIconPreferences = canUpdateDesktopIcon || (canUseApiConfig && configRes != null)
  const launcherShortcut = desktopSettings.launcherShortcut
  const iconTheme = desktopIconSettings.iconTheme
  const iconBackground = desktopIconSettings.iconBackground
  const syncAppIcon = desktopIconSettings.syncAppIcon
  const canUpdatePrimaryColor = canUpdateLauncherPrimaryColor(
    desktopSettingsLoaded,
    desktopSettings.themePack,
    themes
  )
  const previewSources = useProjectThemePreviewSources({
    desktopApi: electronDesktopApi,
    iconAppearance: desktopIconSettings.iconAppearance,
    iconBackground,
    iconMode: resolvedThemeMode,
    t
  })

  const normalizeLauncherShortcut = useMemo(() => (
    (shortcut: string) => {
      const parsed = parseShortcut(shortcut, isMac)
      if (
        parsed == null ||
        (!parsed.metaKey && !parsed.ctrlKey && !parsed.altKey)
      ) {
        void message.warning(t('config.desktopSettings.launcherShortcut.invalid'))
        return null
      }
      return shortcut
    }
  ), [isMac, message, t])
  const cycleLanguage = useCallback((direction: -1 | 1) => {
    const current = getActiveAppLanguageOption(currentLanguage)?.value ?? appLanguageValues[0] ?? 'zh'
    const nextLanguage = getCycledValue(appLanguageValues, current, direction)
    if (nextLanguage != null) {
      void updateGlobalInterfaceLanguage(nextLanguage)
    }
  }, [currentLanguage, updateGlobalInterfaceLanguage])
  const focusShortcutInput = useCallback(() => {
    document
      .querySelector<HTMLInputElement>('[data-launcher-setting-id="shortcut"] .config-shortcut-input input')
      ?.focus()
  }, [])
  const updateLauncherShortcut = useCallback((launcherShortcut: string) => {
    const previousSettings = desktopSettings
    setDesktopSettings(prev => ({ ...prev, launcherShortcut }))
    if (electronDesktopApi?.updateDesktopSettings == null) return

    void electronDesktopApi.updateDesktopSettings({ launcherShortcut })
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[launcher-settings] failed to update launcher shortcut', error)
        setDesktopSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
  }, [desktopSettings, electronDesktopApi, message, t])
  const updateOpenLastWorkspaceOnStartup = useCallback((openLastWorkspaceOnStartup: boolean) => {
    const previousSettings = desktopSettings
    setDesktopSettings(prev => ({ ...prev, openLastWorkspaceOnStartup }))
    if (electronDesktopApi?.updateDesktopSettings == null) return

    void electronDesktopApi.updateDesktopSettings({ openLastWorkspaceOnStartup })
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[launcher-settings] failed to update startup behavior', error)
        setDesktopSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
  }, [desktopSettings, electronDesktopApi, message, t])
  const updateDesktopAutoUpdate = useCallback((autoUpdate: boolean) => {
    const previousSettings = desktopSettings
    setDesktopSettings(prev => normalizeDesktopSettings({ ...prev, autoUpdate }))
    if (electronDesktopApi?.updateDesktopSettings == null) return

    void electronDesktopApi.updateDesktopSettings({ autoUpdate })
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[launcher-settings] failed to update desktop auto-update setting', error)
        setDesktopSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
  }, [desktopSettings, electronDesktopApi, message, t])
  const updateDesktopUpdateChannel = useCallback((updateChannel: DesktopUpdateChannel) => {
    const previousSettings = desktopSettings
    setDesktopSettings(prev => normalizeDesktopSettings({ ...prev, updateChannel }))
    if (electronDesktopApi?.updateDesktopSettings == null) return

    void electronDesktopApi.updateDesktopSettings({ updateChannel })
      .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
      .catch((error) => {
        console.error('[launcher-settings] failed to update desktop update channel', error)
        setDesktopSettings(previousSettings)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
  }, [desktopSettings, electronDesktopApi, message, t])
  const updateDesktopIconSettings = useCallback((
    patch: Partial<Pick<DesktopSettings, 'iconAppearance' | 'iconBackground' | 'iconTheme' | 'syncAppIcon'>>
  ) => {
    const previousSettings = desktopIconSettings
    setDesktopIconSettings(prev => normalizeDesktopIconSettings({ ...prev, ...patch }))
    setSavingDesktopIconSettings(true)
    const update = electronDesktopApi?.updateDesktopSettings == null
      ? canUseApiConfig && configRes != null
        ? updateConfig('global', 'desktop', {
          ...cloneGlobalDesktopConfig(rawGlobalDesktop),
          ...patch
        }).then(async () => {
          const nextConfig = await mutateConfig()
          return nextConfig?.sources?.merged?.desktop ?? {
            ...cloneGlobalDesktopConfig(rawGlobalDesktop),
            ...patch
          }
        })
        : Promise.reject(new Error('App icon settings are not available.'))
      : electronDesktopApi.updateDesktopSettings(patch)

    void update
      .then(value => setDesktopIconSettings(normalizeDesktopIconSettings(value)))
      .catch((error) => {
        console.error('[launcher-settings] failed to update app icon settings', error)
        setDesktopIconSettings(previousSettings)
        void message.error(t('config.desktopSettings.appIcon.saveFailed'))
      })
      .finally(() => setSavingDesktopIconSettings(false))
  }, [
    canUseApiConfig,
    configRes,
    desktopIconSettings,
    electronDesktopApi,
    message,
    mutateConfig,
    rawGlobalDesktop,
    t
  ])
  const updateThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    const previousThemeMode = themeMode
    setThemeMode(nextThemeMode)
    if (electronDesktopApi?.updateGlobalAppearanceConfig == null) return

    void electronDesktopApi.updateGlobalAppearanceConfig({ themeMode: nextThemeMode })
      .then((value) => {
        const nextSettings = normalizeDesktopSettings(value)
        setThemeMode(normalizeThemeMode(nextSettings.themeMode))
        setDesktopSettings(nextSettings)
        setDesktopIconSettings(normalizeDesktopIconSettings(nextSettings))
      })
      .catch((error) => {
        console.error('[launcher-settings] failed to update global theme mode', error)
        setThemeMode(previousThemeMode)
        void message.error(t('config.desktopSettings.saveFailed'))
      })
  }, [electronDesktopApi, message, setThemeMode, t, themeMode])
  const updateIconTheme = useCallback((nextIconTheme: DesktopIconTheme) => {
    const preset = getPresetByTheme(nextIconTheme)
    if (canUpdatePrimaryColor) {
      const updatePrimaryColor = electronDesktopApi?.updateGlobalAppearanceConfig == null
        ? canUseApiConfig && configRes != null
          ? updateConfig('global', 'appearance', {
            ...cloneGlobalAppearanceConfig(rawGlobalAppearance),
            primaryColor: preset.primaryColor
          }).then(async () => {
            const nextConfig = await mutateConfig()
            return {
              ...(nextConfig?.sources?.merged?.desktop ?? {}),
              ...(nextConfig?.sources?.merged?.appearance ?? {})
            }
          })
          : undefined
        : electronDesktopApi.updateGlobalAppearanceConfig({ primaryColor: preset.primaryColor })

      if (updatePrimaryColor != null) {
        void updatePrimaryColor
          .then(value => setDesktopSettings(normalizeDesktopSettings(value)))
          .catch((error) => {
            console.error('[launcher-settings] failed to update global primary color', error)
          })
      }
    }
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground,
      iconTheme: nextIconTheme
    })
  }, [
    desktopIconSettings.iconAppearance,
    electronDesktopApi,
    iconBackground,
    canUpdatePrimaryColor,
    canUseApiConfig,
    configRes,
    mutateConfig,
    rawGlobalAppearance,
    updateDesktopIconSettings
  ])
  const updateIconBackground = useCallback((nextIconBackground: DesktopIconBackground) => {
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground: nextIconBackground,
      iconTheme
    })
  }, [desktopIconSettings.iconAppearance, iconTheme, updateDesktopIconSettings])
  const updateSyncAppIcon = useCallback((nextSyncAppIcon: DesktopIconSync) => {
    updateDesktopIconSettings({
      iconAppearance: desktopIconSettings.iconAppearance,
      iconBackground,
      iconTheme,
      syncAppIcon: nextSyncAppIcon
    })
  }, [desktopIconSettings.iconAppearance, iconBackground, iconTheme, updateDesktopIconSettings])
  const resetGeneralSettings = useCallback(() => {
    void resetGlobalInterfaceLanguage()
    if (launcherSettingsRuntime === 'electron') {
      updateLauncherShortcut(fallbackLauncherShortcut)
    }
  }, [launcherSettingsRuntime, resetGlobalInterfaceLanguage, updateLauncherShortcut])
  const resetBehaviorSettings = useCallback(() => {
    if (launcherSettingsRuntime === 'electron') {
      updateOpenLastWorkspaceOnStartup(false)
      updateDesktopAutoUpdate(true)
      updateDesktopUpdateChannel('stable')
    }
    setHideAfterAction(true)
    setLaunchAtLogin(false)
    setShowStatusPin(true)
    setShowCurrentProject(true)
    setSearchResources(true)
    setShowFooterHints(true)
  }, [
    launcherSettingsRuntime,
    updateDesktopAutoUpdate,
    updateDesktopUpdateChannel,
    updateOpenLastWorkspaceOnStartup
  ])
  const resetAppearanceSettings = useCallback(() => {
    setTextSize('default')
    updateThemeMode('system')
    setWindowMode('default')
    setShowFavoritesInCompactMode(false)
    updateDesktopIconSettings(defaultDesktopIconSettings)
  }, [updateDesktopIconSettings, updateThemeMode])

  useEffect(() => {
    if (!canUpdateDesktopIcon) {
      if (!canUseApiConfig || configRes == null) return

      const nextSettings = normalizeDesktopSettings({
        ...(configRes.sources?.merged?.desktop ?? {}),
        ...(configRes.sources?.merged?.appearance ?? {})
      })
      setDesktopSettingsLoaded(true)
      setDesktopSettings(nextSettings)
      setDesktopIconSettings(normalizeDesktopIconSettings(configRes.sources?.merged?.desktop))
      return
    }

    let disposed = false
    void electronDesktopApi?.getDesktopSettings?.()
      .then((value) => {
        if (!disposed) {
          const nextSettings = normalizeDesktopSettings(value)
          setDesktopSettingsLoaded(true)
          setThemeMode(normalizeThemeMode(nextSettings.themeMode))
          setDesktopSettings(nextSettings)
          setDesktopIconSettings(normalizeDesktopIconSettings(nextSettings))
        }
      })
      .catch((error) => {
        console.error('[launcher-settings] failed to load app icon settings', error)
      })

    const dispose = electronDesktopApi?.onDesktopSettingsChange?.((value) => {
      const nextSettings = normalizeDesktopSettings(value)
      setDesktopSettingsLoaded(true)
      setThemeMode(normalizeThemeMode(nextSettings.themeMode))
      setDesktopSettings(nextSettings)
      setDesktopIconSettings(normalizeDesktopIconSettings(nextSettings))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [canUpdateDesktopIcon, canUseApiConfig, configRes, electronDesktopApi, setThemeMode])

  const updateExperienceTranslationKeys = launcherUpdaterAvailable
    ? getLauncherUpdateExperienceTranslationKeys(launcherSettingsRuntime)
    : undefined

  const sections = useMemo<LauncherSettingSection[]>(() => [
    {
      icon: 'settings',
      id: 'general',
      resetAction: resetGeneralSettings,
      title: t('launcher.settings.sections.general'),
      items: [
        {
          actionLabel: t('launcher.footerHints.adjust'),
          control: (
            <LanguageSelectControl
              currentLanguage={currentLanguage}
              onChangeLanguage={language => void updateGlobalInterfaceLanguage(language)}
            />
          ),
          description: t('launcher.settings.items.language.desc'),
          handleActivate: () => cycleLanguage(1),
          handleAdjust: cycleLanguage,
          icon: 'language',
          id: 'language',
          keywords: [
            'language',
            'locale',
            '语言',
            ...appLanguageOptions.flatMap(option => option.searchKeywords)
          ],
          title: t('launcher.settings.items.language.title')
        },
        {
          actionLabel: t('launcher.footerHints.edit'),
          control: (
            <div className='launcher-settings__shortcut'>
              <ShortcutInput
                value={launcherShortcut}
                placeholder={t('config.desktopSettings.launcherShortcut.placeholder')}
                getShortcutFromEvent={getDesktopShortcutFromEvent}
                normalizeShortcut={normalizeLauncherShortcut}
                isMac={isMac}
                t={t}
                onChange={updateLauncherShortcut}
              />
            </div>
          ),
          description: t('launcher.settings.items.shortcut.desc'),
          handleActivate: focusShortcutInput,
          icon: 'keyboard',
          id: 'shortcut',
          keywords: ['shortcut', 'hotkey', 'keyboard', 'launcher', '快捷键', '键盘', '启动'],
          title: t('launcher.settings.items.shortcut.title')
        }
      ]
    },
    {
      icon: 'bolt',
      id: 'behavior',
      resetAction: resetBehaviorSettings,
      title: t('launcher.settings.sections.behavior'),
      items: [
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={desktopSettings.openLastWorkspaceOnStartup}
              label={t('launcher.settings.items.openLastWorkspaceOnStartup.title')}
              onChange={updateOpenLastWorkspaceOnStartup}
            />
          ),
          description: t('launcher.settings.items.openLastWorkspaceOnStartup.desc'),
          handleActivate: () => updateOpenLastWorkspaceOnStartup(!desktopSettings.openLastWorkspaceOnStartup),
          icon: 'history',
          id: 'open-last-workspace-on-startup',
          keywords: [
            'startup',
            'launch',
            'last project',
            'recent workspace',
            'launcher',
            '启动',
            '最近项目',
            '上次项目',
            '启动器'
          ],
          title: t('launcher.settings.items.openLastWorkspaceOnStartup.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={desktopSettings.autoUpdate}
              label={t('launcher.settings.items.autoUpdate.title')}
              onChange={updateDesktopAutoUpdate}
            />
          ),
          description: t('launcher.settings.items.autoUpdate.desc'),
          handleActivate: () => updateDesktopAutoUpdate(!desktopSettings.autoUpdate),
          icon: 'system_update_alt',
          id: 'auto-update',
          keywords: ['update', 'auto update', 'desktop', 'release', '更新', '自动更新', '桌面端'],
          title: t('launcher.settings.items.autoUpdate.title')
        },
        {
          actionLabel: t('launcher.footerHints.adjust'),
          control: (
            <LauncherChoiceGroup<DesktopUpdateChannel>
              ariaLabel={t('launcher.settings.items.updateChannel.title')}
              value={desktopSettings.updateChannel}
              options={desktopUpdateChannels.map(updateChannel => ({
                label: t(`config.desktopSettings.updates.channel.options.${updateChannel}`),
                title: t(`config.desktopSettings.updates.channel.options.${updateChannel}`),
                value: updateChannel
              }))}
              onChange={updateDesktopUpdateChannel}
            />
          ),
          description: t('launcher.settings.items.updateChannel.desc'),
          handleActivate: () =>
            updateDesktopUpdateChannel(getCycledValue(desktopUpdateChannels, desktopSettings.updateChannel, 1)),
          handleAdjust: direction =>
            updateDesktopUpdateChannel(getCycledValue(desktopUpdateChannels, desktopSettings.updateChannel, direction)),
          icon: 'new_releases',
          id: 'update-channel',
          keywords: ['update', 'channel', 'stable', 'rc', 'beta', 'alpha', '更新', '通道', '测试版'],
          title: t('launcher.settings.items.updateChannel.title')
        },
        ...(updateExperienceTranslationKeys == null
          ? []
          : [
            {
              control: (
                <span className='launcher-settings__runtime-status'>
                  <span className='material-symbols-rounded' aria-hidden='true'>published_with_changes</span>
                  {t(updateExperienceTranslationKeys.statusKey)}
                </span>
              ),
              description: t(updateExperienceTranslationKeys.descriptionKey),
              icon: 'system_update_alt',
              id: 'update-experience',
              keywords: ['update', 'web update', 'pwa', 'service worker', '更新', '网页', '渐进式应用'],
              title: t(updateExperienceTranslationKeys.titleKey)
            } satisfies LauncherSettingItem
          ]),
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={launchAtLogin}
              label={t('launcher.settings.items.launchAtLogin.title')}
              onChange={setLaunchAtLogin}
            />
          ),
          description: t('launcher.settings.items.launchAtLogin.desc'),
          handleActivate: () => setLaunchAtLogin(value => !value),
          icon: 'power_settings_new',
          id: 'launch-at-login',
          keywords: ['login', 'startup', 'auto launch', 'boot', '开机', '自启', '启动', '登录'],
          title: t('launcher.settings.items.launchAtLogin.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={showStatusPin}
              label={t('launcher.settings.items.statusPin.title')}
              onChange={setShowStatusPin}
            />
          ),
          description: t(
            desktopPlatform === 'win32'
              ? 'launcher.settings.items.statusPin.descWindows'
              : desktopPlatform === 'darwin'
              ? 'launcher.settings.items.statusPin.descMac'
              : 'launcher.settings.items.statusPin.desc'
          ),
          handleActivate: () => setShowStatusPin(value => !value),
          icon: 'push_pin',
          id: 'status-pin',
          keywords: ['pin', 'menu bar', 'tray', 'status', 'dock', '图标', '菜单栏', '托盘', '右上角'],
          title: t('launcher.settings.items.statusPin.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={hideAfterAction}
              label={t('launcher.settings.items.hideAfterAction.title')}
              onChange={setHideAfterAction}
            />
          ),
          description: t('launcher.settings.items.hideAfterAction.desc'),
          handleActivate: () => setHideAfterAction(value => !value),
          icon: 'visibility_off',
          id: 'hide-after-action',
          keywords: ['hide', 'close', 'action', 'auto', '隐藏', '关闭', '执行'],
          title: t('launcher.settings.items.hideAfterAction.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={showCurrentProject}
              label={t('launcher.settings.items.currentProject.title')}
              onChange={setShowCurrentProject}
            />
          ),
          description: t('launcher.settings.items.currentProject.desc'),
          handleActivate: () => setShowCurrentProject(value => !value),
          icon: 'folder_open',
          id: 'current-project',
          keywords: ['project', 'workspace', 'context', 'current', '项目', '工作区', '上下文'],
          title: t('launcher.settings.items.currentProject.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={searchResources}
              label={t('launcher.settings.items.resourceSearch.title')}
              onChange={setSearchResources}
            />
          ),
          description: t('launcher.settings.items.resourceSearch.desc'),
          handleActivate: () => setSearchResources(value => !value),
          icon: 'manage_search',
          id: 'resource-search',
          keywords: ['search', 'file', 'session', 'terminal', 'website', '搜索', '文件', '会话', '终端'],
          title: t('launcher.settings.items.resourceSearch.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={showFooterHints}
              label={t('launcher.settings.items.footerHints.title')}
              onChange={setShowFooterHints}
            />
          ),
          description: t('launcher.settings.items.footerHints.desc'),
          handleActivate: () => setShowFooterHints(value => !value),
          icon: 'keyboard_command_key',
          id: 'footer-hints',
          keywords: ['hint', 'keyboard', 'footer', 'shortcut', '提示', '底部', '键盘'],
          title: t('launcher.settings.items.footerHints.title')
        }
      ]
    },
    {
      icon: 'palette',
      id: 'appearance',
      resetAction: resetAppearanceSettings,
      title: t('launcher.settings.sections.appearance'),
      items: [
        {
          actionLabel: t('launcher.footerHints.adjust'),
          control: (
            <LauncherChoiceGroup
              ariaLabel={t('launcher.settings.items.textSize.title')}
              value={textSize}
              options={[
                {
                  className: 'launcher-settings__choice--text-default',
                  label: <span className='launcher-settings__text-size-sample'>Aa</span>,
                  title: t('launcher.settings.items.textSize.default'),
                  value: 'default'
                },
                {
                  className: 'launcher-settings__choice--text-large',
                  label: <span className='launcher-settings__text-size-sample'>Aa</span>,
                  title: t('launcher.settings.items.textSize.large'),
                  value: 'large'
                }
              ]}
              onChange={setTextSize}
            />
          ),
          description: t('launcher.settings.items.textSize.desc'),
          handleActivate: () => setTextSize(getCycledValue(textSizeValues, textSize, 1)),
          handleAdjust: direction => setTextSize(getCycledValue(textSizeValues, textSize, direction)),
          icon: 'format_size',
          id: 'text-size',
          keywords: ['text', 'font', 'size', '文字', '字体', '大小'],
          title: t('launcher.settings.items.textSize.title')
        },
        {
          actionLabel: t('launcher.footerHints.adjust'),
          control: <ThemeModeRadioGroup value={themeMode} t={t} onChange={updateThemeMode} />,
          description: t('launcher.settings.items.theme.desc'),
          handleActivate: () => updateThemeMode(getCycledValue(themeModes, themeMode, 1)),
          handleAdjust: direction => updateThemeMode(getCycledValue(themeModes, themeMode, direction)),
          icon: 'dark_mode',
          id: 'theme',
          keywords: ['theme', 'appearance', 'dark', 'light', 'system', '主题', '外观', '深色', '浅色'],
          title: t('launcher.settings.items.theme.title')
        },
        {
          actionLabel: t('launcher.footerHints.adjust'),
          control: (
            <LauncherChoiceGroup
              ariaLabel={t('launcher.settings.items.windowMode.title')}
              value={windowMode}
              options={[
                {
                  className: 'launcher-settings__choice--window',
                  label: (
                    <span className='launcher-settings__choice-stack'>
                      <span className='launcher-settings__window-mode-preview is-default'>
                        <span />
                      </span>
                      <span className='launcher-settings__choice-caption'>
                        {t('launcher.settings.items.windowMode.default')}
                      </span>
                    </span>
                  ),
                  title: t('launcher.settings.items.windowMode.default'),
                  value: 'default'
                },
                {
                  className: 'launcher-settings__choice--window',
                  label: (
                    <span className='launcher-settings__choice-stack'>
                      <span className='launcher-settings__window-mode-preview is-compact'>
                        <span />
                      </span>
                      <span className='launcher-settings__choice-caption'>
                        {t('launcher.settings.items.windowMode.compact')}
                      </span>
                    </span>
                  ),
                  title: t('launcher.settings.items.windowMode.compact'),
                  value: 'compact'
                }
              ]}
              onChange={setWindowMode}
            />
          ),
          description: t('launcher.settings.items.windowMode.desc'),
          handleActivate: () => setWindowMode(getCycledValue(windowModeValues, windowMode, 1)),
          handleAdjust: direction => setWindowMode(getCycledValue(windowModeValues, windowMode, direction)),
          icon: 'select_window',
          id: 'window-mode',
          keywords: ['window', 'mode', 'default', 'compact', '窗口', '模式', '紧凑'],
          title: t('launcher.settings.items.windowMode.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <LauncherSwitch
              checked={showFavoritesInCompactMode}
              label={t('launcher.settings.items.favorites.title')}
              onChange={setShowFavoritesInCompactMode}
            />
          ),
          description: t('launcher.settings.items.favorites.desc'),
          handleActivate: () => setShowFavoritesInCompactMode(value => !value),
          icon: 'star',
          id: 'favorites',
          keywords: ['favorite', 'compact', 'star', '收藏', '紧凑'],
          title: t('launcher.settings.items.favorites.title')
        },
        {
          actionLabel: t('launcher.footerHints.toggle'),
          control: (
            <div className='launcher-settings__icon-preview-row'>
              <div className='launcher-settings__icon-preview' aria-hidden='true'>
                <img src={previewSources[iconTheme]} alt='' />
              </div>
              <div className='launcher-settings__icon-controls'>
                <ProjectThemeColorSettingsControls
                  canUpdateDesktopIcon={canUpdateDesktopIcon}
                  disabled={!canUpdateAppIconPreferences}
                  iconBackground={iconBackground}
                  previewSources={previewSources}
                  saving={savingDesktopIconSettings}
                  selectedTheme={iconTheme}
                  syncAppIcon={syncAppIcon}
                  syncAppIconDescription={t('launcher.settings.items.appIcon.syncDesc')}
                  syncAppIconLabel={t('launcher.settings.items.appIcon.syncLabel')}
                  t={t}
                  themeAriaLabel={t('launcher.settings.items.appIcon.title')}
                  onIconBackgroundChange={updateIconBackground}
                  onSyncAppIconChange={updateSyncAppIcon}
                  onThemeChange={updateIconTheme}
                />
              </div>
            </div>
          ),
          description: t('launcher.settings.items.appIcon.desc'),
          handleActivate: canUpdateDesktopIcon ? () => updateSyncAppIcon(!syncAppIcon) : undefined,
          handleAdjust: direction => updateIconTheme(getCycledValue(iconThemes, iconTheme, direction)),
          icon: 'app_shortcut',
          id: 'app-icon',
          keywords: ['icon', 'dock', 'theme', 'background', '图标', 'dock', '主题', '背景'],
          layout: 'stacked',
          title: t('launcher.settings.items.appIcon.title')
        }
      ]
    },
    {
      content: (
        <LauncherExternalSessionsView
          active={active}
          config={configRes?.sources?.global?.general?.nativeHistoryImport}
          getModalContainer={getModalContainer}
          onImportComplete={onExternalSessionsImportComplete}
          onQueryChange={onQueryChange}
          onSearchChromeChange={onSearchChromeChange}
          observeActivation={observeActivation}
          query={query}
          workspaceProjects={workspaceProjects}
        />
      ),
      icon: 'history',
      id: 'external-sessions',
      items: [],
      keywords: [
        'external sessions',
        'history',
        'import',
        'codex',
        'claude code',
        '外部会话',
        '历史会话',
        '导入'
      ],
      title: t('launcher.settings.sections.externalSessions')
    }
  ], [
    active,
    currentLanguage,
    cycleLanguage,
    desktopSettings.autoUpdate,
    desktopSettings.openLastWorkspaceOnStartup,
    desktopSettings.updateChannel,
    focusShortcutInput,
    hideAfterAction,
    iconBackground,
    iconTheme,
    canUpdateAppIconPreferences,
    canUpdateDesktopIcon,
    configRes,
    desktopPlatform,
    isMac,
    launcherShortcut,
    launchAtLogin,
    normalizeLauncherShortcut,
    onExternalSessionsImportComplete,
    observeActivation,
    onQueryChange,
    onSearchChromeChange,
    previewSources,
    resetAppearanceSettings,
    resetBehaviorSettings,
    resetGeneralSettings,
    searchResources,
    savingDesktopIconSettings,
    showCurrentProject,
    showFavoritesInCompactMode,
    showFooterHints,
    showStatusPin,
    syncAppIcon,
    t,
    textSize,
    themeMode,
    updateIconBackground,
    updateIconTheme,
    updateLauncherShortcut,
    updateGlobalInterfaceLanguage,
    updateThemeMode,
    updateDesktopAutoUpdate,
    updateDesktopUpdateChannel,
    updateExperienceTranslationKeys,
    updateOpenLastWorkspaceOnStartup,
    updateSyncAppIcon,
    windowMode,
    workspaceProjects
  ])
  const normalizedQuery = normalizePinyinSearchQuery(
    activeSectionId === 'external-sessions' ? '' : query
  )
  const filteredSections = useMemo(() =>
    sections
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          isLauncherSettingAvailable(launcherSettingsRuntimePolicy, item.id) &&
          matchesQuery(normalizedQuery, item)
        )
      }))
      .filter(section =>
        section.items.length > 0 ||
        (
          section.content != null &&
          (
            normalizedQuery === '' ||
            matchesPinyinSearch(normalizedQuery, [
              section.title,
              section.icon,
              ...(section.keywords ?? [])
            ])
          )
        )
      ), [launcherSettingsRuntimePolicy, normalizedQuery, sections])
  const activeSection = filteredSections.find(section => section.id === activeSectionId) ?? filteredSections[0]
  const selectedSection = sections.find(section => section.id === activeSectionId)
  const flatItems = useMemo(() => activeSection?.items ?? [], [activeSection?.items])
  const [activeSettingId, setActiveSettingId] = useState<LauncherSettingId>()
  const activeSetting = flatItems.find(item => item.id === activeSettingId) ?? flatItems[0]
  const sectionShortcutModifierLabel = isMac ? '⌘' : 'Ctrl'
  const activateSection = useCallback((
    nextSection: LauncherSettingSection,
    options: { focusTab?: boolean } = {}
  ) => {
    if (
      selectedSection != null &&
      (selectedSection.content != null) !== (nextSection.content != null) &&
      query !== ''
    ) {
      onQueryChange('')
    }
    setActiveSectionId(nextSection.id)
    if (options.focusTab === true) {
      requestAnimationFrame(() => {
        document.getElementById(`launcher-settings-tab-${nextSection.id}`)?.focus()
      })
    }
  }, [onQueryChange, query, selectedSection])
  const switchSectionByOffset = useCallback((offset: -1 | 1, options: { focusTab?: boolean } = {}) => {
    if (filteredSections.length < 2) return
    const activeIndex = Math.max(0, filteredSections.findIndex(section => section.id === activeSection?.id))
    const nextSection = filteredSections[(activeIndex + offset + filteredSections.length) % filteredSections.length]
    if (nextSection == null) return
    activateSection(nextSection, options)
  }, [activateSection, activeSection?.id, filteredSections])
  const selectSectionByIndex = useCallback((sectionIndex: number, options: { focusTab?: boolean } = {}) => {
    const nextSection = filteredSections[sectionIndex]
    if (nextSection == null) return false
    activateSection(nextSection, options)
    return true
  }, [activateSection, filteredSections])
  const keyboardHints = useMemo<LauncherKeyboardHint[]>(() =>
    [
      filteredSections.length > 1
        ? {
          key: 'section',
          keys: `${isMac ? '⌘' : 'Ctrl'}1-${Math.min(filteredSections.length, 9)}`,
          label: t('launcher.footerHints.section')
        }
        : undefined,
      flatItems.length > 1 ? { key: 'move', keys: '↑↓', label: t('launcher.footerHints.move') } : undefined,
      activeSetting?.handleAdjust != null
        ? { key: 'adjust', keys: '←→', label: t('launcher.footerHints.adjust') }
        : undefined,
      activeSetting?.handleActivate != null
        ? {
          key: 'activate',
          keys: activeSetting.id === 'shortcut' ? 'Enter' : 'Enter/Space',
          label: activeSetting.actionLabel ?? t('launcher.footerHints.open')
        }
        : undefined,
      { key: 'back', keys: 'Esc', label: t('launcher.footerHints.back') }
    ].filter((hint): hint is LauncherKeyboardHint => hint != null), [
    activeSetting?.actionLabel,
    activeSetting?.handleActivate,
    activeSetting?.handleAdjust,
    activeSetting?.id,
    filteredSections.length,
    flatItems.length,
    isMac,
    t
  ])
  const resetAction = useMemo<LauncherSettingsResetAction | undefined>(() => (
    activeSection?.resetAction == null
      ? undefined
      : {
        ariaLabel: t('launcher.settings.resetSection', { section: activeSection.title }),
        key: activeSection.id,
        label: t('common.reset'),
        onClick: activeSection.resetAction
      }
  ), [activeSection, t])

  useEffect(() => {
    if (filteredSections.length === 0) {
      setActiveSectionId(undefined)
      return
    }
    if (activeSectionId == null || !filteredSections.some(section => section.id === activeSectionId)) {
      setActiveSectionId(filteredSections[0]?.id)
    }
  }, [activeSectionId, filteredSections])

  useEffect(() => {
    if (flatItems.length === 0) {
      setActiveSettingId(undefined)
      return
    }
    if (activeSettingId == null || !flatItems.some(item => item.id === activeSettingId)) {
      setActiveSettingId(flatItems[0]?.id)
    }
  }, [activeSettingId, flatItems])

  useEffect(() => {
    if (activeSetting?.id == null) return
    document
      .querySelector<HTMLElement>(`[data-launcher-setting-id="${activeSetting.id}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeSetting?.id])

  useEffect(() => {
    onKeyboardHintsChange(keyboardHints)
  }, [keyboardHints, onKeyboardHintsChange])

  useEffect(() => {
    onResetActionChange(resetAction)
    return () => onResetActionChange(undefined)
  }, [onResetActionChange, resetAction])

  useEffect(() => {
    const clearRevealTimer = () => {
      if (sectionShortcutRevealTimerRef.current == null) return
      window.clearTimeout(sectionShortcutRevealTimerRef.current)
      sectionShortcutRevealTimerRef.current = undefined
    }
    const hideSectionShortcuts = () => {
      clearRevealTimer()
      setShowSectionShortcuts(false)
    }
    const isRevealModifierActive = (event: KeyboardEvent) => (
      isMac
        ? event.metaKey || event.key === 'Meta' || event.code.startsWith('Meta')
        : event.ctrlKey || event.key === 'Control' || event.code.startsWith('Control')
    )

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeCompositionKeyEvent(event, isSearchInputComposing() || isSettingsComposingRef.current)) {
        hideSectionShortcuts()
        return
      }
      if (!isRevealModifierActive(event)) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.config-shortcut-input') != null) {
        hideSectionShortcuts()
        return
      }
      if (sectionShortcutRevealTimerRef.current != null || showSectionShortcuts) return
      sectionShortcutRevealTimerRef.current = window.setTimeout(() => {
        sectionShortcutRevealTimerRef.current = undefined
        setShowSectionShortcuts(true)
      }, SECTION_SHORTCUT_REVEAL_DELAY_MS)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      const releasedRevealModifier = isMac
        ? event.key === 'Meta' || event.code.startsWith('Meta') || !event.metaKey
        : event.key === 'Control' || event.code.startsWith('Control') || !event.ctrlKey
      if (releasedRevealModifier) {
        hideSectionShortcuts()
      }
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hideSectionShortcuts()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', hideSectionShortcuts)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', hideSectionShortcuts)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearRevealTimer()
    }
  }, [isMac, isSearchInputComposing, showSectionShortcuts])

  useEffect(() => {
    const handleSettingsKeyDown = (event: KeyboardEvent) => {
      if (isImeCompositionKeyEvent(event, isSearchInputComposing() || isSettingsComposingRef.current)) {
        return
      }
      if (event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.config-shortcut-input') != null) {
        return
      }
      const targetInput = target instanceof HTMLInputElement ? target : undefined
      const sectionNumberMatch = event.code.match(/^Digit([1-9])$/u) ?? event.code.match(/^Numpad([1-9])$/u)
      const hasSectionNumberModifier = isMac
        ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
        : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

      if (hasSectionNumberModifier && sectionNumberMatch != null) {
        const sectionIndex = Number(sectionNumberMatch[1]) - 1
        if (selectSectionByIndex(sectionIndex)) {
          event.preventDefault()
        }
        return
      }

      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
        event.preventDefault()
        switchSectionByOffset(event.shiftKey ? -1 : 1)
        return
      }

      if (flatItems.length === 0) return

      const activeIndex = Math.max(0, flatItems.findIndex(item => item.id === activeSetting?.id))
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (activeIndex + direction + flatItems.length) % flatItems.length
        setActiveSettingId(flatItems[nextIndex]?.id)
        return
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        if (activeSetting?.handleAdjust == null) return
        if (targetInput != null) {
          const selectionStart = targetInput.selectionStart ?? 0
          const selectionEnd = targetInput.selectionEnd ?? selectionStart
          const isAtStart = selectionStart === 0 && selectionEnd === 0
          const isAtEnd = selectionStart === targetInput.value.length && selectionEnd === targetInput.value.length
          if (
            (event.key === 'ArrowLeft' && !isAtStart) ||
            (event.key === 'ArrowRight' && !isAtEnd)
          ) {
            return
          }
        }
        event.preventDefault()
        activeSetting.handleAdjust(event.key === 'ArrowRight' ? 1 : -1)
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        if (activeSetting?.handleActivate == null) return
        if (event.key === ' ' && targetInput != null) return
        event.preventDefault()
        activeSetting.handleActivate()
      }
    }

    window.addEventListener('keydown', handleSettingsKeyDown)
    return () => {
      window.removeEventListener('keydown', handleSettingsKeyDown)
    }
  }, [
    activeSetting,
    filteredSections.length,
    flatItems,
    isMac,
    isSearchInputComposing,
    selectSectionByIndex,
    switchSectionByOffset
  ])

  if (filteredSections.length === 0) {
    return (
      <div className='launcher-settings__empty'>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('launcher.settings.empty')} />
      </div>
    )
  }

  return (
    <div
      className={[
        'launcher-settings',
        activeSection?.content != null ? 'launcher-settings--content' : ''
      ].filter(Boolean).join(' ')}
      role={activeSection?.content == null ? 'listbox' : undefined}
      aria-label={t('launcher.settings.listLabel')}
      onCompositionEnd={() =>
        deferImeCompositionEnd((active) => {
          isSettingsComposingRef.current = active
        })}
      onCompositionStart={() => {
        isSettingsComposingRef.current = true
      }}
    >
      <div className='launcher-settings__tabs-surface'>
        <NativeTabs
          activeKey={activeSection?.id}
          ariaLabel={t('launcher.settings.sectionsLabel')}
          className='launcher-settings__tabs'
          items={filteredSections.map((section, sectionIndex) => {
            const sectionShortcut = `${sectionShortcutModifierLabel}${sectionIndex + 1}`
            return {
              ariaControls: `launcher-settings-panel-${section.id}`,
              icon: section.icon,
              id: `launcher-settings-tab-${section.id}`,
              key: section.id,
              label: (
                <>
                  <span className='launcher-settings__tab-title'>{section.title}</span>
                  {showSectionShortcuts && sectionIndex < 9 && filteredSections.length > 1 && (
                    <Tooltip
                      title={t('launcher.settings.sectionShortcutTooltip', {
                        section: section.title,
                        shortcut: sectionShortcut
                      })}
                      placement='bottom'
                      classNames={{ root: 'launcher-command-tooltip launcher-settings__tab-shortcut-tooltip' }}
                      getPopupContainer={getLauncherPopupContainer}
                    >
                      <span className='launcher-settings__tab-shortcut' aria-hidden='true'>
                        {sectionShortcut}
                      </span>
                    </Tooltip>
                  )}
                </>
              )
            }
          })}
          onChange={sectionId => {
            const section = filteredSections.find(candidate => candidate.id === sectionId)
            if (section != null) activateSection(section)
          }}
        />
      </div>
      <section
        className={[
          'launcher-settings__panel',
          activeSection?.content != null ? 'launcher-settings__panel--content' : ''
        ].filter(Boolean).join(' ')}
        id={`launcher-settings-panel-${activeSection?.id ?? 'empty'}`}
        role='tabpanel'
        aria-labelledby={`launcher-settings-tab-${activeSection?.id ?? 'empty'}`}
      >
        {activeSection?.content ?? (
          <div className='launcher-settings__items'>
            {flatItems.map(item => (
              <div
                className={[
                  'launcher-settings__item',
                  item.layout === 'stacked' ? 'is-stacked' : '',
                  item.id === activeSetting?.id ? 'is-active' : ''
                ].filter(Boolean).join(' ')}
                data-launcher-setting-id={item.id}
                key={item.id}
                role='option'
                aria-selected={item.id === activeSetting?.id}
              >
                <div className='launcher-settings__item-main'>
                  <span className='material-symbols-rounded launcher-settings__item-icon' aria-hidden='true'>
                    {item.icon}
                  </span>
                  <span className='launcher-settings__item-text'>
                    <span className='launcher-settings__item-title'>{item.title}</span>
                    <span className='launcher-settings__item-desc'>{item.description}</span>
                  </span>
                </div>
                <div
                  className={`launcher-settings__control ${
                    item.layout === 'stacked' ? 'launcher-settings__control--wide' : ''
                  }`}
                >
                  {item.control}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
