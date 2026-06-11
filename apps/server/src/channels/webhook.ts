import type { ChannelWebhookRequest, ChannelWebhookResponse } from '@oneworks/core/channel'

import { logger } from '#~/utils/logger.js'

import { getChannelManager } from './index'

export interface HandleChannelWebhookInput extends ChannelWebhookRequest {
  channelType: string
  channelKey: string
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const handleChannelWebhook = async (
  input: HandleChannelWebhookInput
): Promise<ChannelWebhookResponse> => {
  const channelManager = getChannelManager()
  if (channelManager == null) {
    return {
      statusCode: 503,
      body: { error: 'channel manager is not initialized' }
    }
  }

  const state = channelManager.states.get(input.channelKey)
  if (state == null || state.type !== input.channelType) {
    return {
      statusCode: 404,
      body: { error: 'channel not found' }
    }
  }

  if (state.status !== 'connected' || state.connection == null) {
    return {
      statusCode: 503,
      body: { error: 'channel is not connected' }
    }
  }

  if (state.config?.enableWebhook === false) {
    return {
      statusCode: 404,
      body: { error: 'channel webhook is disabled' }
    }
  }

  if (typeof state.connection.handleWebhook !== 'function') {
    return {
      statusCode: 404,
      body: { error: 'channel does not support webhooks' }
    }
  }

  try {
    return await state.connection.handleWebhook({
      method: input.method,
      headers: input.headers,
      query: input.query,
      body: input.body
    })
  } catch (error) {
    logger.error({
      channelKey: input.channelKey,
      channelType: input.channelType,
      error: getErrorMessage(error)
    }, '[channels] channel webhook handling failed')
    return {
      statusCode: 500,
      body: { error: 'channel webhook handling failed' }
    }
  }
}
