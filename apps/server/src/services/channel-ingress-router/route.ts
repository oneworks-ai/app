import type { ChannelRoute, ChannelRouteMode } from '@oneworks/types'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'

import type { ResolvedChannelRoute } from './types'

type GlobalRouteResolver = (input: { ctx: ChannelContext; mode: ChannelRouteMode }) => ChannelRoute | undefined

let globalRouteResolver: GlobalRouteResolver | undefined

export const setChannelIngressGlobalRouteResolverForTests = (resolver: GlobalRouteResolver | undefined) => {
  globalRouteResolver = resolver
}

const mergeRoute = (base: ResolvedChannelRoute, override: ChannelRoute | undefined): ResolvedChannelRoute => ({
  ...base,
  ...override
})

export const resolveChannelIngressRoute = (ctx: ChannelContext, mode: ChannelRouteMode): ResolvedChannelRoute => {
  const routing = ctx.channelLink?.routing
  const actorAccountId = ctx.actor?.account.accountId ?? ctx.inbound.senderId
  const accountRoute = actorAccountId != null && (ctx.actor == null || ctx.actor.account.issuerKey === ctx.channelKey)
    ? routing?.accounts[ctx.channelKey]?.[actorAccountId]
    : undefined
  const userId = ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id : undefined
  const route = [
    globalRouteResolver?.({ ctx, mode }),
    routing?.default,
    routing?.modes[mode],
    userId == null ? undefined : routing?.users[userId],
    accountRoute
  ].reduce<ResolvedChannelRoute>((resolved, candidate) => mergeRoute(resolved, candidate), { mode })
  return route
}
