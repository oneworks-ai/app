import type { CSSProperties } from 'react'

import { Switch, Tooltip } from 'antd'

import { ONEWORKS_THEME_COLOR_PRESETS } from '@oneworks/icon/presets'

import { iconBackgrounds } from './app-icon-settings-model'
import type { DesktopIconBackground, DesktopIconSync, DesktopIconTheme } from './app-icon-settings-model'
import type { TranslationFn } from './configUtils'

const backgroundIcons: Record<DesktopIconBackground, string> = {
  transparent: 'opacity',
  solid: 'circle',
  textured: 'texture'
}

export function ProjectThemeColorSettingsControls({
  canUpdateDesktopIcon,
  backgroundAriaLabel,
  backgroundOptionTranslationPrefix = 'config.appSettings.projectThemeColor.backgroundStyle.options',
  iconBackground,
  previewSources,
  saving,
  selectedTheme,
  showBackgroundControls = true,
  syncAppIcon,
  syncAppIconDescription,
  syncAppIconLabel,
  t,
  themeAriaLabel,
  onIconBackgroundChange,
  onSyncAppIconChange,
  onThemeChange
}: {
  backgroundAriaLabel?: string
  backgroundOptionTranslationPrefix?: string
  canUpdateDesktopIcon: boolean
  iconBackground: DesktopIconBackground
  previewSources: Partial<Record<DesktopIconTheme, string>>
  saving: boolean
  selectedTheme: DesktopIconTheme
  showBackgroundControls?: boolean
  syncAppIcon: DesktopIconSync
  syncAppIconDescription: string
  syncAppIconLabel: string
  t: TranslationFn
  themeAriaLabel: string
  onIconBackgroundChange: (background: DesktopIconBackground) => void
  onSyncAppIconChange: (checked: boolean) => void
  onThemeChange: (theme: DesktopIconTheme) => void
}) {
  const selectedThemeIndex = Math.max(
    0,
    ONEWORKS_THEME_COLOR_PRESETS.findIndex(preset => preset.theme === selectedTheme)
  )

  return (
    <div className='config-view__project-theme-settings'>
      <div className='config-view__project-theme-controls'>
        <div className='config-view__project-theme-picker'>
          <div
            className='config-view__project-theme-radio-group'
            role='radiogroup'
            aria-label={themeAriaLabel}
            style={{
              '--config-project-theme-active-index': selectedThemeIndex
            } as CSSProperties}
          >
            {ONEWORKS_THEME_COLOR_PRESETS.map((preset) => {
              const isActive = preset.theme === selectedTheme
              const label = t(`config.desktopSettings.appIcon.themeOptions.${preset.theme}`)
              return (
                <Tooltip key={preset.theme} title={label}>
                  <button
                    type='button'
                    className={`config-view__project-theme-radio${isActive ? ' is-active' : ''}`}
                    aria-checked={isActive}
                    aria-label={label}
                    role='radio'
                    disabled={saving}
                    onClick={() => onThemeChange(preset.theme)}
                  >
                    <span className='config-view__project-theme-radio-icon' aria-hidden='true'>
                      <img
                        className='config-view__project-theme-radio-image'
                        src={previewSources[preset.theme]}
                        alt=''
                      />
                    </span>
                  </button>
                </Tooltip>
              )
            })}
          </div>
          {showBackgroundControls && (
            <ProjectThemeBackgroundRadioGroup
              ariaLabel={backgroundAriaLabel ?? t('config.appSettings.projectThemeColor.backgroundStyle.label')}
              optionTranslationPrefix={backgroundOptionTranslationPrefix}
              disabled={saving}
              t={t}
              value={iconBackground}
              onChange={onIconBackgroundChange}
            />
          )}
        </div>
        {canUpdateDesktopIcon && (
          <div className='config-view__project-theme-options'>
            <ProjectThemeSwitch
              checked={syncAppIcon}
              disabled={saving}
              label={syncAppIconLabel}
              description={syncAppIconDescription}
              onChange={onSyncAppIconChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectThemeBackgroundRadioGroup({
  ariaLabel,
  optionTranslationPrefix,
  disabled,
  t,
  value,
  onChange
}: {
  ariaLabel: string
  optionTranslationPrefix: string
  disabled: boolean
  t: TranslationFn
  value: DesktopIconBackground
  onChange: (background: DesktopIconBackground) => void
}) {
  const activeBackgroundIndex = Math.max(0, iconBackgrounds.indexOf(value))

  return (
    <div
      className='config-view__project-theme-background-radio-group'
      role='radiogroup'
      aria-label={ariaLabel}
      style={{
        '--config-project-theme-active-index': activeBackgroundIndex
      } as CSSProperties}
    >
      {iconBackgrounds.map((background) => {
        const active = background === value
        const label = t(`${optionTranslationPrefix}.${background}.label`)
        const description = t(`${optionTranslationPrefix}.${background}.desc`)
        return (
          <Tooltip key={background} title={`${label}: ${description}`}>
            <button
              type='button'
              className={`config-view__project-theme-background-radio${active ? ' is-active' : ''}`}
              aria-checked={active}
              aria-label={label}
              role='radio'
              disabled={disabled}
              onClick={() => onChange(background)}
            >
              <span className='material-symbols-rounded' aria-hidden='true'>
                {backgroundIcons[background]}
              </span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

function ProjectThemeSwitch({
  checked,
  description,
  disabled,
  label,
  onChange
}: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div className='config-view__project-theme-switch'>
      <span className='config-view__project-theme-switch-text'>
        <span className='config-view__project-theme-switch-title'>
          {label}
        </span>
        <span className='config-view__project-theme-switch-desc'>
          {description}
        </span>
      </span>
      <Switch aria-label={label} size='small' checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}
