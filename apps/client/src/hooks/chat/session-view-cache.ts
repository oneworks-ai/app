import type { ChatMessage, SessionMessageQueueState, SessionWorkspaceChanges } from '@oneworks/core'
import type { SessionCreationProgressEvent, SessionInfo } from '@oneworks/types'

import type { ChatErrorState, InteractionRequestState } from './interaction-state'
import type { SessionCompactionInfo } from './session-compaction'

export interface ChatSessionViewSnapshot {
  creationProgress: SessionCreationProgressEvent[]
  messages: ChatMessage[]
  sessionInfo: SessionInfo | null
  sessionCompactionInfo: SessionCompactionInfo | null
  sessionCompactionEvents: SessionCompactionInfo[]
  sessionWorkspaceChanges: SessionWorkspaceChanges[]
  queuedMessages: SessionMessageQueueState
  errorState: ChatErrorState | null
  interactionRequest: InteractionRequestState | null
  isHydrated: boolean
}

export const MAX_CHAT_SESSION_VIEW_SNAPSHOTS = 20

export const createChatSessionViewSnapshot = (
  value?: Partial<ChatSessionViewSnapshot>
): ChatSessionViewSnapshot => ({
  creationProgress: value?.creationProgress ?? [],
  messages: value?.messages ?? [],
  sessionInfo: value?.sessionInfo ?? null,
  sessionCompactionInfo: value?.sessionCompactionInfo ?? null,
  sessionCompactionEvents: value?.sessionCompactionEvents ?? [],
  sessionWorkspaceChanges: value?.sessionWorkspaceChanges ?? [],
  queuedMessages: value?.queuedMessages ?? { steer: [], next: [] },
  errorState: value?.errorState ?? null,
  interactionRequest: value?.interactionRequest ?? null,
  isHydrated: value?.isHydrated ?? false
})

export const mergeChatSessionViewSnapshot = (
  current: ChatSessionViewSnapshot | undefined,
  patch: Partial<ChatSessionViewSnapshot>
): ChatSessionViewSnapshot => {
  return createChatSessionViewSnapshot({
    ...createChatSessionViewSnapshot(current),
    ...patch
  })
}

export const restoreChatSessionViewSnapshot = (snapshot?: ChatSessionViewSnapshot) => {
  const resolved = createChatSessionViewSnapshot(snapshot)
  const restorable = resolved.isHydrated === true
    ? resolved
    : createChatSessionViewSnapshot()

  return {
    creationProgress: restorable.creationProgress,
    messages: restorable.messages,
    sessionInfo: restorable.sessionInfo,
    sessionCompactionInfo: restorable.sessionCompactionInfo,
    sessionCompactionEvents: restorable.sessionCompactionEvents,
    sessionWorkspaceChanges: restorable.sessionWorkspaceChanges,
    queuedMessages: restorable.queuedMessages,
    errorState: restorable.errorState,
    interactionRequest: restorable.interactionRequest,
    isReady: restorable.isHydrated
  }
}

export const setChatSessionViewSnapshot = (
  cache: Map<string, ChatSessionViewSnapshot>,
  sessionId: string,
  patch: Partial<ChatSessionViewSnapshot>
) => {
  const next = mergeChatSessionViewSnapshot(cache.get(sessionId), patch)

  if (cache.has(sessionId)) {
    cache.delete(sessionId)
  }

  cache.set(sessionId, next)

  while (cache.size > MAX_CHAT_SESSION_VIEW_SNAPSHOTS) {
    const oldestSessionId = cache.keys().next().value
    if (oldestSessionId == null) {
      break
    }
    cache.delete(oldestSessionId)
  }

  return next
}

export const deleteChatSessionViewSnapshot = (
  cache: Map<string, ChatSessionViewSnapshot>,
  sessionId: string
) => {
  cache.delete(sessionId)
}
