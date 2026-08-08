import { getDb } from '#~/db/index.js'
import type { ChannelAuthorizationRequestRow } from '#~/db/index.js'
import { resolveChannelAuthorizationRequest } from '#~/services/channel-authorizations/index.js'
import { resumeReadyChannelIntents } from '#~/services/channel-resume/index.js'

import type { ChannelContext } from '../@types'
import { resolveRequesterAccountId, resolveRequesterUserId } from './authorization-context'
import { command, optionalArg, requiredArg } from './command-system'

const AUTH_RESUME_LIMIT = 20

const readStringMetadata = (request: ChannelAuthorizationRequestRow, key: string) => {
  const value = request.metadata?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const readStringArrayMetadata = (request: ChannelAuthorizationRequestRow, key: string) => {
  const value = request.metadata?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

const canResolveRequest = (
  ctx: ChannelContext,
  request: ChannelAuthorizationRequestRow,
  targetStatus: 'denied' | 'granted'
) => {
  const retryingSameResolution = request.status === targetStatus
  if (
    !retryingSameResolution &&
    (request.status !== 'pending' || (request.expiresAt != null && request.expiresAt <= Date.now()))
  ) return false
  if (request.channelType !== ctx.inbound.channelType) return false
  if (readStringMetadata(request, 'channelKey') !== ctx.channelKey) return false
  if (readStringMetadata(request, 'channelId') !== ctx.inbound.channelId) return false

  const actorRefs = [resolveRequesterAccountId(ctx), resolveRequesterUserId(ctx)]
    .filter((value): value is string => value != null && value !== '')
  const allowedApproverRefs = new Set(readStringArrayMetadata(request, 'allowedApproverRefs'))
  return actorRefs.some(ref => allowedApproverRefs.has(ref))
}

const getResolvableRequest = (ctx: ChannelContext, id: string, targetStatus: 'denied' | 'granted') => {
  const request = getDb().getChannelAuthorizationRequest(id)
  return request != null && canResolveRequest(ctx, request, targetStatus) ? request : undefined
}

const resumeResolvedAuthorization = async (authorizationRequestId: string) => {
  await resumeReadyChannelIntents({
    filter: { authorizationRequestId },
    limit: AUTH_RESUME_LIMIT
  }).catch(() => undefined)
}

const manuallyResumeResolvedAuthorization = async (authorizationRequestId: string) =>
  await resumeReadyChannelIntents({
    filter: { authorizationRequestId },
    includeDeferred: true,
    limit: AUTH_RESUME_LIMIT
  })

export const createGrantAuthorizationCommand = () =>
  command<ChannelContext>('grant')
    .description('cmd.auth.grant.description')
    .adminOnly()
    .argument(requiredArg('id'))
    .action(async ({ ctx, args: [id] }) => {
      if (getResolvableRequest(ctx, id, 'granted') == null) {
        await ctx.reply(ctx.t('auth.notResolvable', { id }))
        return
      }

      const resolution = await resolveChannelAuthorizationRequest({
        id,
        interactionResponse: 'allow_once',
        resolvedByAccountId: resolveRequesterAccountId(ctx),
        resolvedByUserId: resolveRequesterUserId(ctx),
        status: 'granted',
        resolvedAt: Date.now()
      })
      if (resolution?.resolved !== true) {
        await ctx.reply(ctx.t('auth.notResolvable', { id }))
        return
      }
      await resumeResolvedAuthorization(id)
      await ctx.reply(ctx.t('auth.resolved', {
        id,
        status: ctx.t('auth.status.granted')
      }))
    })

export const createDenyAuthorizationCommand = () =>
  command<ChannelContext>('deny')
    .description('cmd.auth.deny.description')
    .adminOnly()
    .argument(requiredArg('id'))
    .argument(optionalArg('reason'))
    .action(async ({ ctx, args: [id, reason] }) => {
      const request = getResolvableRequest(ctx, id, 'denied')
      if (request == null) {
        await ctx.reply(ctx.t('auth.notResolvable', { id }))
        return
      }

      const resolution = await resolveChannelAuthorizationRequest({
        id,
        interactionResponse: 'deny_once',
        status: 'denied',
        message: reason?.trim() === '' ? request.message : reason,
        resolvedByAccountId: resolveRequesterAccountId(ctx),
        resolvedByUserId: resolveRequesterUserId(ctx),
        resolvedAt: Date.now()
      })
      if (resolution?.resolved !== true) {
        await ctx.reply(ctx.t('auth.notResolvable', { id }))
        return
      }
      await resumeResolvedAuthorization(id)
      await ctx.reply(ctx.t('auth.resolved', {
        id,
        status: ctx.t('auth.status.denied')
      }))
    })

export const createResumeAuthorizationCommand = () =>
  command<ChannelContext>('resume')
    .description('cmd.auth.resume.description')
    .adminOnly()
    .argument(requiredArg('id'))
    .action(async ({ ctx, args: [id] }) => {
      const request = getDb().getChannelAuthorizationRequest(id)
      if (
        request == null ||
        request.channelType !== ctx.inbound.channelType ||
        readStringMetadata(request, 'channelKey') !== ctx.channelKey ||
        readStringMetadata(request, 'channelId') !== ctx.inbound.channelId
      ) {
        await ctx.reply(ctx.t('auth.notFound', { id }))
        return
      }

      const results = await manuallyResumeResolvedAuthorization(id)
      const resumed = results.filter(result => result.status === 'dispatched')
      if (resumed.length === 0) {
        await ctx.reply(ctx.t('auth.resume.empty', { id }))
        return
      }
      await ctx.reply(ctx.t('auth.resume.done', { count: resumed.length, id }))
    })
