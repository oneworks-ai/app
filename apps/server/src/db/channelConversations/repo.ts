import type { SqliteDatabase } from '../sqlite'
import { createPendingIntentReaders } from './pending-intent-read-repo'
import { createPendingIntentWriters } from './pending-intent-write-repo'
import { createConversationStatesRepo } from './state-repo'
import { createConversationTurnsRepo } from './turn-repo'

export type {
  ChannelPendingIntentDelivery,
  ChannelPendingIntentKind,
  ChannelPendingIntentRow,
  ChannelPendingIntentStatus
} from './pending-intent-record'
export type { ChannelConversationStateRow } from './state-record'
export type { ChannelConversationTurnRole, ChannelConversationTurnRow } from './turn-record'

export function createChannelConversationsRepo(db: SqliteDatabase) {
  const states = createConversationStatesRepo(db)
  const turns = createConversationTurnsRepo(db, states)
  const pendingIntentReaders = createPendingIntentReaders(db)
  const pendingIntentWriters = createPendingIntentWriters(db, states, pendingIntentReaders)

  return {
    appendTurn: turns.appendTurn,
    claimPendingIntentResume: pendingIntentWriters.claimPendingIntentResume,
    ensureState: states.ensureState,
    getPendingIntent: pendingIntentReaders.getPendingIntent,
    getState: states.getState,
    getStateByThread: states.getStateByThread,
    getTurn: turns.getTurn,
    listOpenPendingIntents: pendingIntentReaders.listOpenPendingIntents,
    listRecentTurns: turns.listRecentTurns,
    listResolvedPendingIntents: pendingIntentReaders.listResolvedPendingIntents,
    finishPendingIntentResumeClaim: pendingIntentWriters.finishPendingIntentResumeClaim,
    updatePendingIntent: pendingIntentWriters.updatePendingIntent,
    upsertPendingIntent: pendingIntentWriters.upsertPendingIntent
  }
}
