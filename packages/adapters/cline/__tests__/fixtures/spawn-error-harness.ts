import '../../src/adapter-config'

import { join } from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'

import { createClineSession } from '../../src/runtime/session'

const events: AdapterOutputEvent[] = []
const cwd = process.cwd()
const ctx: AdapterCtx = {
  ctxId: 'cline-spawn-error-harness',
  cwd,
  env: {
    __ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__: join(cwd, 'definitely-missing-cline-binary'),
    __ONEWORKS_PROJECT_REAL_HOME__: cwd
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: join(cwd, '.oo', 'caches', 'unused.json') })
  },
  logger: {
    stream: new PassThrough(),
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
    sessionId: 'cline-spawn-error-harness',
    description: 'DO NOT EXPOSE THIS PROMPT',
    onEvent: event => events.push(event)
  })
  process.stdout.write(JSON.stringify(events))
}

void main()
