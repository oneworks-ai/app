import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { readCustomSsoClients } from './config-sso.js'
import { parseRelayStorageDriver } from './storage/drivers.js'
import type { RelayOAuthClient, RelayServerArgs } from './types.js'
import { VERSION } from './types.js'

export type RelayConfigEnv = Record<string, string | undefined>

export const DEFAULT_DATA_PATH = join(homedir(), '.oneworks', 'relay-server', 'data.json')
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_DEVICE_ONLINE_TTL_MS = 60 * 1000

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
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
