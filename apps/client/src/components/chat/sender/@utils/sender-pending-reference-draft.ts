import type { PendingReferenceDraft } from '../@types/sender-composer'

import { normalizePendingReferenceDraft } from './sender-pending-reference-draft-normalizers'

const senderPendingReferenceDraftStorageKeyPrefix = 'oneworks.chat.senderPendingReferenceDraft:'

export const getSenderPendingReferenceDraftStorageKey = (sessionId: string) => (
  `${senderPendingReferenceDraftStorageKeyPrefix}${sessionId}`
)

export const createEmptyPendingReferenceDraft = (): PendingReferenceDraft => ({
  pendingImages: [],
  pendingFiles: [],
  pendingAnnotations: [],
  pendingTextSelections: [],
  pendingFileComments: []
})

export const hasPendingReferenceDraft = (draft: PendingReferenceDraft) => (
  draft.pendingImages.length > 0 ||
  draft.pendingFiles.length > 0 ||
  draft.pendingAnnotations.length > 0 ||
  draft.pendingTextSelections.length > 0 ||
  draft.pendingFileComments.length > 0
)

export const readPendingReferenceDraft = (storageKey: string): PendingReferenceDraft => {
  if (typeof window === 'undefined') return createEmptyPendingReferenceDraft()

  try {
    return normalizePendingReferenceDraft(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return createEmptyPendingReferenceDraft()
  }
}

export const writePendingReferenceDraft = (storageKey: string, draft: PendingReferenceDraft) => {
  if (typeof window === 'undefined') return

  try {
    if (!hasPendingReferenceDraft(draft)) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage failures; the live composer state remains authoritative.
    }
  }
}
