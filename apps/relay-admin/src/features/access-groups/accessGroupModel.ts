import type {
  CreateAccessGroupInput,
  RelayAdminAccessGroup,
  RelayAdminAccessGroupScope,
  RelayAdminRole
} from '../../shared/model/adminTypes'
import type { RelayAdminTeamMemberRole } from '../teams/teamTypes'

export const builtinPlatformGroupIdForRole = (role: RelayAdminRole) => `platform:${role}`

export const builtinTeamGroupIdForRole = (role: RelayAdminTeamMemberRole) => `team:${role}`

export const defaultPlatformGroupIds = (role: RelayAdminRole = 'member') => [builtinPlatformGroupIdForRole(role)]

export const defaultTeamGroupIds = (role: RelayAdminTeamMemberRole = 'member') => [builtinTeamGroupIdForRole(role)]

export const accessGroupsForScope = (
  groups: RelayAdminAccessGroup[],
  scope: RelayAdminAccessGroupScope
) => groups.filter(group => group.scope === scope)

export const accessGroupName = (groups: RelayAdminAccessGroup[], groupId: string) =>
  groups.find(group => group.id === groupId)?.name ?? groupId

export const accessGroupOptions = (
  groups: RelayAdminAccessGroup[],
  scope: RelayAdminAccessGroupScope
) =>
  accessGroupsForScope(groups, scope).map(group => ({
    label: `${group.name} · ${group.id}`,
    value: group.id
  }))

export const roleFromPlatformGroupIds = (groupIds: string[], fallback: RelayAdminRole): RelayAdminRole => {
  if (groupIds.includes('platform:owner')) return 'owner'
  if (groupIds.includes('platform:admin')) return 'admin'
  if (groupIds.includes('platform:viewer')) return 'viewer'
  return fallback
}

export const roleFromTeamGroupIds = (
  groupIds: string[],
  fallback: RelayAdminTeamMemberRole
): RelayAdminTeamMemberRole => {
  if (groupIds.includes('team:owner')) return 'owner'
  if (groupIds.includes('team:admin')) return 'admin'
  if (groupIds.includes('team:editor')) return 'editor'
  if (groupIds.includes('team:viewer')) return 'viewer'
  return fallback
}

const ownerGroupIds = new Set(['platform:owner', 'team:owner'])

const localeCandidates = () => {
  if (typeof navigator === 'undefined') return ['zh-Hans', 'en']
  return [
    ...navigator.languages,
    navigator.language,
    'zh-Hans',
    'zh-CN',
    'zh',
    'en'
  ].filter(Boolean)
}

const preferredLocalizedText = (
  textMap: Record<string, string>,
  fallback: string | null | undefined
) => {
  for (const locale of localeCandidates()) {
    const normalizedLocale = locale.toLowerCase()
    const matchingKey = Object.keys(textMap).find(key => key.toLowerCase() === normalizedLocale)
    if (matchingKey != null) return textMap[matchingKey]
    if (normalizedLocale === 'zh' || normalizedLocale === 'zh-cn' || normalizedLocale === 'zh-hans') {
      const zhHans = textMap['zh-Hans'] ?? textMap['zh-CN'] ?? textMap.zh
      if (zhHans != null) return zhHans
    }
  }
  return fallback
}

const cleanLocalizedTextMap = (value: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(value)
      .map(([locale, text]) => [locale.trim(), text.trim()])
      .filter(([locale, text]) => locale !== '' && text !== '')
  )

const appendCopySuffix = (value: string, locale = 'zh-Hans') => {
  const text = value.trim()
  if (text === '') return text
  const normalizedLocale = locale.toLowerCase()
  const suffix = normalizedLocale === 'zh' || normalizedLocale === 'zh-cn' || normalizedLocale === 'zh-hans'
    ? '副本'
    : 'Copy'
  return `${text} ${suffix}`
}

export const localizedAccessGroupName = (group: RelayAdminAccessGroup) => (
  preferredLocalizedText(group.localizedNames, group.name) ?? group.name
)

export const localizedAccessGroupDescription = (group: RelayAdminAccessGroup) => (
  preferredLocalizedText(group.localizedDescriptions, group.description)
)

export const isOwnerAccessGroup = (group: RelayAdminAccessGroup) => ownerGroupIds.has(group.id)

export const accessGroupDisableBlockReason = (
  group: RelayAdminAccessGroup,
  groupNoun: '成员组' | '用户组'
) => isOwnerAccessGroup(group) ? `${groupNoun}所有者不能禁用` : undefined

export const accessGroupDeleteBlockReason = (
  group: RelayAdminAccessGroup,
  groupNoun: '成员组' | '用户组'
) => {
  if (isOwnerAccessGroup(group)) return `${groupNoun}所有者不能删除`
  if (group.builtIn) return `内置${groupNoun}不能删除`
  if (group.memberCount > 0) return `仍有成员使用，不能删除`
  return undefined
}

export const createAccessGroupCopyInput = (group: RelayAdminAccessGroup): CreateAccessGroupInput => {
  const fallbackName = localizedAccessGroupName(group).trim() || group.name
  const localizedNames = cleanLocalizedTextMap(
    Object.fromEntries(
      Object.entries(group.localizedNames)
        .map(([locale, name]) => [locale, appendCopySuffix(name, locale)])
    )
  )

  return {
    capabilities: {
      allow: [...group.capabilities.allow],
      deny: [...group.capabilities.deny]
    },
    description: group.description ?? undefined,
    localizedDescriptions: cleanLocalizedTextMap(group.localizedDescriptions),
    localizedNames,
    name: appendCopySuffix(fallbackName),
    parentGroupId: group.parentGroupId,
    quotas: { ...group.quotas },
    scope: group.scope
  }
}
