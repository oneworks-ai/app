import { getDb } from '#~/db/index.js'
import type { ChannelAuthorizationRequestRow } from '#~/db/index.js'
import { listReadyChannelResumeIntents } from '#~/services/channel-resume/index.js'
import type { ChannelResumeIntent } from '#~/services/channel-resume/index.js'

import type { ChannelContext } from '../@types'
import { isAdmin } from './access'

export const resolveRequesterAccountId = (ctx: ChannelContext) =>
  ctx.actor?.account.accountId ?? ctx.inbound.senderId?.trim()

export const resolveRequesterUserId = (ctx: ChannelContext) => ctx.actor?.user?.id

const formatRequester = (request: ChannelAuthorizationRequestRow) => {
  const requester = request.requesterUserId ?? request.requesterAccountId ?? '?'
  const credentialSubject = request.credentialSubjectUserId
  return credentialSubject == null || credentialSubject === requester
    ? requester
    : `${requester} -> ${credentialSubject}`
}

export const formatRequestItem = (
  ctx: ChannelContext,
  request: ChannelAuthorizationRequestRow,
  index: number
) =>
  ctx.t('auth.list.item', {
    index,
    id: request.id,
    capability: request.capability,
    requester: formatRequester(request),
    channelLink: request.channelLinkName ?? ctx.t('label.notSet'),
    message: request.message ?? ''
  })

export const listOwnPendingRequests = (ctx: ChannelContext) => {
  const db = getDb()
  const userId = resolveRequesterUserId(ctx)
  if (userId != null && userId !== '') {
    return db.listPendingChannelAuthorizationRequestsForUser(userId, ctx.inbound.channelType)
  }

  const accountId = resolveRequesterAccountId(ctx)
  return accountId == null || accountId === ''
    ? []
    : db.listPendingChannelAuthorizationRequestsForAccount(accountId, ctx.inbound.channelType)
}

const buildOwnerResumeFilters = (ctx: ChannelContext) => {
  if (isAdmin(ctx)) return [{ channelType: ctx.inbound.channelType }]

  const filters: Parameters<typeof listReadyChannelResumeIntents>[0][] = []
  const userId = resolveRequesterUserId(ctx)
  if (userId != null && userId !== '') {
    filters.push({ channelType: ctx.inbound.channelType, ownerUserId: userId })
  }

  const accountId = resolveRequesterAccountId(ctx)
  if (accountId != null && accountId !== '') {
    filters.push({ channelType: ctx.inbound.channelType, ownerAccountId: accountId })
  }
  return filters
}

export const listResumableAuthorizationIntents = (ctx: ChannelContext) => {
  const seen = new Set<string>()
  return buildOwnerResumeFilters(ctx)
    .flatMap(filter => listReadyChannelResumeIntents(filter, { includeDeferred: true }))
    .filter(item => {
      if (seen.has(item.intent.id)) return false
      seen.add(item.intent.id)
      return true
    })
}

export const formatResumableItem = (ctx: ChannelContext, item: ChannelResumeIntent, index: number) =>
  ctx.t('auth.resumable.item', {
    index,
    id: item.resume.authorizationRequestId,
    mode: item.resume.mode ?? 'immediate',
    sessionId: item.resume.sessionId,
    owner: item.intent.ownerUserId ?? item.intent.ownerAccountId ?? '?',
    capability: item.resume.capability ?? (
      typeof item.intent.payload?.capability === 'string' ? item.intent.payload.capability : '?'
    )
  })
