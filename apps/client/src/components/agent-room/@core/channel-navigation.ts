import type { ChannelNavigationMode, ChannelNavigationPreferences, ChannelNavigationReference } from '@oneworks/core'

const navigationModes = new Set<ChannelNavigationMode>([
  'appHome',
  'ask',
  'externalWeb',
  'nativeApp',
  'rightPanel'
])

const defaultPreferences: ChannelNavigationPreferences = {
  default: ['rightPanel', 'externalWeb', 'nativeApp', 'appHome', 'ask']
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeModes = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((item): item is ChannelNavigationMode => navigationModes.has(item as ChannelNavigationMode))
    : []
)

const normalizeOverrides = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, modes]) => {
    const normalized = normalizeModes(modes)
    return key.trim() === '' || normalized.length === 0 ? [] : [[key, normalized] as const]
  })
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

export const resolveChannelNavigationPreferences = (value: unknown): ChannelNavigationPreferences => {
  if (!isRecord(value)) return defaultPreferences
  const normalizedDefault = normalizeModes(value.default)
  return {
    default: normalizedDefault.length === 0 ? defaultPreferences.default : normalizedDefault,
    ...(normalizeOverrides(value.accounts) == null ? {} : { accounts: normalizeOverrides(value.accounts) }),
    ...(normalizeOverrides(value.providers) == null ? {} : { providers: normalizeOverrides(value.providers) })
  }
}

export interface AgentRoomChannelNavigationTarget {
  channelKey: string
  channelType: string
  navigation?: ChannelNavigationReference
}

export interface ResolvedChannelNavigationAction {
  mode: ChannelNavigationMode
  url?: string
}

const resolveModeUrl = (
  mode: ChannelNavigationMode,
  navigation: ChannelNavigationReference
): ResolvedChannelNavigationAction | undefined => {
  if (mode === 'rightPanel') {
    const url = navigation.messageWebUrl ?? navigation.conversationWebUrl ?? navigation.appHomeUrl
    return navigation.embeddable === true && url != null ? { mode, url } : undefined
  }
  if (mode === 'externalWeb') {
    const url = navigation.messageWebUrl ?? navigation.conversationWebUrl ?? navigation.appHomeUrl
    return url == null ? undefined : { mode, url }
  }
  if (mode === 'nativeApp') {
    return navigation.nativeAppUrl == null ? undefined : { mode, url: navigation.nativeAppUrl }
  }
  if (mode === 'appHome') {
    return navigation.appHomeUrl == null ? undefined : { mode, url: navigation.appHomeUrl }
  }
  return { mode: 'ask' }
}

export const listChannelNavigationActions = (
  target: AgentRoomChannelNavigationTarget,
  preferences: ChannelNavigationPreferences
) => {
  const navigation = target.navigation
  if (navigation == null) return []
  const modes = preferences.accounts?.[target.channelKey] ??
    preferences.providers?.[target.channelType] ??
    preferences.default
  return modes.flatMap(mode => {
    const action = resolveModeUrl(mode, navigation)
    return action == null ? [] : [action]
  })
}

export const getDefaultChannelNavigationPreferences = () => defaultPreferences
