import process from 'node:process'

import type { RelayEmailConfig } from '../types.js'

export type RelayTurnstileRejectCode =
  | 'turnstile_failed'
  | 'turnstile_not_configured'
  | 'turnstile_required'

export interface RelayTurnstileAccepted {
  allowed: true
}

export interface RelayTurnstileRejected {
  allowed: false
  code: RelayTurnstileRejectCode
  status: 400 | 503
}

export type RelayTurnstileDecision = RelayTurnstileAccepted | RelayTurnstileRejected

interface TurnstileSiteverifyResponse {
  success?: boolean
}

const DEFAULT_TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const isRelayTurnstileRequired = (config: RelayEmailConfig) => {
  if (config.turnstile.mode === 'off') return false
  if (config.turnstile.mode === 'required') return true
  return config.turnstile.secretKey != null ||
    config.provider === 'resend' ||
    process.env.NODE_ENV === 'production'
}

export const verifyRelayTurnstile = async (
  config: RelayEmailConfig,
  input: {
    ip: string
    token?: string
  }
): Promise<RelayTurnstileDecision> => {
  if (!isRelayTurnstileRequired(config)) return { allowed: true }
  if (config.turnstile.secretKey == null || config.turnstile.secretKey.trim() === '') {
    return {
      allowed: false,
      code: 'turnstile_not_configured',
      status: 503
    }
  }
  if (input.token == null || input.token.trim() === '') {
    return {
      allowed: false,
      code: 'turnstile_required',
      status: 400
    }
  }

  const body = new URLSearchParams({
    remoteip: input.ip,
    response: input.token,
    secret: config.turnstile.secretKey
  })
  const response = await fetch(config.turnstile.verifyUrl ?? DEFAULT_TURNSTILE_VERIFY_URL, {
    body,
    method: 'POST'
  })
  if (!response.ok) {
    return {
      allowed: false,
      code: 'turnstile_failed',
      status: 400
    }
  }
  const payload = await response.json() as TurnstileSiteverifyResponse
  return payload.success === true
    ? { allowed: true }
    : {
      allowed: false,
      code: 'turnstile_failed',
      status: 400
    }
}
