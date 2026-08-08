import type { SqliteDatabase } from '../sqlite'
import { createOffhourBacklogRepo } from './backlog-repo'
import { createReplyThrottlesRepo } from './throttle-repo'

export type { ChannelOffhourBacklogRow } from './backlog-record'
export type { ChannelPolicyType, ChannelReplyThrottleRow } from './throttle-record'

export function createChannelPoliciesRepo(db: SqliteDatabase) {
  const throttles = createReplyThrottlesRepo(db)
  const backlog = createOffhourBacklogRepo(db)

  return {
    appendOffhourBacklog: backlog.appendOffhourBacklog,
    consumeReplyThrottle: throttles.consumeReplyThrottle,
    getOffhourBacklogItem: backlog.getOffhourBacklogItem,
    getReplyThrottle: throttles.getReplyThrottle,
    listPendingOffhourBacklog: backlog.listPendingOffhourBacklog,
    markOffhourBacklogProcessed: backlog.markOffhourBacklogProcessed,
    pruneReplyThrottles: throttles.pruneReplyThrottles
  }
}
