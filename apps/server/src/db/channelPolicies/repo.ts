import type { SqliteDatabase } from '../sqlite'
import { createOffhourBacklogRepo } from './backlog-repo'
import { createReplyThrottlesRepo } from './throttle-repo'
import { createWebhookNoncesRepo } from './webhook-nonce-repo'

export type { ChannelOffhourBacklogRow } from './backlog-record'
export type { ChannelPolicyType, ChannelReplyThrottleRow } from './throttle-record'

export function createChannelPoliciesRepo(db: SqliteDatabase) {
  const throttles = createReplyThrottlesRepo(db)
  const backlog = createOffhourBacklogRepo(db)
  const webhookNonces = createWebhookNoncesRepo(db)

  return {
    appendOffhourBacklog: backlog.appendOffhourBacklog,
    consumeReplyThrottle: throttles.consumeReplyThrottle,
    commitWebhookNonce: webhookNonces.commit,
    getOffhourBacklogItem: backlog.getOffhourBacklogItem,
    getReplyThrottle: throttles.getReplyThrottle,
    listPendingOffhourBacklog: backlog.listPendingOffhourBacklog,
    markOffhourBacklogProcessed: backlog.markOffhourBacklogProcessed,
    pruneReplyThrottles: throttles.pruneReplyThrottles,
    releaseWebhookNonce: webhookNonces.release,
    reserveWebhookNonce: webhookNonces.reserve,
    releaseReplyThrottle: throttles.releaseReplyThrottle
  }
}
