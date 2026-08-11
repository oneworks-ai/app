import type { SqliteDatabase } from '../sqlite'
import { createAvailabilityOverridesRepo } from './availability-repo'
import { createOffhourBacklogRepo } from './backlog-repo'
import { createChannelPolicyStateRepo } from './policy-repo'
import { createReplyThrottlesRepo } from './throttle-repo'
import { createWebhookNoncesRepo } from './webhook-nonce-repo'

export type { ChannelOffhourBacklogRow, ChannelOffhourBacklogStatus } from './backlog-record'
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
  const policyStates = createChannelPolicyStateRepo(db)
  const webhookNonces = createWebhookNoncesRepo(db)
  const availabilityOverrides = createAvailabilityOverridesRepo(db)

  return {
    appendOffhourBacklog: backlog.appendOffhourBacklog,
    attachOffhourBacklogDigestChildRun: backlog.attachOffhourBacklogDigestChildRun,
    appendChannelPolicyEvent: policyStates.appendChannelPolicyEvent,
    applyChannelPolicyHit: policyStates.applyChannelPolicyHit,
    compareAndSetChannelPolicyState: policyStates.compareAndSetChannelPolicyState,
    consumeReplyThrottle: throttles.consumeReplyThrottle,
    commitWebhookNonce: webhookNonces.commit,
    claimOffhourBacklog: backlog.claimOffhourBacklog,
    completeOffhourBacklogClaim: backlog.completeOffhourBacklogClaim,
    getChannelAvailabilityOverride: availabilityOverrides.get,
    getOffhourBacklogItem: backlog.getOffhourBacklogItem,
    getChannelPolicyEventByEventKey: policyStates.getChannelPolicyEventByEventKey,
    getChannelPolicyState: policyStates.getChannelPolicyState,
    getReplyThrottle: throttles.getReplyThrottle,
    listPendingOffhourBacklog: backlog.listPendingOffhourBacklog,
    listChannelPolicyEvents: policyStates.listChannelPolicyEvents,
    listRecentChannelPolicyEvents: policyStates.listRecentChannelPolicyEvents,
    markOffhourBacklogProcessed: backlog.markOffhourBacklogProcessed,
    pruneReplyThrottles: throttles.pruneReplyThrottles,
    releaseWebhookNonce: webhookNonces.release,
    reserveWebhookNonce: webhookNonces.reserve,
    releaseReplyThrottle: throttles.releaseReplyThrottle,
    retryOffhourBacklogClaim: backlog.retryOffhourBacklogClaim,
    setChannelAvailabilityOverride: availabilityOverrides.set
  }
}
