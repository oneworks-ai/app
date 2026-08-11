import process from 'node:process'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { getDb } from '#~/db/index.js'
import { loadAmbientChannelTurns } from '#~/services/channel-continuity/index.js'

import { createRouterModelInvoker } from './invoker'
import { resolveChannelIngressRoute } from './route'
import type { IngressRouterDecision, RouterModelInvoker } from './types'

export { setChannelIngressGlobalRouteResolverForTests } from './route'
export type { IngressRouterDecision, ResolvedChannelRoute, RouterModelInvoker } from './types'

let modelInvoker: RouterModelInvoker | undefined

export const setRouterModelInvokerForTests = (invoker: RouterModelInvoker | undefined) => {
  modelInvoker = invoker
}

const isCommand = (ctx: ChannelContext) => ctx.commandText.startsWith(ctx.config?.commandPrefix?.trim() || '/')

const resolvePendingIntentMatches = (ctx: ChannelContext) => {
  if (ctx.channelLink?.ingress.createOnPendingIntent === false) return []
  const now = Date.now()
  const pending = getDb().listOpenChannelPendingIntents({ channelKey: ctx.channelKey })
  const accountId = ctx.actor?.account.accountId ?? ctx.inbound.senderId
  const userId = ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id : undefined
  return pending.filter(intent => (
    (intent.expiresAt == null || intent.expiresAt > now) &&
    intent.channelId === ctx.inbound.channelId &&
    intent.entity === ctx.channelLink?.entity &&
    // Raw approver account ids are not issuer-scoped principals. Do not authorize a
    // deterministic ingress match from them until the typed approver principal lands.
    (intent.ownerAccountId === accountId || (userId != null && (
      intent.ownerUserId === userId || intent.approverUserIds.includes(userId)
    )))
  ))
}

const deterministicDecision = (ctx: ChannelContext): IngressRouterDecision | undefined => {
  if (ctx.inbound.mentionedBot === false) return { decision: 'ignore', reason: 'mentioned_other_bot', confidence: 1 }
  if (ctx.inbound.mentionedBot === true && ctx.channelLink?.ingress.createOnMention !== false) {
    return { decision: 'create_child', reason: 'current_bot_mention', confidence: 1, mode: 'reply' }
  }
  if (ctx.inbound.replyMessageId != null && ctx.channelLink?.ingress.createOnReplyToBot !== false) {
    const conversation = getDb().getChannelConversationStateByLastBotReply({
      channelId: ctx.inbound.channelId,
      channelKey: ctx.channelKey,
      channelType: ctx.inbound.channelType,
      messageId: ctx.inbound.replyMessageId
    })
    if (conversation != null && conversation.entity === ctx.channelLink?.entity) {
      return { decision: 'create_child', reason: 'reply_to_current_bot', confidence: 1, mode: 'reply' }
    }
  }
  if (resolvePendingIntentMatches(ctx).length > 0) {
    return { decision: 'create_child', reason: 'owned_pending_intent', confidence: 1, mode: 'reply' }
  }
  if (isCommand(ctx) && ctx.channelLink?.ingress.createOnCommand !== false) {
    return { decision: 'create_child', reason: 'channel_command', confidence: 1, mode: 'reply' }
  }
  if (ctx.inbound.sessionType === 'direct') {
    return { decision: 'create_child', reason: 'direct_message', confidence: 0.9, mode: 'reply' }
  }
  return undefined
}

const audit = (
  ctx: ChannelContext,
  decision: IngressRouterDecision,
  error: string | null,
  latencyMs: number | null,
  counts = { candidateCount: 0, contextCount: 0, filteredCount: 0 }
) => {
  const route = resolveChannelIngressRoute(ctx, decision.mode ?? 'reply')
  return getDb().createChannelIngressRouterRun({
    actorAccountId: ctx.actor?.account.accountId ?? null,
    actorUserId: ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id ?? null : null,
    adapter: route.adapter ?? null,
    candidateCount: counts.candidateCount,
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name ?? null,
    channelType: ctx.inbound.channelType,
    childRunId: null,
    confidence: decision.confidence,
    contextCount: counts.contextCount,
    decision: decision.decision,
    entity: ctx.channelLink?.entity ?? null,
    error,
    filteredCount: counts.filteredCount,
    latencyMs,
    messageId: ctx.inbound.messageId ?? null,
    mode: route.mode,
    model: route.model ?? null,
    reason: decision.reason,
    senderId: ctx.inbound.senderId ?? null,
    sessionType: ctx.inbound.sessionType,
    syntheticActorRole: ctx.inbound.synthetic?.actorRole ?? null,
    syntheticUserLabel: ctx.inbound.synthetic?.userLabel ?? null,
    visibility: route.visibility ?? null
  })
}

export const routeInboundChannelMessage = async (ctx: ChannelContext) => {
  const deterministic = deterministicDecision(ctx)
  if (deterministic != null) {
    return {
      audit: audit(ctx, deterministic, null, 0),
      decision: deterministic,
      route: resolveChannelIngressRoute(ctx, deterministic.mode ?? 'reply')
    }
  }
  if (ctx.inbound.sessionType !== 'group' || !ctx.channelLink?.ingress.ambientRouting) {
    const decision: IngressRouterDecision = { decision: 'observe', reason: 'ambient_routing_disabled', confidence: 1 }
    return { audit: audit(ctx, decision, null, 0), decision, route: resolveChannelIngressRoute(ctx, 'reply') }
  }
  const route = resolveChannelIngressRoute(ctx, 'reply')
  const invoker = modelInvoker ?? createRouterModelInvoker({ cwd: process.cwd() })
  const routerAdapter = ctx.channelLink.ingress.routerAdapter ?? route.adapter
  const routerModel = ctx.channelLink.ingress.routerModel ?? route.model
  if (routerAdapter == null || routerModel == null) {
    const decision: IngressRouterDecision = { decision: 'observe', reason: 'router_route_unconfigured', confidence: 1 }
    return { audit: audit(ctx, decision, 'Router model route is unconfigured', 0), decision, route }
  }
  const observeWindow = ctx.channelLink.ingress.observeWindow
  const maxTurns = observeWindow?.maxTurns ?? 20
  const ttlSeconds = observeWindow?.ttlSeconds ?? 1800
  const ambientTurns = loadAmbientChannelTurns({
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelType: ctx.inbound.channelType,
    entity: ctx.channelLink.entity,
    maxTurns,
    ttlSeconds
  })
  const context = ambientTurns.map(turn => `${turn.role}: ${(turn.summary ?? turn.text ?? '').slice(0, 512)}`)
  const counts = { candidateCount: ambientTurns.length, contextCount: context.length, filteredCount: 0 }
  const result = await invoker.invoke({
    adapter: routerAdapter,
    context,
    model: routerModel,
    prompt: ctx.channelLink.ingress.routerPrompt,
    text: (ctx.inbound.text ?? '').slice(0, 4000)
  })
  if (!result.ok) {
    const fallback: IngressRouterDecision = { decision: 'observe', reason: `router_${result.code}`, confidence: 1 }
    return { audit: audit(ctx, fallback, result.error, result.latencyMs, counts), decision: fallback, route }
  }
  const decision: IngressRouterDecision = result.output
  const mode = decision.mode ?? 'reply'
  if (!Object.hasOwn(ctx.channelLink.routing.modes, mode) && mode !== 'reply') {
    const fallback: IngressRouterDecision = { decision: 'observe', reason: 'router_mode_not_allowed', confidence: 1 }
    return {
      audit: audit(ctx, fallback, 'Router selected a mode not allowed by channel routing', result.latencyMs, counts),
      decision: fallback,
      route
    }
  }
  if (mode === 'admin' || mode === 'background') {
    const fallback: IngressRouterDecision = { decision: 'observe', reason: 'router_mode_not_authorized', confidence: 1 }
    return {
      audit: audit(
        ctx,
        fallback,
        'Router selected a privileged mode for a normal inbound message',
        result.latencyMs,
        counts
      ),
      decision: fallback,
      route
    }
  }
  return {
    audit: audit(ctx, decision, null, result.latencyMs, counts),
    decision,
    route: resolveChannelIngressRoute(ctx, mode)
  }
}
