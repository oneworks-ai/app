import { atom } from 'jotai'

import type { ChatMessageContent } from '@oneworks/types'

export interface PendingSessionCreationContext {
  initialContent?: ChatMessageContent[]
  source?: {
    groupId?: string
    label?: string
    pluginScope?: string
  }
  tags?: string[]
  title?: string
}

export const pendingSessionCreationContextAtom = atom<PendingSessionCreationContext | undefined>(undefined)
export const pendingSessionInitialContentAtom = atom<ChatMessageContent[] | undefined>(undefined)

export const hasPersistedSessionCreationTarget = (session?: { id?: string }) => (
  session?.id != null && session.id !== ''
)

export const shouldUsePendingSessionCreationContext = (session?: { id?: string }) => (
  !hasPersistedSessionCreationTarget(session)
)
