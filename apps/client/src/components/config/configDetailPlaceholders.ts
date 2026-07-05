import { builtInAdapterKeys } from '#~/resources/adapters'

import type { DetailCollectionPlaceholderEntry } from './configDetail'

const adapterPlaceholderEntries: DetailCollectionPlaceholderEntry[] = builtInAdapterKeys.map(key => ({ key }))

export const getConfigDetailPlaceholderEntries = (
  sectionKey: string
): DetailCollectionPlaceholderEntry[] | undefined => (
  sectionKey === 'adapters'
    ? adapterPlaceholderEntries
    : undefined
)
