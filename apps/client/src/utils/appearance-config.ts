import type {
  AppearanceHistoryTimelineMode,
  AppearanceThemePack,
  AppearanceThemePackConfigMap,
  ConfigResponse
} from '@oneworks/types'

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const mergeThemePackConfigMaps = (resolvedValue: unknown, rawValue: unknown) => {
  const resolved = asRecord(resolvedValue)
  const raw = asRecord(rawValue)
  const themeIds = new Set([...Object.keys(resolved), ...Object.keys(raw)])

  return Object.fromEntries([...themeIds].map(themeId => [
    themeId,
    mergeNestedRecords(resolved[themeId], raw[themeId])
  ]))
}

const mergeNestedRecords = (resolvedValue: unknown, rawValue: unknown): Record<string, unknown> => {
  const resolved = asRecord(resolvedValue)
  const raw = asRecord(rawValue)
  const keys = new Set([...Object.keys(resolved), ...Object.keys(raw)])

  return Object.fromEntries([...keys].map(key => {
    const resolvedEntry = resolved[key]
    const rawEntry = raw[key]
    const shouldMerge = Object.keys(asRecord(resolvedEntry)).length > 0 ||
      Object.keys(asRecord(rawEntry)).length > 0

    return [key, shouldMerge ? mergeNestedRecords(resolvedEntry, rawEntry) : rawEntry ?? resolvedEntry]
  }))
}

export const applyAppearanceConfigPatch = (
  rawValue: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> => ({
  ...asRecord(rawValue),
  ...patch
})

export const mergeAppearanceConfigForEditing = (
  resolvedValue: unknown,
  rawValue: unknown
): Record<string, unknown> => {
  const resolved = asRecord(resolvedValue)
  const raw = asRecord(rawValue)
  const hasThemePackConfig = resolved.themePacks != null || raw.themePacks != null

  return {
    ...resolved,
    ...raw,
    ...(hasThemePackConfig
      ? { themePacks: mergeThemePackConfigMaps(resolved.themePacks, raw.themePacks) }
      : {})
  }
}

export const DEFAULT_HISTORY_TIMELINE_MODE: AppearanceHistoryTimelineMode = 'event-line'

export const normalizeHistoryTimelineMode = (value: unknown): AppearanceHistoryTimelineMode => (
  value === 'node' ? 'node' : DEFAULT_HISTORY_TIMELINE_MODE
)

export const getGlobalHistoryTimelineMode = (
  configRes: ConfigResponse | undefined
): AppearanceHistoryTimelineMode =>
  normalizeHistoryTimelineMode(
    configRes?.resolvedSources?.global?.appearance?.historyTimelineMode ??
      configRes?.sources?.global?.appearance?.historyTimelineMode
  )

export const DEFAULT_THEME_PACK: AppearanceThemePack = 'default'

export const normalizeAppearanceThemePack = (value: unknown): AppearanceThemePack => (
  typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
    ? value
    : DEFAULT_THEME_PACK
)

export const getThemePackSettingsMap = (appearance: unknown): AppearanceThemePackConfigMap => {
  const themePacks = asRecord(asRecord(appearance).themePacks)
  return Object.fromEntries(
    Object.entries(themePacks)
      .filter((entry): entry is [string, Record<string, unknown>] => Object.keys(asRecord(entry[1])).length > 0)
      .map(([themeId, settings]) => [themeId, asRecord(settings)])
  )
}

export const getThemePackSettings = (appearance: unknown, themeId: string): Record<string, unknown> => (
  getThemePackSettingsMap(appearance)[themeId] ?? {}
)

export const getGlobalThemePackSettingsMap = (
  configRes: ConfigResponse | undefined
): AppearanceThemePackConfigMap | undefined => {
  if (configRes == null) return undefined
  return getThemePackSettingsMap(
    configRes.resolvedSources?.global?.appearance ??
      configRes.sources?.global?.appearance
  )
}

export const getGlobalAppearanceThemePack = (
  configRes: ConfigResponse | undefined
): AppearanceThemePack | undefined => {
  if (configRes == null) return undefined

  return normalizeAppearanceThemePack(
    configRes.resolvedSources?.global?.appearance?.themePack ??
      configRes.sources?.global?.appearance?.themePack
  )
}
