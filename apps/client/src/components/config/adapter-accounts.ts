import type { AdapterAccountInfo } from '@oneworks/types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeText = (value: string | undefined) => value?.trim().toLowerCase() ?? ''

const compareAccountInfo = (
  left: Pick<AdapterAccountInfo, 'key' | 'title' | 'status' | 'isDefault'>,
  right: Pick<AdapterAccountInfo, 'key' | 'title' | 'status' | 'isDefault'>
) => {
  if (left.isDefault === true && right.isDefault !== true) return -1
  if (right.isDefault === true && left.isDefault !== true) return 1

  if (left.status !== right.status) {
    if (left.status === 'ready') return -1
    if (right.status === 'ready') return 1
  }

  const titleOrder = normalizeText(left.title).localeCompare(normalizeText(right.title))
  if (titleOrder !== 0) return titleOrder

  return left.key.localeCompare(right.key)
}

export const getConfiguredAdapterAccounts = (value: Record<string, unknown>) => {
  const configured = value.accounts
  return isRecord(configured) ? configured : {}
}

export const mergeAdapterAccounts = (
  configured: Record<string, unknown>,
  discovered: AdapterAccountInfo[],
  defaultAccountKey?: string
) => {
  const merged = new Map<string, AdapterAccountInfo>()

  Object.entries(configured).forEach(([key, entry]) => {
    const configuredEntry = isRecord(entry) ? entry : {}
    const title = typeof configuredEntry.title === 'string' ? configuredEntry.title.trim() : ''
    const description = typeof configuredEntry.description === 'string' ? configuredEntry.description.trim() : ''
    merged.set(key, {
      key,
      title: title !== '' ? title : key,
      ...(description !== '' ? { description } : {}),
      status: 'missing'
    })
  })

  discovered.forEach((account) => {
    const existing = merged.get(account.key)
    merged.set(account.key, {
      ...existing,
      ...account
    })
  })

  return [...merged.values()]
    .map(account => ({
      ...account,
      isDefault: defaultAccountKey != null && defaultAccountKey !== ''
        ? account.key === defaultAccountKey
        : account.isDefault
    }))
    .sort(compareAccountInfo)
}
