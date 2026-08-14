import { createHash } from 'node:crypto'

import type { ChannelDeliveryTarget } from '@oneworks/types'

import { executeChannelSend } from '#~/channels/manual-send.js'
import { getDb } from '#~/db/index.js'

import type { ChannelContext } from '../@types'
import { defineMessages } from '../i18n'
import { command, optionalJsonArg, requiredJsonArg } from './command-system'
import { recordRoomChannelDelivery } from './room-delivery'
import { isRecord, normalizePayload, payloadSchema, resolveTarget, targetSchema } from './send-target'
import type { ChannelSendPayload, ChannelSendTargetInput } from './send-target'

defineMessages('zh', {
  'cmd.send.description': '向当前频道或明确指定的频道目标发送消息'
})

defineMessages('en', {
  'cmd.send.description': 'Send a message to the current channel or an explicit channel target'
})

const targetAuditKey = (target: ChannelDeliveryTarget) =>
  [
    target.channelType,
    target.channelKey,
    target.receiveIdType,
    target.receiveId,
    target.threadId ?? ''
  ].join(':')

const createSendOperation = (
  ctx: ChannelContext,
  commandRunId: string | undefined,
  message: ChannelSendPayload,
  target: ChannelDeliveryTarget
) => {
  const payloadHash = createHash('sha256').update(JSON.stringify(message)).digest('hex')
  const source = ctx.inbound.messageId ?? ctx.ingressRouterRunId ?? ctx.sessionId ?? ctx.commandText
  const invocationId = ctx.commandInvocationId ?? commandRunId ?? source
  return {
    operationId: `channel-send:${
      createHash('sha256')
        .update(JSON.stringify([invocationId, source, targetAuditKey(target), payloadHash]))
        .digest('hex')
    }`,
    payloadHash
  }
}

const updateCommandDestination = (commandRunId: string | undefined, target: ChannelDeliveryTarget) => {
  if (commandRunId == null) return
  const db = getDb()
  const run = db.getChannelCommandRun(commandRunId)
  if (run == null) return
  const metadata = run.metadata ?? {}
  const effect = metadata.effect != null && typeof metadata.effect === 'object' && !Array.isArray(metadata.effect)
    ? metadata.effect as Record<string, unknown>
    : {}
  db.updateChannelCommandRunMetadata(commandRunId, {
    ...metadata,
    deliveryTarget: target,
    effect: { ...effect, destinations: [targetAuditKey(target)] }
  })
}

export const sendCommands = () => [
  command<ChannelContext>('send')
    .description('cmd.send.description')
    .effect({ effect: 'external-write', operation: 'channel.send', risk: 'medium' })
    .argument(requiredJsonArg<ChannelSendPayload>('message', {
      schema: payloadSchema,
      parse: normalizePayload
    }))
    .argument(optionalJsonArg<ChannelSendTargetInput>('target', {
      schema: targetSchema,
      parse: (value) => {
        if (!isRecord(value)) throw new Error('target must be an object.')
        return value as ChannelSendTargetInput
      }
    }))
    .action(async ({ ctx, args: [message, target], commandRunId }) => {
      const resolvedTarget = resolveTarget(ctx, target)
      updateCommandDestination(commandRunId, resolvedTarget)
      const runtime = resolvedTarget.channelKey === ctx.channelKey
        ? {
          config: ctx.config,
          connection: ctx.connection,
          key: ctx.channelKey,
          status: ctx.connection == null ? 'error' as const : 'connected' as const,
          type: ctx.inbound.channelType
        }
        : ctx.resolveOutboundChannel?.(resolvedTarget.channelKey)
      if (runtime == null || runtime.status !== 'connected' || runtime.connection == null) {
        const error = `Channel account ${resolvedTarget.channelKey} is not connected.`
        await recordRoomChannelDelivery(ctx, { error, message, status: 'failed', target: resolvedTarget })
        throw new Error(error)
      }
      if (runtime.type !== resolvedTarget.channelType) {
        const error = `Channel target type mismatch for ${resolvedTarget.channelKey}.`
        await recordRoomChannelDelivery(ctx, { error, message, status: 'failed', target: resolvedTarget })
        throw new Error(error)
      }
      const operation = createSendOperation(ctx, commandRunId, message, resolvedTarget)
      const claim = getDb().claimChannelOutboundOperation({
        channelKey: runtime.key,
        channelType: runtime.type,
        ...(commandRunId == null ? {} : { commandRunId }),
        operationId: operation.operationId,
        payloadHash: operation.payloadHash,
        target: resolvedTarget
      })
      if (!claim.claimed) {
        const status = claim.operation.status
        if (status === 'sent') return
        throw new Error(
          status === 'pending'
            ? 'This channel send operation is already pending; its delivery outcome may be indeterminate.'
            : 'This channel send operation already failed. Send a new message to retry explicitly.'
        )
      }
      const result = await executeChannelSend({
        channelKey: runtime.key,
        channelType: runtime.type,
        config: runtime.config,
        connection: runtime.connection,
        payload: message as ChannelSendPayload,
        sessionId: ctx.sessionId,
        target: resolvedTarget
      })
      if (!result.ok) {
        getDb().finishChannelOutboundOperation(operation.operationId, {
          error: result.message,
          status: 'failed'
        })
        await recordRoomChannelDelivery(ctx, {
          error: result.message,
          message,
          operationId: operation.operationId,
          status: 'failed',
          target: resolvedTarget
        })
        throw new Error(result.message)
      }
      getDb().finishChannelOutboundOperation(operation.operationId, {
        ...(result.messageId != null ? { providerMessageId: result.messageId } : {}),
        ...(result.navigation != null ? { navigation: result.navigation } : {}),
        status: 'sent'
      })
      await recordRoomChannelDelivery(ctx, {
        message,
        ...(result.messageId != null ? { messageId: result.messageId } : {}),
        ...(result.navigation != null ? { navigation: result.navigation } : {}),
        operationId: operation.operationId,
        status: 'sent',
        target: resolvedTarget
      })
    })
]
