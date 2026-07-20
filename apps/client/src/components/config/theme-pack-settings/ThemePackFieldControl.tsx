import { InputNumber, Switch } from 'antd'

import type { PluginThemeSettingField, PluginThemeSettingsValue } from '#~/plugins/plugin-theme-contract'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getPathValue = (value: unknown, path: string): unknown => (
  path.split('.').reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value)
)

export function ThemePackFieldControl({
  field,
  settings,
  title,
  onChange
}: {
  field: PluginThemeSettingField
  settings: PluginThemeSettingsValue
  title: string
  onChange: (path: string, value: unknown) => void
}) {
  if (field.kind === 'number') {
    const value = getPathValue(settings, field.path)
    const enabled = field.enabledPath == null || getPathValue(settings, field.enabledPath) !== false
    return (
      <div className='theme-pack-settings__numeric-control'>
        <InputNumber
          aria-label={`${title} ${String(value ?? '')}${field.unit ?? ''}`}
          controls={false}
          max={field.max}
          min={field.min}
          precision={0}
          readOnly={field.readOnly !== false}
          suffix={field.unit}
          value={typeof value === 'number' ? value : undefined}
          onChange={nextValue => field.readOnly === false && nextValue != null && onChange(field.path, nextValue)}
        />
        {field.enabledPath != null && (
          <Switch
            aria-label={title}
            checked={enabled}
            onChange={nextValue => onChange(field.enabledPath!, nextValue)}
          />
        )}
      </div>
    )
  }

  return (
    <div className='theme-pack-settings__toggle-control'>
      {field.visual === 'swatches' && (
        <span className={`theme-pack-settings__swatches theme-pack-settings__swatches--${field.id}`} aria-hidden='true'>
          <i />
          <i />
          <i />
        </span>
      )}
      <Switch
        aria-label={title}
        checked={getPathValue(settings, field.path) !== false}
        onChange={nextValue => onChange(field.path, nextValue)}
      />
    </div>
  )
}
