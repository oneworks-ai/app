import type { AskUserQuestionParams, Session, SessionMessageQueueState, WSEvent } from '@oneworks/core'

export interface ApiOkResponse {
  ok: boolean
}

export interface ApiRemoveResponse extends ApiOkResponse {
  removed: boolean
}

export interface SessionInteraction {
  id: string
  payload: AskUserQuestionParams
}

export interface SessionMessagesCursor {
  firstId?: number
  lastId?: number
}

export interface SessionMessagesResponse {
  cursor?: SessionMessagesCursor
  messages: WSEvent[]
  session?: Session
  interaction?: SessionInteraction
  queuedMessages?: SessionMessageQueueState
}
