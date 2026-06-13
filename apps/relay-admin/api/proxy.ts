import { Buffer } from 'node:buffer'
import process from 'node:process'

import {
  buildRelayProxyUrl,
  createRelayProxyHeaders,
  createRelayProxyResponseHeaders
} from '../src/platform/relayProxy'

const readRequestBody = async (req: AsyncIterable<unknown>) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer))
  }
  return Buffer.concat(chunks)
}

const toHeaders = (headers: Record<string, string | string[] | undefined>) => {
  const next = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item)
    } else if (value != null) {
      next.set(key, value)
    }
  }
  return next
}

const readRelayPath = (query: Record<string, unknown>, fallback = '/') => {
  const value = query.relay_path
  if (Array.isArray(value)) return value.join('/')
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

export default async function handler(req: any, res: any) {
  try {
    const requestUrl = `https://${req.headers.host ?? 'relay-admin.local'}${req.url ?? '/'}`
    const relayPath = readRelayPath(req.query ?? {})
    const method = String(req.method ?? 'GET').toUpperCase()
    const headers = toHeaders(req.headers ?? {})
    const target = buildRelayProxyUrl(relayPath, requestUrl, process.env)
    const upstream = await fetch(target, {
      body: method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req),
      headers: createRelayProxyHeaders(headers),
      method,
      redirect: 'manual'
    })
    res.statusCode = upstream.status
    for (const [key, value] of createRelayProxyResponseHeaders(upstream.headers).entries()) {
      res.setHeader(key, value)
    }
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
  }
}
