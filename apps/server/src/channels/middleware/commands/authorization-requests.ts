import { getDb } from '#~/db/index.js'
import { buildChannelApproverPrincipals } from '#~/services/channel-authorizations/approvers.js'

import type { ChannelContext } from '../@types'
import {
  formatRequestItem,
  formatResumableItem,
  listOwnPendingRequests,
  listResumableAuthorizationIntents,
  resolveRequesterAccountId,
  resolveRequesterUserId
} from './authorization-context'
import { command, optionalArg, requiredArg } from './command-system'

const AUTH_LIST_SCOPE_CHOICES = [
  { value: 'pending', title: 'auth.scope.pending' },
  { value: 'resumable', title: 'auth.scope.resumable' }
] as const

export const createAuthorizationRequestCommand = () =>
  command<ChannelContext>('request')
    .description('cmd.auth.request.description')
    .approval({ capability: 'channel.authorization.request', risk: 'medium', visibility: 'dm' })
    .argument(requiredArg('capability'))
    .argument(optionalArg('message'))
    .action(async ({ ctx, args: [capability, message] }) => {
      const requesterAccountId = resolveRequesterAccountId(ctx)
      if (requesterAccountId == null || requesterAccountId === '') {
        await ctx.reply(ctx.t('auth.senderMissing'))
        return
      }

      const request = getDb().createChannelAuthorizationRequest({
        channelType: ctx.inbound.channelType,
        issuerKey: ctx.channelKey,
        channelKey: ctx.channelKey,
        channelId: ctx.inbound.channelId,
        channelLinkName: ctx.channelLink?.name,
        requesterUserId: resolveRequesterUserId(ctx),
        requesterAccountId,
        capability,
        message: message?.trim() === '' ? null : message,
        allowedApprovers: buildChannelApproverPrincipals({
          channelAdmins: ctx.config?.access?.admins,
          credentialSubjectUserId: resolveRequesterUserId(ctx),
          issuerKey: ctx.channelKey,
          requesterAccountId,
          requesterUserId: resolveRequesterUserId(ctx)
        }),
        metadata: {
          channelKey: ctx.channelKey,
          channelId: ctx.inbound.channelId,
          sessionType: ctx.inbound.sessionType,
          entity: ctx.channelLink?.entity
        }
      })
      await ctx.reply(ctx.t('auth.request.created', {
        id: request?.id ?? '?',
        capability
      }))
    })

export const createListAuthorizationCommand = () =>
  command<ChannelContext>('list')
    .description('cmd.auth.list.description')
    .approval({ capability: 'channel.authorization.list', risk: 'low', visibility: 'dm' })
    .argument(optionalArg('scope', { choices: AUTH_LIST_SCOPE_CHOICES }))
    .action(async ({ ctx, args: [scope] }) => {
      if (scope === 'resumable') {
        const items = listResumableAuthorizationIntents(ctx)
        if (items.length === 0) {
          await ctx.reply(ctx.t('auth.resumable.empty'))
          return
        }
        await ctx.reply([
          ctx.t('auth.resumable.header', { count: items.length }),
          ...items.map((item, index) => formatResumableItem(ctx, item, index + 1))
        ].join('\n'))
        return
      }

      const requests = listOwnPendingRequests(ctx)
      if (requests.length === 0) {
        await ctx.reply(ctx.t('auth.list.empty'))
        return
      }
      await ctx.reply([
        ctx.t('auth.list.header', { count: requests.length }),
        ...requests.map((request, index) => formatRequestItem(ctx, request, index + 1))
      ].join('\n'))
    })
