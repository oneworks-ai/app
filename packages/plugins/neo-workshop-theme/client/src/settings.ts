export interface NeoWorkshopNumericOverride {
  enabled: boolean
  value: number
}

export interface NeoWorkshopThemeSettings {
  overrides: {
    colors: { borders: boolean; palette: boolean }
    components: { buttons: boolean; inputs: boolean; menus: boolean; overlays: boolean }
    geometry: { buttonPadding: NeoWorkshopNumericOverride; corners: boolean; shadows: boolean }
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const normalizeNumericOverride = (
  value: unknown,
  { max, min, value: defaultValue }: { max: number; min: number; value: number }
): NeoWorkshopNumericOverride => {
  const override = asRecord(value)
  const numericValue = typeof override.value === 'number' && Number.isFinite(override.value)
    ? Math.min(max, Math.max(min, override.value))
    : defaultValue
  return {
    enabled: typeof value === 'boolean' ? value : override.enabled !== false,
    value: numericValue
  }
}

export const normalizeNeoWorkshopThemeSettings = (value: unknown): NeoWorkshopThemeSettings => {
  const settings = asRecord(value)
  const overrides = asRecord(settings.overrides)
  const colors = asRecord(overrides.colors)
  const components = asRecord(overrides.components)
  const geometry = asRecord(overrides.geometry)
  return {
    overrides: {
      colors: {
        borders: colors.borders !== false,
        palette: colors.palette !== false
      },
      components: {
        buttons: components.buttons !== false,
        inputs: components.inputs !== false,
        menus: components.menus !== false,
        overlays: components.overlays !== false
      },
      geometry: {
        buttonPadding: normalizeNumericOverride(geometry.buttonPadding, { min: 5, max: 12, value: 5 }),
        corners: geometry.corners !== false,
        shadows: geometry.shadows !== false
      }
    }
  }
}
