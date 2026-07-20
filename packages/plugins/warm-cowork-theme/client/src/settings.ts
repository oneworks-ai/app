export interface WarmCoworkNumericOverride {
  enabled: boolean
  value: number
}

export interface WarmCoworkThemeSettings {
  overrides: {
    colors: { palette: boolean; status: boolean }
    components: { buttons: boolean; inputs: boolean; menus: boolean; overlays: boolean }
    workspace: {
      controlRadius: WarmCoworkNumericOverride
      grid: boolean
      groupRadius: WarmCoworkNumericOverride
      panelRadius: WarmCoworkNumericOverride
      shadows: boolean
    }
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
): WarmCoworkNumericOverride => {
  const override = asRecord(value)
  const numericValue = typeof override.value === 'number' && Number.isFinite(override.value)
    ? Math.min(max, Math.max(min, override.value))
    : defaultValue
  return { enabled: typeof value === 'boolean' ? value : override.enabled !== false, value: numericValue }
}

export const normalizeWarmCoworkThemeSettings = (value: unknown): WarmCoworkThemeSettings => {
  const settings = asRecord(value)
  const overrides = asRecord(settings.overrides)
  const colors = asRecord(overrides.colors)
  const components = asRecord(overrides.components)
  const workspace = asRecord(overrides.workspace)
  return {
    overrides: {
      colors: { palette: colors.palette !== false, status: colors.status !== false },
      components: {
        buttons: components.buttons !== false,
        inputs: components.inputs !== false,
        menus: components.menus !== false,
        overlays: components.overlays !== false
      },
      workspace: {
        controlRadius: normalizeNumericOverride(workspace.controlRadius, { min: 0, max: 24, value: 9 }),
        grid: workspace.grid !== false,
        groupRadius: normalizeNumericOverride(workspace.groupRadius, { min: 0, max: 28, value: 14 }),
        panelRadius: normalizeNumericOverride(workspace.panelRadius, { min: 0, max: 32, value: 20 }),
        shadows: workspace.shadows !== false
      }
    }
  }
}
