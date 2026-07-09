const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readOptionalText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const readOptionalNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
        ...(readOptionalText(item.badge) == null ? {} : { badge: readOptionalText(item.badge) }),
        ...(readOptionalText(item.description) == null ? {} : { description: readOptionalText(item.description) }),
        ...(readOptionalText(item.groupIcon) == null ? {} : { groupIcon: readOptionalText(item.groupIcon) }),
        ...(readOptionalText(item.groupId) == null ? {} : { groupId: readOptionalText(item.groupId) }),
        ...(readOptionalNumber(item.groupOrder) == null ? {} : { groupOrder: readOptionalNumber(item.groupOrder) }),
        ...(readOptionalText(item.groupTitle) == null ? {} : { groupTitle: readOptionalText(item.groupTitle) }),
        ...(readOptionalText(item.icon) == null ? {} : { icon: readOptionalText(item.icon) }),
        id: String(item.id),
        keywords: Array.isArray(item.keywords)
          ? item.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
          : [],
        ...(readOptionalText(item.sectionIcon) == null ? {} : { sectionIcon: readOptionalText(item.sectionIcon) }),
        ...(readOptionalText(item.sectionId) == null ? {} : { sectionId: readOptionalText(item.sectionId) }),
        ...(readOptionalNumber(item.sectionOrder) == null
          ? {}
          : { sectionOrder: readOptionalNumber(item.sectionOrder) }),
        ...(readOptionalText(item.sectionTitle) == null ? {} : { sectionTitle: readOptionalText(item.sectionTitle) }),
        ...(readOptionalText(item.subtitle) == null ? {} : { subtitle: readOptionalText(item.subtitle) }),
        title: String(item.title)
      }))
  }
}
