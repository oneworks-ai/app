import { parseRelayServerArgs } from '../src/config.js'
import { createRelayHandler } from '../src/server.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'

const args = {
  ...parseRelayServerArgs([]),
  dataPath: process.env.ONEWORKS_RELAY_POSTGRES_URL || process.env.DATABASE_URL || '',
  embeddedAdminUi: false,
  host: '0.0.0.0',
  port: 0,
  storageDriver: 'postgres' as const
}

const handler = createRelayHandler(args, undefined, createRelayStoreRepository(args))

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
