/* eslint-disable max-lines -- Team access group REST handlers share scoped parsing and policy checks. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  defaultTeamAccessGroupIds,
  normalizeRelayTeamAccessGroups,
  teamAccessGroupIdForRole
} from '../access-groups.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { isRelayPermission } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayAccessGroup, RelayServerArgs, RelayStore, RelayTeam } from '../types.js'
import { isRecord, now } from '../utils.js'
import {
  canReadTeam,
  canWriteTeamMembers,
  cleanString,
  serializeTeamAccessGroup,
  serializeTeamAccessGroups
} from './team-route-utils.js'

const cleanStringArray = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value.map(cleanString).filter(item => item !== ''))]
    : []
)

const cleanCapabilities = (value: unknown) => {
  const record = isRecord(value) ? value : {}
  return {
    allow: cleanStringArray(record.allow).filter(isRelayPermission),
    deny: cleanStringArray(record.deny).filter(isRelayPermission)
  }
}

const cleanLocalizedDescriptions = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const localizedDescriptions: Record<string, string> = {}
  for (const [rawLocale, rawDescription] of Object.entries(value)) {
    const locale = cleanString(rawLocale)
    const description = cleanString(rawDescription)
    if (locale !== '' && description !== '') localizedDescriptions[locale] = description
  }
  return Object.keys(localizedDescriptions).length === 0 ? undefined : localizedDescriptions
}

const cleanQuotaValue = (value: unknown) => {
  if (value == null || value === '') return { ok: true as const, value: null }
  const count = Number(value)
  return Number.isFinite(count) && count >= 0
    ? { ok: true as const, value: Math.trunc(count) }
    : { error: 'Quota values must be non-negative numbers or null.', ok: false as const }
}

const cleanQuotas = (value: unknown) => {
  if (!isRecord(value)) return { ok: true as const, value: {} as Record<string, number | null> }
  const quotas: Record<string, number | null> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (cleanString(key) === '') continue
    const quota = cleanQuotaValue(rawValue)
    if (!quota.ok) return quota
    quotas[key] = quota.value
  }
  return { ok: true as const, value: quotas }
}

const teamGroups = (team: RelayTeam) => {
  team.accessGroups = normalizeRelayTeamAccessGroups(team.accessGroups)
  return team.accessGroups
}

const wouldCreateCycle = (groups: RelayAccessGroup[], groupId: string, parentGroupId: string | undefined) => {
  const groupsById = new Map(groups.map(group => [group.id, group]))
  let currentId = parentGroupId
  const visited = new Set<string>()
  while (currentId != null && currentId !== '') {
    if (currentId === groupId || visited.has(currentId)) return true
    visited.add(currentId)
    currentId = groupsById.get(currentId)?.parentGroupId
  }
  return false
}

const validateParent = (
  groups: RelayAccessGroup[],
  groupId: string,
  parentGroupId: string | undefined
) => {
  if (parentGroupId == null || parentGroupId === '') return { ok: true as const }
  const parent = groups.find(group => group.id === parentGroupId)
  if (parent == null) return { error: 'Parent group not found.', ok: false as const }
  if (parent.scope !== 'team') return { error: 'Parent group must use team scope.', ok: false as const }
  if (parent.builtIn === true) return { error: 'Built-in access groups cannot be inherited.', ok: false as const }
  if (wouldCreateCycle(groups, groupId, parentGroupId)) {
    return { error: 'Access group inheritance cannot create a cycle.', ok: false as const }
  }
  return { ok: true as const }
}

const teamGroupHasMembers = (store: RelayStore, team: RelayTeam, groupId: string) => (
  store.teamMembers.some(member =>
    member.teamId === team.id && (member.groupIds ?? defaultTeamAccessGroupIds(member.role)).includes(groupId)
  ) ||
  (store.teamInvitations ?? []).some(invitation =>
    invitation.teamId === team.id &&
    invitation.status === 'pending' &&
    (invitation.groupIds ?? defaultTeamAccessGroupIds(invitation.role)).includes(groupId)
  )
)

export const listTeamAccessGroups = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canReadTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  sendJson(res, 200, { groups: serializeTeamAccessGroups(store, team) }, args.allowOrigin)
}

export const createTeamAccessGroup = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  const rawScope = cleanString(body.scope)
  if (rawScope !== '' && rawScope !== 'team') {
    sendJson(res, 400, { error: 'Team access groups can only use "team" scope.' }, args.allowOrigin)
    return
  }
  const name = cleanString(body.name)
  if (name === '') {
    sendJson(res, 400, { error: 'Access group name is required.' }, args.allowOrigin)
    return
  }
  const groups = teamGroups(team)
  const id = cleanString(body.id) || `team:custom:${randomUUID()}`
  if (groups.some(group => group.id === id)) {
    sendJson(res, 409, { error: 'Access group already exists.' }, args.allowOrigin)
    return
  }
  const parentGroupId = cleanString(body.parentGroupId) || undefined
  const parent = validateParent(groups, id, parentGroupId)
  if (!parent.ok) {
    sendJson(res, 400, { error: parent.error }, args.allowOrigin)
    return
  }
  const quotas = cleanQuotas(body.quotas)
  if (!quotas.ok) {
    sendJson(res, 400, { error: quotas.error }, args.allowOrigin)
    return
  }
  const group: RelayAccessGroup = {
    id,
    scope: 'team',
    name,
    description: cleanString(body.description) || undefined,
    localizedDescriptions: cleanLocalizedDescriptions(body.localizedDescriptions),
    parentGroupId,
    capabilities: cleanCapabilities(body.capabilities),
    quotas: quotas.value,
    createdAt: now()
  }
  groups.push(group)
  team.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, { group: serializeTeamAccessGroup(store, team, group) }, args.allowOrigin)
}

export const updateTeamAccessGroup = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam,
  groupId: string
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const groups = teamGroups(team)
  const group = groups.find(item => item.id === groupId)
  if (group == null) {
    sendJson(res, 404, { error: 'Access group not found.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = cleanString(body.name)
    if (name === '') {
      sendJson(res, 400, { error: 'Access group name is required.' }, args.allowOrigin)
      return
    }
    group.name = name
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    group.description = cleanString(body.description) || undefined
  }
  if (Object.prototype.hasOwnProperty.call(body, 'localizedDescriptions')) {
    group.localizedDescriptions = cleanLocalizedDescriptions(body.localizedDescriptions)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'parentGroupId')) {
    const parentGroupId = cleanString(body.parentGroupId) || undefined
    const parent = validateParent(groups, group.id, parentGroupId)
    if (!parent.ok) {
      sendJson(res, 400, { error: parent.error }, args.allowOrigin)
      return
    }
    group.parentGroupId = parentGroupId
  }
  if (Object.prototype.hasOwnProperty.call(body, 'capabilities')) {
    group.capabilities = cleanCapabilities(body.capabilities)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'quotas')) {
    const quotas = cleanQuotas(body.quotas)
    if (!quotas.ok) {
      sendJson(res, 400, { error: quotas.error }, args.allowOrigin)
      return
    }
    group.quotas = quotas.value
  }
  if (Object.prototype.hasOwnProperty.call(body, 'disabled')) {
    if (body.disabled === true && group.id === teamAccessGroupIdForRole('owner')) {
      sendJson(res, 403, { error: 'Team owner group cannot be disabled.' }, args.allowOrigin)
      return
    }
    group.disabledAt = body.disabled === true ? group.disabledAt ?? now() : undefined
  }
  group.updatedAt = now()
  team.updatedAt = group.updatedAt
  await storeRepository.write(store)
  sendJson(res, 200, { group: serializeTeamAccessGroup(store, team, group) }, args.allowOrigin)
}

export const deleteTeamAccessGroup = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam,
  groupId: string
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const groups = teamGroups(team)
  const group = groups.find(item => item.id === groupId)
  if (group == null) {
    sendJson(res, 404, { error: 'Access group not found.' }, args.allowOrigin)
    return
  }
  if (group.id === teamAccessGroupIdForRole('owner')) {
    sendJson(res, 403, { error: 'Team owner group cannot be deleted.' }, args.allowOrigin)
    return
  }
  if (group.builtIn === true) {
    sendJson(res, 403, { error: 'Built-in access groups cannot be deleted.' }, args.allowOrigin)
    return
  }
  if (teamGroupHasMembers(store, team, group.id)) {
    sendJson(res, 409, { error: 'Access group still has members or pending invitations.' }, args.allowOrigin)
    return
  }
  if (groups.some(item => item.parentGroupId === group.id)) {
    sendJson(res, 409, { error: 'Access group is still used as a parent.' }, args.allowOrigin)
    return
  }
  team.accessGroups = groups.filter(item => item.id !== group.id)
  team.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, { deleted: true, group: serializeTeamAccessGroup(store, team, group) }, args.allowOrigin)
}
