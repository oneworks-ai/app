import type { Config } from './config'

const ADAPTER_SCOPE = '@oneworks'
const ADAPTER_PREFIX = 'adapter-'

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export interface AdapterRuntimeTarget {
  instanceKey: string
  loadSpecifier: string
  runtimeAdapter: string
  packageId?: string
}

export interface ResolveAdapterRuntimeTargetOptions {
  config?: Config
  cwd?: string
}

export interface AdapterPackageLoadOptions {
  cwd?: string
}

export const normalizeAdapterPackageId = (type: string) => {
  const trimmed = type.trim()
  if (trimmed.startsWith('@')) return trimmed

  const hasAdapterPrefix = trimmed.startsWith(ADAPTER_PREFIX)
  const adapterId = hasAdapterPrefix ? trimmed.slice(ADAPTER_PREFIX.length) : trimmed
  const normalizedAdapterId = adapterId === 'claude' ? 'claude-code' : adapterId

  return hasAdapterPrefix ? `${ADAPTER_PREFIX}${normalizedAdapterId}` : normalizedAdapterId
}

export const resolveAdapterKeyFromPackageName = (packageName: string) => {
  const normalized = normalizeNonEmptyString(packageName)
  if (normalized == null) return undefined
  if (normalized.startsWith('@oneworks/adapter-')) {
    return normalizeAdapterPackageId(normalized.slice('@oneworks/'.length)).replace(/^adapter-/, '')
  }
  if (normalized.startsWith(ADAPTER_PREFIX)) {
    return normalizeAdapterPackageId(normalized).replace(/^adapter-/, '')
  }
  if (!normalized.startsWith('@')) {
    return normalizeAdapterPackageId(normalized).replace(/^adapter-/, '')
  }
  return normalized
}

export const resolveAdapterPackageName = (type: string) => {
  const normalizedType = normalizeAdapterPackageId(type)
  if (normalizedType.startsWith('@')) return normalizedType
  return normalizedType.startsWith(ADAPTER_PREFIX)
    ? `${ADAPTER_SCOPE}/${normalizedType}`
    : `${ADAPTER_SCOPE}/${ADAPTER_PREFIX}${normalizedType}`
}
