const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const normalizePluginLauncherSearchResults = (value: unknown): DesktopPluginLauncherSearchResponse => {
  const rawResults = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.results)
    ? value.results
    : []
  return {
    results: rawResults
      .filter((item): item is Record<string, unknown> => (
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.id.trim() !== '' &&
        typeof item.title === 'string' &&
        item.title.trim() !== ''
      ))
      .map(item => ({
        ...(typeof item.badge === 'string' && item.badge.trim() !== '' ? { badge: item.badge } : {}),
        ...(typeof item.description === 'string' && item.description.trim() !== ''
          ? { description: item.description }
          : {}),
        ...(typeof item.icon === 'string' && item.icon.trim() !== '' ? { icon: item.icon } : {}),
        id: String(item.id),
        keywords: Array.isArray(item.keywords)
          ? item.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
          : [],
        ...(typeof item.subtitle === 'string' && item.subtitle.trim() !== '' ? { subtitle: item.subtitle } : {}),
        title: String(item.title)
      }))
  }
}
