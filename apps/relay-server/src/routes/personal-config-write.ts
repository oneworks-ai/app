import { filterRelayConfigPatch, normalizeRelayConfigSafeFields } from '../config-snapshot-normalize.js'
import { mergeRelayPersonalConfigPatches, normalizeRelayPersonalDocumentSnapshot } from '../personal-config.js'
import type {
  RelayConfigPatch,
  RelayConfigSafeField,
  RelayPersonalConfigSnapshot,
  RelayPersonalDocumentSnapshot
} from '../types.js'
import { isRecord } from '../utils.js'

export const serializePersonalConfigSnapshot = (snapshot: RelayPersonalConfigSnapshot | undefined) => (
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

interface PreparedPersonalConfigWrite {
  allowedFields: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  documents?: RelayPersonalDocumentSnapshot
}

export const preparePersonalConfigWrite = (
  body: Record<string, unknown>,
  existing: RelayPersonalConfigSnapshot | undefined
): { error: string } | { value: PreparedPersonalConfigWrite } => {
  const allowedFields = normalizeRelayConfigSafeFields(body.allowedFields)
  const rawConfigPatch = pickPatchPayload(body)
  const rawDocuments = pickDocumentsPayload(body)
  if (rawConfigPatch == null && rawDocuments == null) {
    return { error: 'A safe config patch or encrypted document snapshot is required.' }
  }

  const partialConfigPatch = rawConfigPatch == null
    ? undefined
    : filterRelayConfigPatch(rawConfigPatch, allowedFields, { allowDanglingDefaultAccount: true })
  if (rawConfigPatch != null && partialConfigPatch == null) {
    return { error: 'A safe config patch is required.' }
  }
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
  const invalidDefault = findInvalidRequestedDefaultAccount(partialConfigPatch, configPatch)
  if (invalidDefault != null) {
    return { error: `Default adapter account "${invalidDefault}" is missing or deleted.` }
  }
  const documents = rawDocuments == null
    ? existing?.documents
    : normalizeRelayPersonalDocumentSnapshot(rawDocuments)
  if (rawDocuments != null && documents == null) {
    return { error: 'A valid encrypted document snapshot is required.' }
  }
  if (configPatch == null && documents == null) {
    return { error: 'A safe config patch or encrypted document snapshot is required.' }
  }
  return {
    value: {
      allowedFields: rawConfigPatch == null && existing != null
        ? existing.allowedFields
        : mergedAllowedFields,
      configPatch,
      documents
    }
  }
}
