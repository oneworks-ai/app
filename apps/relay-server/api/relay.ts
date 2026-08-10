import process from 'node:process'

import { parseRelayServerArgs } from '../src/config.js'
import type { RelayConfigEnv } from '../src/config.js'
import { createRelayHandler } from '../src/server.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'

export const VERCEL_DEVICE_CONTROL_LONG_POLL_MAX_WAIT_MS = 50_000
export const VERCEL_DEVICE_CONTROL_IDLE_RETRY_MS = 250_000
export const VERCEL_DEVICE_CONTROL_MAX_STORAGE_READS_PER_POLL = 11
export const VERCEL_DEVICE_CONTROL_MAX_DAILY_INVOCATIONS = 300
export const VERCEL_DEVICE_CONTROL_MAX_DAILY_STORAGE_READS = 3_300

export const getVercelDeviceControlDailyBudget = (
  longPollMaxWaitMs = VERCEL_DEVICE_CONTROL_LONG_POLL_MAX_WAIT_MS,
  idleRetryMs = VERCEL_DEVICE_CONTROL_IDLE_RETRY_MS,
  storageReadsPerPoll = VERCEL_DEVICE_CONTROL_MAX_STORAGE_READS_PER_POLL
) => {
  const cycleMs = longPollMaxWaitMs + idleRetryMs
  const invocations = Math.ceil((24 * 60 * 60_000) / cycleMs)
  return {
    functionSeconds: (invocations * longPollMaxWaitMs) / 1_000,
    invocations,
    readsPerPoll: storageReadsPerPoll,
    storageReads: invocations * storageReadsPerPoll
  }
}

const publicOrigin = (value: string | undefined) => {
  if (value == null || value.trim() === '') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.origin : undefined
  } catch {
    return undefined
  }
}
export const createVercelRelayArgs = (env: RelayConfigEnv = process.env) => {
  const configuredPublicBaseUrl = publicOrigin(env.ONEWORKS_RELAY_PUBLIC_URL) ??
    publicOrigin(env.VERCEL_URL == null ? undefined : `https://${env.VERCEL_URL}`)
  const resolvedEnv = configuredPublicBaseUrl == null
    ? env
    : { ...env, ONEWORKS_RELAY_PUBLIC_URL: configuredPublicBaseUrl }
  const { deviceTransport: _parsedDeviceTransport, ...parsedArgs } = parseRelayServerArgs([], resolvedEnv)
  return {
    ...parsedArgs,
    buildSha: parsedArgs.buildSha ?? (env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined),
    dataPath: env.ONEWORKS_RELAY_POSTGRES_URL || env.DATABASE_URL || '',
    embeddedAdminUi: false,
    host: '0.0.0.0',
    port: 0,
    storageDriver: 'postgres' as const,
    ...(configuredPublicBaseUrl == null ? {} : {
      // A 50s body poll plus its 250s idle retry must remain visible throughout the cycle.
      deviceOnlineTtlMs: VERCEL_DEVICE_CONTROL_LONG_POLL_MAX_WAIT_MS + VERCEL_DEVICE_CONTROL_IDLE_RETRY_MS + 60_000,
      publicBaseUrl: configuredPublicBaseUrl,
      deviceTransport: {
        apiBaseUrl: new URL('/', configuredPublicBaseUrl).toString(),
        idleRetryMs: VERCEL_DEVICE_CONTROL_IDLE_RETRY_MS,
        longPollMaxWaitMs: VERCEL_DEVICE_CONTROL_LONG_POLL_MAX_WAIT_MS,
        mode: 'long-poll' as const,
        version: 2 as const
      }
    })
  }
}

const args = createVercelRelayArgs()

const repository = createRelayStoreRepository(args)
const handler = createRelayHandler(args, undefined, repository)

const rewriteRequestUrl = (req: { query?: Record<string, unknown>; url?: string }) => {
  const rawRelayPath = req.query?.relay_path
  const relayPath = Array.isArray(rawRelayPath)
    ? rawRelayPath.map(String).join('/')
    : typeof rawRelayPath === 'string' && rawRelayPath.trim() !== ''
    ? rawRelayPath
    : '/'
  const source = new URL(req.url ?? '/', 'https://relay.vercel.local')
  source.searchParams.delete('relay_path')
  req.url = `${relayPath.startsWith('/') ? relayPath : `/${relayPath}`}${source.search}`
}

export default async function relayServerVercelHandler(req: any, res: any) {
  rewriteRequestUrl(req)
  await handler(req, res)
}
