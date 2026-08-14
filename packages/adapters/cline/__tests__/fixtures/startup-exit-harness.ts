import '../../src/adapter-config'

import process from 'node:process'
import { PassThrough } from 'node:stream'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createClineSession } from '../../src/runtime/session'

const events: AdapterOutputEvent[] = []
const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
const logs: string[] = []
const cwd = process.cwd()
const stream = new PassThrough()
stream.on('data', chunk => logs.push(chunk.toString()))
const ctx: AdapterCtx = {
  ctxId: 'cline-startup-exit-harness',
  cwd,
  env: {
    __ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__: '/usr/bin/true',
    __ONEWORKS_PROJECT_REAL_HOME__: cwd
  },
  cache: {
    get: async <K extends keyof Cache>(key: K) => cacheStore.get(key) as Cache[K] | undefined,
    set: async <K extends keyof Cache>(key: K, value: Cache[K]) => {
      cacheStore.set(key, value)
      return { cachePath: 'unused' }
    }
  },
  logger: {
    stream,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  },
  configs: [{ adapters: { cline: { cli: { source: 'path' } } } }, undefined]
}

const main = async () => {
  await createClineSession(ctx, {
    type: 'create',
    runtime: 'server',
    sessionId: 'cline-startup-exit-harness',
    description: 'STARTUP_HARNESS_SECRET',
    onEvent: event => events.push(event)
  })
  process.stdout.write(JSON.stringify({ cacheSize: cacheStore.size, events, logs }))
}

void main()
