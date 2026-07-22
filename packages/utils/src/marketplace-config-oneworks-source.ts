import type { OneWorksMarketplaceConfigEntry } from '@oneworks/types'

import { normalizeMarketplaceDeclaredPlugins } from './marketplace-config-declared-plugin'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const normalizeOneWorksMarketplaceEntry = (
  value: Record<string, unknown>,
  path: string
): OneWorksMarketplaceConfigEntry => {
  const entry: OneWorksMarketplaceConfigEntry = {
    type: 'oneworks',
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.syncOnRun === 'boolean' ? { syncOnRun: value.syncOnRun } : {})
  }
  if (value.plugins != null) {
    entry.plugins = normalizeMarketplaceDeclaredPlugins(value.plugins, `${path}.plugins`)
  }
  if (value.options != null) {
    if (!isRecord(value.options)) {
      throw new TypeError(`Invalid marketplace entry at ${path}. "options" must be an object.`)
    }
    const version = normalizeNonEmptyString(value.options.version)
    entry.options = { ...(version != null ? { version } : {}) }
  }
  return entry
}
