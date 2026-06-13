import { parseRelayServerArgs } from '../src/config.js'
import type { RelayConfigEnv } from '../src/config.js'
import { createRelayFetchHandler } from '../src/platform/fetch-handler.js'
import { createDurableObjectRelayStoreRepository } from '../src/storage/durable-object.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'

interface RelayDurableObjectNamespace {
  get: (id: unknown) => { fetch: (request: Request) => Promise<Response> }
  idFromName: (name: string) => unknown
}

interface RelayCloudflareEnv {
  ONEWORKS_RELAY_ADMIN_TOKEN?: string
  ONEWORKS_RELAY_ALLOW_ORIGIN?: string
  ONEWORKS_RELAY_DEVICE_METADATA_SECRET?: string
  ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS?: string
  ONEWORKS_RELAY_GITHUB_CLIENT_ID?: string
  ONEWORKS_RELAY_GITHUB_CLIENT_SECRET?: string
  ONEWORKS_RELAY_GOOGLE_CLIENT_ID?: string
  ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET?: string
  ONEWORKS_RELAY_INSTANCE_ID?: string
  ONEWORKS_RELAY_PUBLIC_URL?: string
  ONEWORKS_RELAY_SESSION_TTL_SECONDS?: string
  ONEWORKS_RELAY_SSO_PROVIDERS?: string
  RELAY_OBJECT: RelayDurableObjectNamespace
}

const envRecord = (env: RelayCloudflareEnv): RelayConfigEnv => ({
  ONEWORKS_RELAY_ADMIN_TOKEN: env.ONEWORKS_RELAY_ADMIN_TOKEN,
  ONEWORKS_RELAY_ALLOW_ORIGIN: env.ONEWORKS_RELAY_ALLOW_ORIGIN,
  ONEWORKS_RELAY_DEVICE_METADATA_SECRET: env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET,
  ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS: env.ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS,
  ONEWORKS_RELAY_GITHUB_CLIENT_ID: env.ONEWORKS_RELAY_GITHUB_CLIENT_ID,
  ONEWORKS_RELAY_GITHUB_CLIENT_SECRET: env.ONEWORKS_RELAY_GITHUB_CLIENT_SECRET,
  ONEWORKS_RELAY_GOOGLE_CLIENT_ID: env.ONEWORKS_RELAY_GOOGLE_CLIENT_ID,
  ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET: env.ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET,
  ONEWORKS_RELAY_PUBLIC_URL: env.ONEWORKS_RELAY_PUBLIC_URL,
  ONEWORKS_RELAY_SESSION_TTL_SECONDS: env.ONEWORKS_RELAY_SESSION_TTL_SECONDS,
  ONEWORKS_RELAY_SSO_PROVIDERS: env.ONEWORKS_RELAY_SSO_PROVIDERS
})

const argsFromEnv = (env: RelayCloudflareEnv) => ({
  ...parseRelayServerArgs([], envRecord(env)),
  dataPath: 'cloudflare-durable-object',
  embeddedAdminUi: false,
  host: '0.0.0.0',
  port: 0,
  storageDriver: 'cloudflare-do' as const
})

export class RelayDurableObject {
  private readonly handler: (request: Request) => Promise<Response>

  constructor(state: { storage: RelayDurableObjectStorage }, env: RelayCloudflareEnv) {
    this.handler = createRelayFetchHandler(argsFromEnv(env), {
      storeRepository: createDurableObjectRelayStoreRepository(state.storage)
    })
  }

  async fetch(request: Request) {
    return await this.handler(request)
  }
}

export default {
  async fetch(request: Request, env: RelayCloudflareEnv) {
    const id = env.RELAY_OBJECT.idFromName(env.ONEWORKS_RELAY_INSTANCE_ID ?? 'main')
    return await env.RELAY_OBJECT.get(id).fetch(request)
  }
}
