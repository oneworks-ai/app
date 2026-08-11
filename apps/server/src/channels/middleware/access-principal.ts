import type { ChannelContext } from './@types'

export interface ChannelAccessPrincipal {
  accountId?: string
  canonicalUserId?: string
  issuerKey?: string
}

const matchesAccessRef = (reference: string, principal: ChannelAccessPrincipal) => (
  reference === principal.accountId ||
  reference === principal.canonicalUserId ||
  (principal.canonicalUserId != null && reference === `user:${principal.canonicalUserId}`) ||
  (
    principal.issuerKey != null &&
    principal.accountId != null &&
    reference === `account:${principal.issuerKey}:${principal.accountId}`
  )
)

export const matchesAnyAccessRef = (
  references: readonly string[] | undefined,
  principal: ChannelAccessPrincipal
) => references?.some(reference => matchesAccessRef(reference, principal)) === true

export const resolveChannelAccessPrincipal = (ctx: ChannelContext): ChannelAccessPrincipal => ({
  accountId: ctx.actor?.account.accountId ?? ctx.inbound.senderId,
  canonicalUserId: ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id : undefined,
  issuerKey: ctx.actor?.account.issuerKey ?? ctx.channelKey
})

export const isChannelAdminPrincipal = (
  references: readonly string[] | undefined,
  principal: ChannelAccessPrincipal
) => matchesAnyAccessRef(references, principal)

export const isChannelAdminContext = (ctx: ChannelContext) =>
  isChannelAdminPrincipal(ctx.config?.access?.admins, resolveChannelAccessPrincipal(ctx))
