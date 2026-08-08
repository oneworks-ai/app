import { getDb } from '#~/db/index.js'
import { resolveChannelAuthorizationRequest } from '#~/services/channel-authorizations/index.js'
import { resumeReadyChannelIntents } from '#~/services/channel-resume/index.js'

import type { ChannelContext } from '../@types'
import { resolveRequesterAccountId, resolveRequesterUserId } from './authorization-context'
import { command, optionalArg, requiredArg } from './command-system'

const AUTH_RESUME_LIMIT = 20

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
      if (getDb().getChannelAuthorizationRequest(id) == null) {
        await ctx.reply(ctx.t('auth.notFound', { id }))
        return
      }

      await resolveChannelAuthorizationRequest({
        id,
        interactionResponse: 'allow_once',
        resolvedByAccountId: resolveRequesterAccountId(ctx),
        resolvedByUserId: resolveRequesterUserId(ctx),
        status: 'granted',
        resolvedAt: Date.now()
      })
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
      const request = getDb().getChannelAuthorizationRequest(id)
      if (request == null) {
        await ctx.reply(ctx.t('auth.notFound', { id }))
        return
      }

      await resolveChannelAuthorizationRequest({
        id,
        interactionResponse: 'deny_once',
        status: 'denied',
        message: reason?.trim() === '' ? request.message : reason,
        resolvedByAccountId: resolveRequesterAccountId(ctx),
        resolvedByUserId: resolveRequesterUserId(ctx),
        resolvedAt: Date.now()
      })
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
      if (getDb().getChannelAuthorizationRequest(id) == null) {
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
