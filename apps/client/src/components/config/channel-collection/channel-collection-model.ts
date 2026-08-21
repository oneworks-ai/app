import type { ConfigUiRecordKind } from '@oneworks/types'

export type ChannelCollectionFilter = 'all' | 'configured' | 'unconfigured'

export const normalizeChannelSearchText = (value: unknown) => (
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
)

export const matchesChannelQuery = (query: string, ...values: unknown[]) => (
  query === '' || values.some(value => normalizeChannelSearchText(value).includes(query))
)

export const getChannelType = (item: Record<string, unknown>) => (
  typeof item.type === 'string' ? item.type.trim() : ''
)

export const getChannelDisplayTitle = (item: Record<string, unknown>, itemKey: string) => {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  return title !== '' ? title : itemKey
}

export const getChannelDescription = (item: Record<string, unknown>, kind?: ConfigUiRecordKind) => {
  const description = typeof item.description === 'string' ? item.description.trim() : ''
  return description !== '' ? description : kind?.description
}
