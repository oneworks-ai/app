import { requestJson } from '../../shared/api/requestJson'
import type {
  CreateAccessGroupInput,
  RelayAdminAccessGroup,
  UpdateAccessGroupInput
} from '../../shared/model/adminTypes'

const normalizeLocalizedDescriptions = (value: unknown) => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const localizedDescriptions: Record<string, string> = {}
  for (const [rawLocale, rawDescription] of Object.entries(value)) {
    const locale = rawLocale.trim()
    const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
    if (locale !== '' && description !== '') localizedDescriptions[locale] = description
  }
  return localizedDescriptions
}

export const normalizeRelayAdminAccessGroup = (group: RelayAdminAccessGroup): RelayAdminAccessGroup => ({
  ...group,
  capabilities: {
    allow: Array.isArray(group.capabilities?.allow) ? group.capabilities.allow : [],
    deny: Array.isArray(group.capabilities?.deny) ? group.capabilities.deny : []
  },
  description: typeof group.description === 'string' && group.description.trim() !== ''
    ? group.description.trim()
    : null,
  disabled: group.disabled === true || group.disabledAt != null,
  disabledAt: group.disabledAt ?? null,
  localizedDescriptions: normalizeLocalizedDescriptions(group.localizedDescriptions),
  memberCount: Number.isFinite(Number(group.memberCount)) ? Math.max(0, Math.trunc(Number(group.memberCount))) : 0,
  parentGroupId: typeof group.parentGroupId === 'string' && group.parentGroupId.trim() !== ''
    ? group.parentGroupId.trim()
    : null,
  quotas: group.quotas ?? {},
  updatedAt: group.updatedAt ?? null
})

export const fetchRelayAdminAccessGroups = async (token: string) =>
  await requestJson<{ groups: RelayAdminAccessGroup[] }>(token, '/api/admin/access-groups')
    .then(body => ({ groups: body.groups.map(normalizeRelayAdminAccessGroup) }))

export const createRelayAdminAccessGroup = async (token: string, input: CreateAccessGroupInput) =>
  await requestJson<{ group: RelayAdminAccessGroup }>(token, '/api/admin/access-groups', {
    body: JSON.stringify(input),
    method: 'POST'
  }).then(body => ({ group: normalizeRelayAdminAccessGroup(body.group) }))

export const updateRelayAdminAccessGroup = async (token: string, input: UpdateAccessGroupInput) =>
  await requestJson<{ group: RelayAdminAccessGroup }>(token, '/api/admin/access-groups', {
    body: JSON.stringify(input),
    method: 'PATCH'
  }).then(body => ({ group: normalizeRelayAdminAccessGroup(body.group) }))

export const deleteRelayAdminAccessGroup = async (token: string, groupId: string) =>
  await requestJson<{ deleted: boolean; group: RelayAdminAccessGroup }>(
    token,
    `/api/admin/access-groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' }
  ).then(body => ({ ...body, group: normalizeRelayAdminAccessGroup(body.group) }))
