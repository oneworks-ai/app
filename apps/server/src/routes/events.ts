import { PassThrough } from 'node:stream'

import Router from '@koa/router'

import type { ClientEventChannel } from '#~/services/client-events.js'
import { subscribeClientEvents } from '#~/services/client-events.js'
import { safeJsonStringify } from '#~/utils/json.js'

const knownChannels = new Set<ClientEventChannel>(['agent-rooms', 'config', 'sessions', 'workspace'])
const HEARTBEAT_INTERVAL_MS = 25_000

const parseChannels = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  const channels = new Set<ClientEventChannel>()
  for (const rawChannel of value.split(',')) {
    const channel = rawChannel.trim()
    if (knownChannels.has(channel as ClientEventChannel)) {
      channels.add(channel as ClientEventChannel)
    }
  }

  return channels.size === 0 ? undefined : channels
}

export function eventsRouter(): Router {
  const router = new Router()

  router.get(['/', ''], (ctx) => {
    const channels = parseChannels(ctx.query.channels)
    const stream = new PassThrough()
    let disposed = false

    ctx.state.skipApiEnvelope = true
    ctx.status = 200
    ctx.type = 'text/event-stream'
    ctx.set('Cache-Control', 'no-cache, no-transform')
    ctx.set('Connection', 'keep-alive')
    ctx.set('X-Accel-Buffering', 'no')
    ctx.body = stream

    const write = (value: string) => {
      if (disposed) return
      stream.write(value)
    }
    const unsubscribe = subscribeClientEvents((event) => {
      write(`id: ${event.id}\n`)
      write(`event: ${event.type}\n`)
      write(`data: ${safeJsonStringify(event)}\n\n`)
    }, { channels })
    const heartbeat = setInterval(() => {
      write(`: heartbeat ${Date.now()}\n\n`)
    }, HEARTBEAT_INTERVAL_MS)

    write(': connected\n\n')

    const dispose = () => {
      if (disposed) return
      disposed = true
      clearInterval(heartbeat)
      unsubscribe()
      stream.end()
    }
    ctx.req.on('close', dispose)
    ctx.req.on('aborted', dispose)
  })

  return router
}
