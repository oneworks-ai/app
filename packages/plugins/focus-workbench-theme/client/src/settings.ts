export interface FocusWorkbenchNumericOverride {
  enabled: boolean
  value: number
}

export interface FocusWorkbenchThemeSettings {
  overrides: {
    colors: { dividers: boolean; surfaces: boolean }
    components: { buttons: boolean; inputs: boolean; menus: boolean; overlays: boolean }
    density: { buttonPadding: FocusWorkbenchNumericOverride; iconSize: FocusWorkbenchNumericOverride }
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
): FocusWorkbenchNumericOverride => {
  const override = asRecord(value)
  const numericValue = typeof override.value === 'number' && Number.isFinite(override.value)
    ? Math.min(max, Math.max(min, override.value))
    : defaultValue
  return { enabled: typeof value === 'boolean' ? value : override.enabled !== false, value: numericValue }
}

export const normalizeFocusWorkbenchThemeSettings = (value: unknown): FocusWorkbenchThemeSettings => {
  const settings = asRecord(value)
  const overrides = asRecord(settings.overrides)
  const colors = asRecord(overrides.colors)
  const components = asRecord(overrides.components)
  const density = asRecord(overrides.density)
  return {
    overrides: {
      colors: { dividers: colors.dividers !== false, surfaces: colors.surfaces !== false },
      components: {
        buttons: components.buttons !== false,
        inputs: components.inputs !== false,
        menus: components.menus !== false,
        overlays: components.overlays !== false
      },
      density: {
        buttonPadding: normalizeNumericOverride(density.buttonPadding, { min: 5, max: 12, value: 5 }),
        iconSize: normalizeNumericOverride(density.iconSize, { min: 14, max: 24, value: 16 })
      }
    }
  }
}
