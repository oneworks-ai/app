/* eslint-disable max-lines -- Platform access group REST handlers share parsing and response helpers. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { platformAccessGroupIdForRole } from '../access-groups.js'
import { requireAuthPermission } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { isRelayPermission, relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayAccessGroup, RelayAccessGroupScope, RelayServerArgs, RelayStore } from '../types.js'
import { isRecord, now } from '../utils.js'

const adminUnauthorizedError = 'Admin token required.'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const cleanScope = (value: unknown): RelayAccessGroupScope | undefined => (
  value === 'platform' ? value : undefined
)

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

const accessGroupMemberCount = (store: RelayStore, group: RelayAccessGroup) =>
  store.users.filter(user => user.groupIds?.includes(group.id)).length

const serializeAccessGroup = (store: RelayStore, group: RelayAccessGroup) => ({
  id: group.id,
  scope: group.scope,
  name: group.name,
  description: group.description ?? null,
  localizedDescriptions: group.localizedDescriptions ?? {},
  builtIn: group.builtIn === true,
  parentGroupId: group.parentGroupId ?? null,
  disabled: group.disabledAt != null,
  disabledAt: group.disabledAt ?? null,
  capabilities: {
    allow: group.capabilities.allow ?? [],
    deny: group.capabilities.deny ?? []
  },
  quotas: group.quotas ?? {},
  memberCount: accessGroupMemberCount(store, group),
  createdAt: group.createdAt,
  updatedAt: group.updatedAt ?? null
})

const pathId = (url: URL, prefix: string) => {
  if (url.pathname === prefix) return undefined
  const escaped = url.pathname.slice(prefix.length + 1)
  return escaped === '' ? undefined : decodeURIComponent(escaped)
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
  store: RelayStore,
  groupId: string,
  scope: RelayAccessGroupScope,
  parentGroupId: string | undefined
) => {
  if (parentGroupId == null || parentGroupId === '') return { ok: true as const }
  const parent = store.accessGroups.find(group => group.id === parentGroupId)
  if (parent == null) return { error: 'Parent group not found.', ok: false as const }
  if (parent.scope !== scope) return { error: 'Parent group must use the same scope.', ok: false as const }
  if (parent.builtIn === true) return { error: 'Built-in access groups cannot be inherited.', ok: false as const }
  if (wouldCreateCycle(store.accessGroups, groupId, parentGroupId)) {
    return { error: 'Access group inheritance cannot create a cycle.', ok: false as const }
  }
  return { ok: true as const }
}

export const handleAdminAccessGroups = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
) => {
  const requiredPermission = req.method === 'GET'
    ? relayPermissions.adminAccessGroupsRead
    : relayPermissions.adminAccessGroupsWrite
  if (
    requireAuthPermission(req, res, args, store, requiredPermission, { unauthorizedError: adminUnauthorizedError }) ==
      null
  ) {
    return
  }

  const groupId = pathId(url, '/api/admin/access-groups')
  if (req.method === 'GET' && groupId == null) {
    sendJson(
      res,
      200,
      { groups: store.accessGroups.map(group => serializeAccessGroup(store, group)) },
      args.allowOrigin
    )
    return
  }

  if (req.method === 'POST' && groupId == null) {
    const body = await readRequestBody(req)
    const rawScope = cleanString(body.scope)
    const scope = rawScope === '' ? 'platform' : cleanScope(body.scope)
    const name = cleanString(body.name)
    if (scope == null) {
      sendJson(res, 400, { error: 'Platform access groups can only use "platform" scope.' }, args.allowOrigin)
      return
    }
    if (name === '') {
      sendJson(res, 400, { error: 'Access group name is required.' }, args.allowOrigin)
      return
    }
    const id = cleanString(body.id) || `${scope}:custom:${randomUUID()}`
    if (store.accessGroups.some(group => group.id === id)) {
      sendJson(res, 409, { error: 'Access group already exists.' }, args.allowOrigin)
      return
    }
    const parentGroupId = cleanString(body.parentGroupId) || undefined
    const parent = validateParent(store, id, scope, parentGroupId)
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
      scope,
      name,
      description: cleanString(body.description) || undefined,
      localizedDescriptions: cleanLocalizedDescriptions(body.localizedDescriptions),
      parentGroupId,
      capabilities: cleanCapabilities(body.capabilities),
      quotas: quotas.value,
      createdAt: now()
    }
    store.accessGroups.push(group)
    await storeRepository.write(store)
    sendJson(res, 200, { group: serializeAccessGroup(store, group) }, args.allowOrigin)
    return
  }

  if (req.method === 'PATCH') {
    const body = await readRequestBody(req)
    const id = groupId ?? cleanString(body.id)
    const group = store.accessGroups.find(item => item.id === id)
    if (group == null) {
      sendJson(res, 404, { error: 'Access group not found.' }, args.allowOrigin)
      return
    }
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
      const parent = validateParent(store, group.id, group.scope, parentGroupId)
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
      if (body.disabled === true && group.id === platformAccessGroupIdForRole('owner')) {
        sendJson(res, 403, { error: 'Platform owner group cannot be disabled.' }, args.allowOrigin)
        return
      }
      group.disabledAt = body.disabled === true ? group.disabledAt ?? now() : undefined
    }
    group.updatedAt = now()
    await storeRepository.write(store)
    sendJson(res, 200, { group: serializeAccessGroup(store, group) }, args.allowOrigin)
    return
  }

  if (req.method === 'DELETE') {
    const id = groupId ?? ''
    const group = store.accessGroups.find(item => item.id === id)
    if (group == null) {
      sendJson(res, 404, { error: 'Access group not found.' }, args.allowOrigin)
      return
    }
    if (group.id === platformAccessGroupIdForRole('owner')) {
      sendJson(res, 403, { error: 'Platform owner group cannot be deleted.' }, args.allowOrigin)
      return
    }
    if (group.builtIn === true) {
      sendJson(res, 403, { error: 'Built-in access groups cannot be deleted.' }, args.allowOrigin)
      return
    }
    if (accessGroupMemberCount(store, group) > 0) {
      sendJson(res, 409, { error: 'Access group still has members.' }, args.allowOrigin)
      return
    }
    if (store.accessGroups.some(item => item.parentGroupId === group.id)) {
      sendJson(res, 409, { error: 'Access group is still used as a parent.' }, args.allowOrigin)
      return
    }
    store.accessGroups = store.accessGroups.filter(item => item.id !== group.id)
    await storeRepository.write(store)
    sendJson(res, 200, { deleted: true, group: serializeAccessGroup(store, group) }, args.allowOrigin)
    return
  }

  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}
