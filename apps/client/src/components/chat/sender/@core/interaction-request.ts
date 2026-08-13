import type { AskUserQuestionParams } from '@oneworks/core'

export const shouldHideSenderForInteraction = (
  interactionRequest: { id: string; payload: AskUserQuestionParams } | null | undefined
) => interactionRequest?.payload.kind !== 'permission' && interactionRequest?.payload.multiselect === true
