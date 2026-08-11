import { randomUUID } from 'node:crypto'

import type { ChannelConnectionOptions, ChannelWebhookRequest } from '@oneworks/core/channel'

import type { OneWorksChannelConfig } from '#~/types.js'
import {
  ONEWORKS_WEBHOOK_MAX_AGE_MS,
  ONEWORKS_WEBHOOK_NONCE_HEADER,
  ONEWORKS_WEBHOOK_SIGNATURE_HEADER,
  ONEWORKS_WEBHOOK_TIMESTAMP_HEADER,
  verifyOneWorksWebhookSignature
} from '#~/webhook-signature.js'

export const getHeaderValue = (
  headers: ChannelWebhookRequest['headers'],
  name: string
) => {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  const value = match?.[1]
  return Array.isArray(value) ? value[0] : value
}

export const ONEWORKS_PRODUCT_SIMULATION_HEADER = 'x-oneworks-product-simulation'

export const isLoopbackTransport = (request: ChannelWebhookRequest) => {
  const address = request.remoteAddress?.trim().toLowerCase()
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export const isLoopbackRequest = (request: ChannelWebhookRequest) => {
  const host = getHeaderValue(request.headers, 'host')?.trim()
  if (host == null || host === '') return false
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  } catch {
    return false
  }
  const loopbackHost = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
  return isLoopbackTransport(request) && loopbackHost
}

export const isProductSimulationRequest = (request: ChannelWebhookRequest) => {
  const marker = getHeaderValue(request.headers, ONEWORKS_PRODUCT_SIMULATION_HEADER)?.trim().toLowerCase()
  return isLoopbackTransport(request) && (marker === '1' || marker === 'true')
}

export const resolveSignedWebhook = (config: OneWorksChannelConfig, request: ChannelWebhookRequest) => {
  const secret = config.webhookSecret?.trim()
  if (secret == null || secret === '') return false

  const body = request.rawBody
  const nonce = getHeaderValue(request.headers, ONEWORKS_WEBHOOK_NONCE_HEADER)?.trim()
  const signature = getHeaderValue(request.headers, ONEWORKS_WEBHOOK_SIGNATURE_HEADER)?.trim()
  const timestamp = getHeaderValue(request.headers, ONEWORKS_WEBHOOK_TIMESTAMP_HEADER)?.trim()
  if (
    !(typeof body === 'string' || body instanceof Uint8Array) ||
    nonce == null ||
    signature == null ||
    timestamp == null
  ) {
    return undefined
  }

  return verifyOneWorksWebhookSignature({ body, nonce, secret, signature, timestamp })
}

interface LocalNonceState {
  expiresAt: number
  reservationExpiresAt?: number
  reservationId?: string
  status: 'consumed' | 'processing'
}

export const createWebhookNonceReservation = (options?: ChannelConnectionOptions) => {
  const localNonces = new Map<string, LocalNonceState>()
  return async (request: ChannelWebhookRequest, now: number) => {
    const nonce = getHeaderValue(request.headers, ONEWORKS_WEBHOOK_NONCE_HEADER)!.trim()
    const timestamp = Number(getHeaderValue(request.headers, ONEWORKS_WEBHOOK_TIMESTAMP_HEADER))
    const expiresAt = timestamp + ONEWORKS_WEBHOOK_MAX_AGE_MS
    // A live signed request must never be reclaimed while its signature can still be replayed.
    const reservationExpiresAt = expiresAt
    const reservationId = randomUUID()
    if (options?.channelKey != null && options.webhookNonceStore != null) {
      const input = {
        channelKey: options.channelKey,
        expiresAt,
        nonce
      }
      const reserved = await options.webhookNonceStore.reserve({
        ...input,
        channelType: 'oneworks',
        reservationExpiresAt,
        reservationId
      })
      if (!reserved) return undefined
      return {
        commit: async () => await options.webhookNonceStore!.commit({ ...input, reservationId }),
        release: async () =>
          await options.webhookNonceStore!.release({
            channelKey: input.channelKey,
            nonce,
            reservationId
          })
      }
    }

    for (const [storedNonce, state] of localNonces) {
      if (state.expiresAt <= now) localNonces.delete(storedNonce)
    }
    const existing = localNonces.get(nonce)
    if (
      existing?.status === 'consumed' ||
      (existing?.status === 'processing' && (existing.reservationExpiresAt ?? Infinity) > now)
    ) return undefined
    localNonces.set(nonce, { expiresAt, reservationExpiresAt, reservationId, status: 'processing' })
    return {
      commit: () => {
        const current = localNonces.get(nonce)
        if (current?.reservationId === reservationId) {
          localNonces.set(nonce, { expiresAt, status: 'consumed' })
        }
      },
      release: () => {
        if (localNonces.get(nonce)?.reservationId === reservationId) localNonces.delete(nonce)
      }
    }
  }
}
