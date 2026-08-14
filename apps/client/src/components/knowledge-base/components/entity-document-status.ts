import type { EntityRuntimeDetail } from '@oneworks/types'

export const hasEntityDocumentContent = (
  document: Pick<EntityRuntimeDetail['documents'][number], 'body' | 'fragments'>
) => document.body.trim() !== '' || document.fragments.length > 0
