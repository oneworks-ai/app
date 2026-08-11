import type { SqliteDatabase } from '../sqlite'
import { createOffhourBacklogRepo } from './backlog-repo'
import { createChannelPolicyStateRepo } from './policy-repo'
import { createReplyThrottlesRepo } from './throttle-repo'
import { createWebhookNoncesRepo } from './webhook-nonce-repo'

export type { ChannelOffhourBacklogRow } from './backlog-record'
export type {
  ChannelPolicyEventRow,
  ChannelPolicyScope,
  ChannelPolicyState,
  ChannelPolicyStateRow
} from './policy-record'
export type { ChannelPolicyType, ChannelReplyThrottleRow } from './throttle-record'

export function createChannelPoliciesRepo(db: SqliteDatabase) {
  const throttles = createReplyThrottlesRepo(db)
  const backlog = createOffhourBacklogRepo(db)
  const webhookNonces = createWebhookNoncesRepo(db)
  const policyStates = createChannelPolicyStateRepo(db)

  return {
    appendOffhourBacklog: backlog.appendOffhourBacklog,
    appendChannelPolicyEvent: policyStates.appendChannelPolicyEvent,
    compareAndSetChannelPolicyState: policyStates.compareAndSetChannelPolicyState,
    consumeReplyThrottle: throttles.consumeReplyThrottle,
    commitWebhookNonce: webhookNonces.commit,
    getOffhourBacklogItem: backlog.getOffhourBacklogItem,
    getChannelPolicyState: policyStates.getChannelPolicyState,
    getChannelPolicyEventByEventKey: policyStates.getChannelPolicyEventByEventKey,
    getReplyThrottle: throttles.getReplyThrottle,
    listPendingOffhourBacklog: backlog.listPendingOffhourBacklog,
    listChannelPolicyEvents: policyStates.listChannelPolicyEvents,
    markOffhourBacklogProcessed: backlog.markOffhourBacklogProcessed,
    pruneReplyThrottles: throttles.pruneReplyThrottles,
    releaseWebhookNonce: webhookNonces.release,
    reserveWebhookNonce: webhookNonces.reserve,
    releaseReplyThrottle: throttles.releaseReplyThrottle
  }
}
