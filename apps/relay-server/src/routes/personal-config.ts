import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { filterRelayConfigPatch, normalizeRelayConfigSafeFields } from '../config-snapshot-normalize.js'
import { deviceTokenMatches } from '../devices/private-metadata.js'
import { getBearerToken, readRequestBody, sendJson } from '../http.js'
import { devicePrincipalForDevice, hasRelayPermission, relayPermissions } from '../permissions/index.js'
import {
  mergeRelayPersonalConfigPatches,
  normalizeRelayPersonalDocumentSnapshot,
  upsertRelayPersonalConfigSnapshot
} from '../personal-config.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type {
  RelayConfigPatch,
  RelayDevice,
  RelayPersonalConfigSnapshot,
  RelayServerArgs,
  RelayStore,
  RelayUser
} from '../types.js'
import { isRecord } from '../utils.js'

const findDeviceByToken = (store: RelayStore, token: string) => (
  token === '' ? undefined : store.devices.find(device => deviceTokenMatches(device, token))
)

const findActiveUser = (store: RelayStore, userId: string | undefined): RelayUser | undefined => {
  if (userId == null || userId === '') return undefined
  const user = store.users.find(item => item.id === userId)
  return user == null || user.disabledAt != null ? undefined : user
}

const resolveDeviceAuth = (req: IncomingMessage, store: RelayStore) => {
  const device = findDeviceByToken(store, getBearerToken(req))
  if (device == null) return undefined
  const principal = devicePrincipalForDevice(device)
  if (!hasRelayPermission(principal, relayPermissions.relayConfigSnapshotRead)) {
    return { denied: true as const, device }
  }
  return {
    device,
    user: findActiveUser(store, device.userId)
  }
}

const resolveAccountAuth = (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore
) => {
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) return undefined
  if (auth.kind === 'admin-token') return { denied: true as const }
  if (!authContextHasPermission(auth, relayPermissions.relayConfigSnapshotRead)) {
    return { denied: true as const }
  }
  return {
    user: auth.user
  }
}

const resolvePersonalConfigAuth = (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore
): { device?: RelayDevice; user: RelayUser } | { denied: true } | undefined => {
  const deviceResult = resolveDeviceAuth(req, store)
  if (deviceResult?.denied === true) return { denied: true }
  if (deviceResult != null) {
    return deviceResult.user == null ? { denied: true } : {
      device: deviceResult.device,
      user: deviceResult.user
    }
  }

  const accountResult = resolveAccountAuth(req, args, store)
  if (accountResult?.denied === true) return { denied: true }
  return accountResult
}

const serializePersonalConfigSnapshot = (snapshot: RelayPersonalConfigSnapshot | undefined) => (
  snapshot == null
    ? null
    : {
      allowedFields: snapshot.allowedFields,
      ...(snapshot.configPatch == null ? {} : { configPatch: snapshot.configPatch }),
      ...(snapshot.documents == null ? {} : { documents: snapshot.documents }),
      hash: snapshot.hash,
      sourceDeviceId: snapshot.sourceDeviceId,
      updatedAt: snapshot.updatedAt,
      userId: snapshot.userId,
      version: snapshot.version
    }
)

const pickPatchPayload = (body: Record<string, unknown>) => {
  if (isRecord(body.configPatch)) return body.configPatch
  if (isRecord(body.config)) return body.config
  if (isRecord(body.patch)) return body.patch
  return undefined
}

const pickDocumentsPayload = (body: Record<string, unknown>) => {
  if (isRecord(body.documents)) return body.documents
  if (isRecord(body.documentSnapshot)) return body.documentSnapshot
  return undefined
}

const findInvalidRequestedDefaultAccount = (
  partialPatch: RelayConfigPatch | undefined,
  mergedPatch: RelayConfigPatch | undefined
) => {
  if (!isRecord(partialPatch?.adapters)) return undefined
  for (const [adapterKey, adapter] of Object.entries(partialPatch.adapters)) {
    if (!isRecord(adapter) || typeof adapter.defaultAccount !== 'string') continue
    const requestedDefault = adapter.defaultAccount.trim()
    if (requestedDefault === '') continue
    const mergedAdapter = isRecord(mergedPatch?.adapters?.[adapterKey])
      ? mergedPatch.adapters[adapterKey]
      : undefined
    const mergedAccounts = isRecord(mergedAdapter?.accounts) ? mergedAdapter.accounts : undefined
    if (mergedAdapter?.defaultAccount !== requestedDefault || mergedAccounts?.[requestedDefault] == null) {
      return `${adapterKey}.${requestedDefault}`
    }
  }
  return undefined
}

export const handleRelayPersonalConfigRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname !== '/api/relay/config/global') return false

  const auth = resolvePersonalConfigAuth(req, args, store)
  if (auth != null && 'denied' in auth) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }

  const existing = store.personalConfigSnapshots?.find(item => item.userId === auth.user.id)
  if (req.method === 'GET') {
    sendJson(res, 200, { personalConfigSnapshot: serializePersonalConfigSnapshot(existing) }, args.allowOrigin)
    return true
  }
  if (req.method !== 'PUT' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  const body = await readRequestBody(req)
  const baseHash = typeof body.baseHash === 'string' && body.baseHash.trim() !== '' ? body.baseHash.trim() : undefined
  if (existing != null && baseHash != null && baseHash !== existing.hash && body.force !== true) {
    sendJson(res, 409, {
      error: 'Relay personal config has changed on the server.',
      personalConfigSnapshot: serializePersonalConfigSnapshot(existing)
    }, args.allowOrigin)
    return true
  }

  const allowedFields = normalizeRelayConfigSafeFields(body.allowedFields)
  const rawConfigPatch = pickPatchPayload(body)
  const rawDocuments = pickDocumentsPayload(body)
  const partialConfigPatch = rawConfigPatch == null
    ? undefined
    : filterRelayConfigPatch(rawConfigPatch, allowedFields, {
      allowDanglingDefaultAccount: true
    })
  const mergedAllowedFields = normalizeRelayConfigSafeFields([
    ...(existing?.allowedFields ?? []),
    ...allowedFields
  ])
  const mergedConfigPatch = rawConfigPatch == null
    ? existing?.configPatch
    : mergeRelayPersonalConfigPatches(existing?.configPatch ?? {}, partialConfigPatch)
  const configPatch = rawConfigPatch == null
    ? existing?.configPatch
    : filterRelayConfigPatch(mergedConfigPatch, mergedAllowedFields)
  const documents = rawDocuments == null
    ? existing?.documents
    : normalizeRelayPersonalDocumentSnapshot(rawDocuments)

  if (rawConfigPatch == null && rawDocuments == null) {
    sendJson(res, 400, { error: 'A safe config patch or encrypted document snapshot is required.' }, args.allowOrigin)
    return true
  }
  if (rawConfigPatch != null && partialConfigPatch == null) {
    sendJson(res, 400, { error: 'A safe config patch is required.' }, args.allowOrigin)
    return true
  }
  const invalidRequestedDefault = findInvalidRequestedDefaultAccount(partialConfigPatch, configPatch)
  if (invalidRequestedDefault != null) {
    sendJson(res, 400, {
      error: `Default adapter account "${invalidRequestedDefault}" is missing or deleted.`
    }, args.allowOrigin)
    return true
  }
  if (rawDocuments != null && documents == null) {
    sendJson(res, 400, { error: 'A valid encrypted document snapshot is required.' }, args.allowOrigin)
    return true
  }
  if (configPatch == null && documents == null) {
    sendJson(res, 400, { error: 'A safe config patch or encrypted document snapshot is required.' }, args.allowOrigin)
    return true
  }

  const snapshot = upsertRelayPersonalConfigSnapshot(store, {
    allowedFields: rawConfigPatch == null && existing != null
      ? existing.allowedFields
      : mergedAllowedFields,
    configPatch,
    documents,
    sourceDeviceId: auth.device?.id,
    userId: auth.user.id
  })
  await storeRepository.write(store)
  sendJson(res, 200, { personalConfigSnapshot: serializePersonalConfigSnapshot(snapshot) }, args.allowOrigin)
  return true
}
