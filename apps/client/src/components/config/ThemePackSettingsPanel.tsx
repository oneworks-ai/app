import './ThemePackSettingsPanel.scss'

import { useAtom, useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NativeTabs } from '#~/components/native-tabs/NativeTabs'
import { createPluginI18nContext } from '#~/plugins/plugin-i18n'
import { usePluginThemes } from '#~/plugins/plugin-themes'
import { themePackAtom, themePackSettingsAtom } from '#~/store'
import { getThemePackSettings, normalizeAppearanceThemePack } from '#~/utils/appearance-config'
import { normalizeThemePackSettings } from '#~/utils/theme-pack'

import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import type { TranslationFn } from './configUtils'
import { ThemePackFieldControl } from './theme-pack-settings/ThemePackFieldControl'
import { ThemePackPreview } from './theme-pack-settings/ThemePackPreview'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const setPathValue = (
  value: Record<string, unknown>,
  path: string,
  nextValue: unknown
): Record<string, unknown> => {
  const [key, ...rest] = path.split('.')
  if (key == null || key === '') return value
  if (rest.length === 0) return { ...value, [key]: nextValue }
  return {
    ...value,
    [key]: setPathValue(isRecord(value[key]) ? value[key] : {}, rest.join('.'), nextValue)
  }
}

export function ThemePackSettingsPanel({
  appearance,
  onAppearanceChange,
  rawAppearance = appearance,
  t
}: {
  appearance: Record<string, unknown>
  onAppearanceChange: (value: Record<string, unknown>) => void
  rawAppearance?: Record<string, unknown>
  t: TranslationFn
}) {
  const { i18n } = useTranslation()
  const pluginI18n = useMemo(() => createPluginI18nContext(), [i18n.resolvedLanguage])
  const themes = usePluginThemes()
  const setThemePack = useSetAtom(themePackAtom)
  const [runtimeSettings, setRuntimeSettings] = useAtom(themePackSettingsAtom)
  const configuredThemeId = normalizeAppearanceThemePack(appearance.themePack)
  const selectedTheme = themes.find(theme => theme.id === configuredThemeId)
  const selectedThemeId = selectedTheme?.id ?? 'default'
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({})
  const tabs = selectedTheme?.settingsTabs ?? []
  const activeTab = tabs.some(tab => tab.id === activeTabs[selectedThemeId])
    ? activeTabs[selectedThemeId]
    : tabs[0]?.id
  const normalizedSettings = normalizeThemePackSettings(
    selectedTheme,
    getThemePackSettings(appearance, selectedThemeId)
  )

  const updateThemePack = (themeId: string) => {
    setThemePack(themeId)
    onAppearanceChange({ ...rawAppearance, themePack: themeId })
  }

  const updateSetting = (path: string, value: unknown) => {
    if (selectedTheme == null) return
    const rawThemePacks = isRecord(rawAppearance.themePacks) ? rawAppearance.themePacks : {}
    const candidateSettings = rawThemePacks[selectedTheme.id]
    const rawThemeSettings = isRecord(candidateSettings) ? candidateSettings : {}
    const nextRawSettings = setPathValue(rawThemeSettings, path, value)
    setRuntimeSettings({ ...runtimeSettings, [selectedTheme.id]: nextRawSettings })
    onAppearanceChange({
      ...rawAppearance,
      themePacks: { ...rawThemePacks, [selectedTheme.id]: nextRawSettings }
    })
  }

  return (
    <ConfigSectionFrame bodyClassName='theme-pack-settings'>
      <div className='theme-pack-settings__list' role='radiogroup' aria-label={t('config.themePacks.title')}>
        <label
          className={`theme-pack-settings__option${selectedThemeId === 'default' ? ' is-active' : ''}`}
          data-theme-id='default'
        >
          <input
            type='radio'
            name='oneworks-theme-pack'
            value='default'
            checked={selectedThemeId === 'default'}
            onChange={() => updateThemePack('default')}
          />
          <ThemePackPreview />
          <span className='theme-pack-settings__option-copy'>
            <span className='theme-pack-settings__option-title'>
              <strong>{t('config.themePacks.options.default.label')}</strong>
              <small>{t('config.themePacks.readOnly')}</small>
            </span>
            <span>{t('config.themePacks.options.default.description')}</span>
          </span>
          <span className='material-symbols-rounded theme-pack-settings__selected-icon' aria-hidden='true'>
            check_circle
          </span>
        </label>
        {themes.map(theme => {
          const active = selectedThemeId === theme.id
          return (
            <label
              key={`${theme.pluginScope}/${theme.id}`}
              className={`theme-pack-settings__option${active ? ' is-active' : ''}`}
              data-theme-id={theme.id}
            >
              <input
                type='radio'
                name='oneworks-theme-pack'
                value={theme.id}
                checked={active}
                onChange={() => updateThemePack(theme.id)}
              />
              <ThemePackPreview />
              <span className='theme-pack-settings__option-copy'>
                <span className='theme-pack-settings__option-title'>
                  <strong>{pluginI18n.resolveText(theme.title)}</strong>
                  <small>{t('config.themePacks.configurable')}</small>
                </span>
                <span>{pluginI18n.resolveText(theme.description)}</span>
              </span>
              <span className='material-symbols-rounded theme-pack-settings__selected-icon' aria-hidden='true'>
                check_circle
              </span>
            </label>
          )
        })}
      </div>

      <div className='theme-pack-settings__editor' data-theme-id={selectedThemeId}>
        {selectedTheme == null
          ? (
            <div className='theme-pack-settings__read-only-list'>
              {(['colors', 'layout', 'components'] as const).map(item => (
                <div className='theme-pack-settings__read-only-row' key={item}>
                  <span>{t(`config.themePacks.options.default.overview.${item}.label`)}</span>
                  <strong>{t(`config.themePacks.options.default.overview.${item}.value`)}</strong>
                </div>
              ))}
            </div>
          )
          : (
            <>
              <NativeTabs
                activeKey={activeTab}
                ariaLabel={t('config.themePacks.settingsTabs')}
                className='theme-pack-settings__tabs'
                items={tabs.map(tab => ({
                  icon: tab.icon,
                  key: tab.id,
                  label: pluginI18n.resolveText(tab.title)
                }))}
                onChange={tab => setActiveTabs(current => ({ ...current, [selectedThemeId]: tab }))}
              />
              <div className='theme-pack-settings__panel' data-native-tabs-panel='true' role='tabpanel'>
                <div className='theme-pack-settings__fields'>
                  {tabs.find(tab => tab.id === activeTab)?.fields.map(field => {
                    const title = pluginI18n.resolveText(field.title)
                    return (
                      <FieldRow
                        key={field.id}
                        title={title}
                        description={pluginI18n.resolveText(field.description)}
                        icon={field.icon}
                      >
                        <ThemePackFieldControl
                          field={field}
                          settings={normalizedSettings}
                          title={title}
                          onChange={updateSetting}
                        />
                      </FieldRow>
                    )
                  })}
                </div>
              </div>
            </>
          )}
      </div>
    </ConfigSectionFrame>
  )
}
