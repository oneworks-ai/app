import type { AskUserQuestionParams } from '@oneworks/core'

export const shouldHideSenderForInteraction = (
  _interactionRequest: { id: string; payload: AskUserQuestionParams } | null | undefined
) => false
