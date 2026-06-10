import { atom } from 'jotai'

export interface PendingSessionCreationContext {
  source?: {
    groupId?: string
    label?: string
    pluginScope?: string
  }
  tags?: string[]
  title?: string
}

export const pendingSessionCreationContextAtom = atom<PendingSessionCreationContext | undefined>(undefined)

export const hasPersistedSessionCreationTarget = (session?: { id?: string }) => (
  session?.id != null && session.id !== ''
)

export const shouldUsePendingSessionCreationContext = (session?: { id?: string }) => (
  !hasPersistedSessionCreationTarget(session)
)
