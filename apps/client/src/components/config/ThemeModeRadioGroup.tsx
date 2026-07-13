import type { ThemeMode } from '#~/store/index.js'

import { ConfigIconRadioGroup } from './ConfigIconRadioGroup'
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
  return (
    <ConfigIconRadioGroup
      ariaLabel={t('config.appSettings.themeMode.label')}
      value={value}
      onChange={onChange}
      options={[
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
      ] satisfies Array<{ icon: string; label: string; value: ThemeMode }>}
    />
  )
}
