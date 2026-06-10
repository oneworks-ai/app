import type { ThemeMode } from '#~/store/index.js'

import type { TranslationFn } from './configUtils'

export function ThemeModeRadioGroup({
  value,
  t,
  onChange
}: {
  value: ThemeMode
  t: TranslationFn
  onChange: (value: ThemeMode) => void
}) {
  const options: Array<{ icon: string; label: string; value: ThemeMode }> = [
    {
      icon: 'contrast',
      label: t('common.themeSystem'),
      value: 'system'
    },
    {
      icon: 'light_mode',
      label: t('common.themeLight'),
      value: 'light'
    },
    {
      icon: 'dark_mode',
      label: t('common.themeDark'),
      value: 'dark'
    }
  ]

  return (
    <div
      className='config-view__theme-mode-radio-group'
      role='radiogroup'
      aria-label={t('config.appSettings.themeMode.label')}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type='button'
            className={`config-view__theme-mode-radio${active ? ' is-active' : ''}`}
            aria-label={option.label}
            role='radio'
            aria-checked={active}
            title={option.label}
            onClick={() => onChange(option.value)}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>{option.icon}</span>
          </button>
        )
      })}
    </div>
  )
}
