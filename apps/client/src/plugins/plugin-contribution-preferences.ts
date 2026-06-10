type ContributionRecord = Record<string, unknown>

const CONTRIBUTION_GROUP_STORAGE_PREFIX = 'oneworks_plugin_disabled_contribution_groups:'
const CONTRIBUTION_ITEM_STORAGE_PREFIX = 'oneworks_plugin_disabled_contribution_items:'

const isRecord = (value: unknown): value is ContributionRecord => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readStringList = (storageKey: string) => {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const writeStringList = (storageKey: string, values: string[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(values))
  } catch {
    // Local contribution preferences are best-effort.
  }
}

const getGroupStorageKey = (scope: string) => `${CONTRIBUTION_GROUP_STORAGE_PREFIX}${scope}`
const getItemStorageKey = (scope: string) => `${CONTRIBUTION_ITEM_STORAGE_PREFIX}${scope}`

const normalizeContributionIdentity = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const buildPluginContributionItemPreferenceId = (groupId: string, item: unknown, index: number) => {
  const record = isRecord(item) ? item : undefined
  const identity = record == null
    ? undefined
    : normalizeContributionIdentity(record.id) ??
      normalizeContributionIdentity(record.command) ??
      normalizeContributionIdentity(record.route) ??
      normalizeContributionIdentity(record.href) ??
      normalizeContributionIdentity(record.tab) ??
      normalizeContributionIdentity(record.clientView) ??
      normalizeContributionIdentity(record.viewId) ??
      normalizeContributionIdentity(record.title)
  return `${groupId}:${identity ?? index}`
}

export const readDisabledPluginContributionGroups = (scope: string) => readStringList(getGroupStorageKey(scope))

export const writeDisabledPluginContributionGroups = (scope: string, groups: string[]) => {
  writeStringList(getGroupStorageKey(scope), groups)
}

export const readDisabledPluginContributionItems = (scope: string) => readStringList(getItemStorageKey(scope))

export const writeDisabledPluginContributionItems = (scope: string, items: string[]) => {
  writeStringList(getItemStorageKey(scope), items)
}

export const isPluginContributionGroupDisabled = (scope: string, groupId: string) => (
  readDisabledPluginContributionGroups(scope).includes(groupId)
)

export const isPluginContributionItemDisabled = (
  scope: string,
  groupId: string,
  item: unknown,
  index: number
) => readDisabledPluginContributionItems(scope).includes(buildPluginContributionItemPreferenceId(groupId, item, index))
