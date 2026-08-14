import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initGooseAdapter } from './runtime/init'
import { createGooseRedactor } from './runtime/redaction'
import { createGooseSession } from './runtime/session'

export default defineAdapter({
  sanitizeRuntimeArtifact: (ctx, value) => (
    createGooseRedactor(
      ctx.env as NodeJS.ProcessEnv,
      [ctx.configs, ctx.configState]
    ).redactArtifactValue(value)
  ),
  init: initGooseAdapter,
  query: createGooseSession
})
