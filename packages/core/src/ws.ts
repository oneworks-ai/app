import type { AdapterErrorData, AskUserQuestionParams, SessionInfo, WSEvent as SharedWSEvent } from '@oneworks/types'

export type WSEvent = SharedWSEvent<AdapterErrorData, SessionInfo, any, AskUserQuestionParams>
