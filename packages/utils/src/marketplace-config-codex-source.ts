import type { CodexMarketplaceSource } from '@oneworks/types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const normalizeCodexAppServerMarketplaceSource = (
  value: unknown,
  path: string
): CodexMarketplaceSource | undefined => {
  if (!isRecord(value) || value.source !== 'app-server') return undefined
  const marketplace = normalizeNonEmptyString(value.marketplace)
  if (marketplace == null) {
    throw new TypeError(
      `Invalid marketplace source at ${path}. "marketplace" must be a non-empty string.`
    )
  }
  return {
    source: 'app-server',
    marketplace,
    ...(typeof value.includeRemoteCatalog === 'boolean'
      ? { includeRemoteCatalog: value.includeRemoteCatalog }
      : {})
  }
}
