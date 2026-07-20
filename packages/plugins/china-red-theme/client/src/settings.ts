export interface ChinaRedNumericOverride {
  enabled: boolean
  value: number
}

export interface ChinaRedThemeSettings {
  overrides: {
    colors: { backgrounds: boolean; borders: boolean }
    components: { buttons: boolean; inputs: boolean; menus: boolean; overlays: boolean }
    layout: { iconSize: ChinaRedNumericOverride; padding: ChinaRedNumericOverride }
  }
  showBanner: boolean
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const normalizeNumericOverride = (
  value: unknown,
  { max, min, value: defaultValue }: { max: number; min: number; value: number }
): ChinaRedNumericOverride => {
  const override = asRecord(value)
  const numericValue = typeof override.value === 'number' && Number.isFinite(override.value)
    ? Math.min(max, Math.max(min, override.value))
    : defaultValue
  return {
    enabled: typeof value === 'boolean' ? value : override.enabled !== false,
    value: numericValue
  }
}

export const normalizeChinaRedThemeSettings = (value: unknown): ChinaRedThemeSettings => {
  const settings = asRecord(value)
  const overrides = asRecord(settings.overrides)
  const colors = asRecord(overrides.colors)
  const components = asRecord(overrides.components)
  const layout = asRecord(overrides.layout)
  return {
    overrides: {
      colors: {
        backgrounds: colors.backgrounds !== false,
        borders: colors.borders !== false
      },
      components: {
        buttons: components.buttons !== false,
        inputs: components.inputs !== false,
        menus: components.menus !== false,
        overlays: components.overlays !== false
      },
      layout: {
        iconSize: normalizeNumericOverride(layout.iconSize, { min: 12, max: 32, value: 16 }),
        padding: normalizeNumericOverride(layout.padding, { min: 4, max: 24, value: 10 })
      }
    },
    showBanner: settings.showBanner !== false
  }
}
