import { useCallback, useEffect, useRef, useState } from 'react'

import { respondSessionInteraction } from '#~/api/sessions'
import type { AskUserQuestionParams } from '@oneworks/core'
import type { InteractionResponseData } from '@oneworks/types'

export function useChatInteraction({
  sessionId
}: {
  sessionId?: string
}) {
  const [interactionRequest, setInteractionRequest] = useState<{ id: string; payload: AskUserQuestionParams } | null>(
    null
  )
  const interactionRequestRef = useRef(interactionRequest)
  const sessionIdRef = useRef(sessionId)

  useEffect(() => {
    interactionRequestRef.current = interactionRequest
  }, [interactionRequest])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const handleInteractionResponse = useCallback(async (id: string, data: InteractionResponseData) => {
    if (!sessionId) {
      throw new Error('Cannot submit an interaction response without an active session')
    }

    const submittedRequest = interactionRequestRef.current
    await respondSessionInteraction(sessionId, id, data)

    if (sessionIdRef.current !== sessionId || interactionRequestRef.current !== submittedRequest) {
      return
    }

    setInteractionRequest(current => (current === submittedRequest && current?.id === id ? null : current))
  }, [sessionId])

  return {
    interactionRequest,
    setInteractionRequest,
    handleInteractionResponse
  }
}
