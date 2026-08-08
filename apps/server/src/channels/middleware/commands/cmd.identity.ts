import { getDb } from '#~/db/index.js'
import type { CanonicalUserRow, ChannelAccountRow } from '#~/db/index.js'

import type { ChannelContext } from '../@types'
import { buildWhoamiLines } from './cmd.general'
import { command, optionalArg } from './command-system'
import './identity-messages'

const LINK_CODE_TTL_MS = 10 * 60 * 1000

const resolveCurrentAccount = (ctx: ChannelContext): ChannelAccountRow | undefined => {
  if (ctx.actor?.account != null) return ctx.actor.account
  const senderId = ctx.inbound.senderId?.trim()
  if (senderId == null || senderId === '') return undefined
  return getDb().upsertChannelAccount({
    issuerKey: ctx.channelKey,
    channelType: ctx.inbound.channelType,
    accountId: senderId
  })
}

const resolveCurrentUser = (ctx: ChannelContext, account: ChannelAccountRow): CanonicalUserRow | undefined =>
  ctx.actor?.user ?? getDb().resolveCanonicalUserByChannelAccount(account.issuerKey, account.accountId)

const ensureCurrentUser = (ctx: ChannelContext, account: ChannelAccountRow) => {
  const existing = resolveCurrentUser(ctx, account)
  if (existing != null) return existing

  const user = getDb().ensureCanonicalUser({
    displayName: account.displayName ?? ctx.inbound.senderId ?? account.accountId
  })
  if (user != null) {
    getDb().linkChannelAccountToUser({
      issuerKey: account.issuerKey,
      channelType: account.channelType,
      accountId: account.accountId,
      userId: user.id,
      source: 'self_claim',
      status: 'verified'
    })
  }
  return user
}

const formatAccountLine = (account: ChannelAccountRow) => {
  const label = account.displayName == null || account.displayName.trim() === ''
    ? ''
    : ` | ${account.displayName.trim()}`
  return `- ${account.channelType}/${account.issuerKey}:${account.accountId} | ${account.accountKey}${label}`
}

const createLinkCode = async (ctx: ChannelContext, account: ChannelAccountRow) => {
  const user = ensureCurrentUser(ctx, account)
  if (user == null) {
    await ctx.reply(ctx.t('identity.senderMissing'))
    return
  }

  const code = getDb().createChannelIdentityLinkCode({
    userId: user.id,
    sourceChannelType: account.channelType,
    sourceIssuerKey: account.issuerKey,
    sourceAccountId: account.accountId,
    expiresAt: Date.now() + LINK_CODE_TTL_MS,
    metadata: {
      channelId: ctx.inbound.channelId,
      channelKey: ctx.channelKey,
      channelLinkName: ctx.channelLink?.name,
      messageId: ctx.inbound.messageId
    }
  })
  if (code == null) {
    await ctx.reply(ctx.t('system.executionFailed'))
    return
  }

  await ctx.reply([
    ctx.t('identity.link.created', {
      code: code.code,
      minutes: Math.ceil(LINK_CODE_TTL_MS / 60_000),
      userId: user.id
    }),
    ctx.t('identity.link.note')
  ].join('\n'))
}

const consumeLinkCode = async (ctx: ChannelContext, account: ChannelAccountRow, code: string) => {
  const result = getDb().consumeChannelIdentityLinkCode({
    code,
    targetChannelType: account.channelType,
    targetIssuerKey: account.issuerKey,
    targetAccountId: account.accountId
  })

  switch (result.status) {
    case 'consumed':
      await ctx.reply([
        ctx.t('identity.link.consumed', { userId: result.link?.userId ?? result.code?.userId ?? '?' }),
        ctx.t('identity.link.note')
      ].join('\n'))
      return
    case 'already_linked':
      await ctx.reply(ctx.t('identity.link.alreadyLinked', {
        userId: result.existingLink?.userId ?? result.code?.userId ?? '?'
      }))
      return
    case 'conflict':
      await ctx.reply(ctx.t('identity.link.conflict', { userId: result.existingLink?.userId ?? '?' }))
      return
    case 'expired':
      await ctx.reply(ctx.t('identity.link.expired'))
      return
    case 'not_active':
      await ctx.reply(ctx.t('identity.link.notActive'))
      return
    case 'not_found':
      await ctx.reply(ctx.t('identity.link.notFound'))
  }
}

export const identityCommands = () => [
  command<ChannelContext>('identity')
    .description('cmd.identity.description')
    .subcommand(
      command<ChannelContext>('whoami')
        .description('cmd.identity.whoami.description')
        .action(async ({ ctx }) => {
          await ctx.reply(buildWhoamiLines(ctx).join('\n'))
        })
    )
    .subcommand(
      command<ChannelContext>('link')
        .description('cmd.identity.link.description')
        .argument(optionalArg('code', { description: 'cmd.identity.link.description' }))
        .action(async ({ ctx, args: [code] }) => {
          if (ctx.inbound.sessionType !== 'direct') {
            await ctx.reply(ctx.t('identity.link.directOnly'))
            return
          }
          const account = resolveCurrentAccount(ctx)
          if (account == null) {
            await ctx.reply(ctx.t('identity.senderMissing'))
            return
          }

          const normalizedCode = code?.trim()
          if (normalizedCode == null || normalizedCode === '') {
            await createLinkCode(ctx, account)
            return
          }
          await consumeLinkCode(ctx, account, normalizedCode)
        })
    )
    .subcommand(
      command<ChannelContext>('accounts')
        .description('cmd.identity.accounts.description')
        .action(async ({ ctx }) => {
          const account = resolveCurrentAccount(ctx)
          if (account == null) {
            await ctx.reply(ctx.t('identity.senderMissing'))
            return
          }
          const user = resolveCurrentUser(ctx, account)
          if (user == null) {
            await ctx.reply(ctx.t('identity.accounts.unlinked'))
            return
          }

          const accounts = getDb().listChannelAccountsForUser(user.id)
          if (accounts.length === 0) {
            await ctx.reply(ctx.t('identity.accounts.empty'))
            return
          }
          await ctx.reply([
            ctx.t('identity.accounts.header', { count: accounts.length, userId: user.id }),
            ...accounts.map(formatAccountLine)
          ].join('\n'))
        })
    )
    .build()
]
