/* eslint-disable max-lines -- Relay server env parsing is centralized for all deployment targets. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { readCustomSsoClients } from './config-sso.js'
import { parseRelayStorageDriver } from './storage/drivers.js'
import type {
  RelayEmailConfig,
  RelayEmailProviderKind,
  RelayOAuthClient,
  RelayServerArgs,
  RelayTurnstileMode
} from './types.js'
import { VERSION } from './types.js'

export type RelayConfigEnv = Record<string, string | undefined>

export const DEFAULT_DATA_PATH = join(homedir(), '.oneworks', 'relay-server', 'data.json')
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_DEVICE_ONLINE_TTL_MS = 60 * 1000
const DEFAULT_EMAIL_CODE_TTL_MS = 10 * 60 * 1000
const DEFAULT_EMAIL_LOGO_URL = 'https://oneworks.cloud/pwa/pwa-icon-192.png'
const DEFAULT_EMAIL_RESEND_COOLDOWN_MS = 60 * 1000

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

const readNonNegativeInteger = (value: string | undefined, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

const readBoolean = (value: string | undefined, fallback: boolean) => {
  if (value == null || value.trim() === '') return fallback
  return !new Set(['0', 'false', 'no', 'off']).has(value.trim().toLowerCase())
}

const readStringList = (value: string | undefined) => (
  value == null
    ? []
    : value.split(/[,\s]+/u).map(item => item.trim().toLowerCase()).filter(item => item !== '')
)

const readEmailLogoUrl = (value: string | undefined) => {
  if (value == null) return DEFAULT_EMAIL_LOGO_URL
  const logoUrl = value.trim()
  if (logoUrl === '') return undefined
  return new Set(['0', 'false', 'no', 'none', 'off']).has(logoUrl.toLowerCase()) ? undefined : logoUrl
}

const readStorageDriver = (env: RelayConfigEnv) => {
  return parseRelayStorageDriver(env.ONEWORKS_RELAY_STORAGE_DRIVER)
}

const readOAuthClients = (env: RelayConfigEnv) => {
  const oauth: Record<string, RelayOAuthClient | undefined> = {
    github: env.ONEWORKS_RELAY_GITHUB_CLIENT_ID && env.ONEWORKS_RELAY_GITHUB_CLIENT_SECRET
      ? {
        clientId: env.ONEWORKS_RELAY_GITHUB_CLIENT_ID,
        clientSecret: env.ONEWORKS_RELAY_GITHUB_CLIENT_SECRET
      }
      : undefined,
    google: env.ONEWORKS_RELAY_GOOGLE_CLIENT_ID && env.ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET
      ? {
        clientId: env.ONEWORKS_RELAY_GOOGLE_CLIENT_ID,
        clientSecret: env.ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET
      }
      : undefined
  }
  for (const provider of readCustomSsoClients(env)) {
    oauth[provider.id] = provider.client
  }
  return oauth
}

const readEmailProvider = (value: string | undefined): RelayEmailProviderKind => {
  const provider = value?.trim().toLowerCase() ?? ''
  if (provider === '' || provider === 'disabled') return 'disabled'
  if (provider === 'resend') return 'resend'
  throw new Error(`Unsupported ONEWORKS_RELAY_EMAIL_PROVIDER "${value}". Supported values: disabled, resend.`)
}

const readTurnstileMode = (value: string | undefined): RelayTurnstileMode => {
  const mode = value?.trim().toLowerCase() ?? ''
  if (mode === '' || mode === 'auto') return 'auto'
  if (mode === 'off' || mode === 'required') return mode
  throw new Error(
    `Unsupported ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE "${value}". Supported values: auto, off, required.`
  )
}

const readEmailWindow = (
  env: RelayConfigEnv,
  prefix: string,
  defaults: {
    max: number
    windowSeconds: number
  }
) => ({
  max: readNonNegativeInteger(env[`${prefix}_MAX`], defaults.max),
  windowMs: readPositiveInteger(env[`${prefix}_WINDOW_SECONDS`], defaults.windowSeconds) * 1000
})

const readEmailConfig = (env: RelayConfigEnv): RelayEmailConfig => ({
  from: env.ONEWORKS_RELAY_EMAIL_FROM,
  logoUrl: readEmailLogoUrl(env.ONEWORKS_RELAY_EMAIL_LOGO_URL),
  provider: readEmailProvider(env.ONEWORKS_RELAY_EMAIL_PROVIDER),
  resendApiKey: env.ONEWORKS_RELAY_RESEND_API_KEY,
  risk: {
    allowDomains: readStringList(env.ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST),
    blockDomains: readStringList(env.ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST),
    codeTtlMs: readPositiveInteger(
      env.ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS,
      DEFAULT_EMAIL_CODE_TTL_MS / 1000
    ) * 1000,
    dailyBudget: readNonNegativeInteger(env.ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET, 500),
    disposableBlocklist: readBoolean(env.ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED, true),
    enabled: readBoolean(env.ONEWORKS_RELAY_EMAIL_RISK_ENABLED, true),
    monthlyBudget: readNonNegativeInteger(env.ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET, 10_000),
    perDomain: readEmailWindow(env, 'ONEWORKS_RELAY_EMAIL_RISK_DOMAIN', {
      max: 100,
      windowSeconds: 60 * 60
    }),
    perEmail: readEmailWindow(env, 'ONEWORKS_RELAY_EMAIL_RISK_EMAIL', {
      max: 3,
      windowSeconds: 60 * 60
    }),
    perIp: readEmailWindow(env, 'ONEWORKS_RELAY_EMAIL_RISK_IP', {
      max: 30,
      windowSeconds: 60 * 60
    }),
    resendCooldownMs: readPositiveInteger(
      env.ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS,
      DEFAULT_EMAIL_RESEND_COOLDOWN_MS / 1000
    ) * 1000
  },
  turnstile: {
    mode: readTurnstileMode(env.ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE),
    secretKey: env.ONEWORKS_RELAY_TURNSTILE_SECRET_KEY,
    verifyUrl: env.ONEWORKS_RELAY_TURNSTILE_VERIFY_URL
  }
})

export const parseRelayServerArgs = (
  argv: string[],
  env: RelayConfigEnv = process.env
): RelayServerArgs => {
  const args: RelayServerArgs = {
    host: env.ONEWORKS_RELAY_HOST || '127.0.0.1',
    port: Number(env.ONEWORKS_RELAY_PORT || '8788'),
    dataPath: env.ONEWORKS_RELAY_DATA_PATH || DEFAULT_DATA_PATH,
    adminToken: env.ONEWORKS_RELAY_ADMIN_TOKEN || '',
    allowOrigin: env.ONEWORKS_RELAY_ALLOW_ORIGIN || '*',
    deviceMetadataSecret: env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET || undefined,
    publicBaseUrl: env.ONEWORKS_RELAY_PUBLIC_URL || undefined,
    sessionTtlMs: readPositiveInteger(env.ONEWORKS_RELAY_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_MS / 1000) *
      1000,
    deviceOnlineTtlMs: readPositiveInteger(
      env.ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS,
      DEFAULT_DEVICE_ONLINE_TTL_MS / 1000
    ) * 1000,
    embeddedAdminUi: true,
    email: readEmailConfig(env),
    storageDriver: readStorageDriver(env),
    oauth: readOAuthClients(env)
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--host' && next != null) {
      args.host = next
      index += 1
    } else if (arg === '--port' && next != null) {
      args.port = Number(next)
      index += 1
    } else if (arg === '--data' && next != null) {
      args.dataPath = next
      index += 1
    } else if (arg === '--admin-token' && next != null) {
      args.adminToken = next
      index += 1
    } else if (arg === '--storage-driver' && next != null) {
      args.storageDriver = parseRelayStorageDriver(next)
      index += 1
    }
  }

  return args
}

export const printRelayServerHelp = (
  write: (message: string) => void = message => process.stdout.write(message)
) => {
  write(`OneWorks Relay Server ${VERSION}

Usage:
  oneworks-relay-server [--host 0.0.0.0] [--port 8788] [--data ./relay.sqlite] [--admin-token token] [--storage-driver json|sqlite|postgres]

Environment:
  ONEWORKS_RELAY_HOST
  ONEWORKS_RELAY_PORT
  ONEWORKS_RELAY_DATA_PATH
  ONEWORKS_RELAY_ADMIN_TOKEN
  ONEWORKS_RELAY_DEVICE_METADATA_SECRET
  ONEWORKS_RELAY_ALLOW_ORIGIN
  ONEWORKS_RELAY_PUBLIC_URL
  ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS
  ONEWORKS_RELAY_SESSION_TTL_SECONDS
  ONEWORKS_RELAY_STORAGE_DRIVER
  ONEWORKS_RELAY_POSTGRES_URL
  ONEWORKS_RELAY_POSTGRES_POOL_MAX
  ONEWORKS_RELAY_LOG_LEVEL
  ONEWORKS_RELAY_EMAIL_PROVIDER
  ONEWORKS_RELAY_EMAIL_FROM
  ONEWORKS_RELAY_EMAIL_LOGO_URL
  ONEWORKS_RELAY_RESEND_API_KEY
  ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE
  ONEWORKS_RELAY_TURNSTILE_SECRET_KEY
  ONEWORKS_RELAY_TURNSTILE_VERIFY_URL
  ONEWORKS_RELAY_EMAIL_RISK_ENABLED
  ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS
  ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX
  ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS
  ONEWORKS_RELAY_EMAIL_RISK_IP_MAX
  ONEWORKS_RELAY_EMAIL_RISK_IP_WINDOW_SECONDS
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_MAX
  ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_WINDOW_SECONDS
  ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET
  ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET
  ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST
  ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST
  ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED
  ONEWORKS_RELAY_RATE_LIMIT_ENABLED
  ONEWORKS_RELAY_RATE_LIMIT_AUTH_MAX
  ONEWORKS_RELAY_RATE_LIMIT_AUTH_WINDOW_SECONDS
  ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_MAX
  ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_WINDOW_SECONDS
  ONEWORKS_RELAY_RATE_LIMIT_ADMIN_MUTATION_MAX
  ONEWORKS_RELAY_RATE_LIMIT_ADMIN_MUTATION_WINDOW_SECONDS
  ONEWORKS_RELAY_RATE_LIMIT_DEVICE_CLAIM_MAX
  ONEWORKS_RELAY_RATE_LIMIT_DEVICE_CLAIM_WINDOW_SECONDS
  ONEWORKS_RELAY_GITHUB_CLIENT_ID
  ONEWORKS_RELAY_GITHUB_CLIENT_SECRET
  ONEWORKS_RELAY_GOOGLE_CLIENT_ID
  ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET
  ONEWORKS_RELAY_SSO_PROVIDERS
`)
}
