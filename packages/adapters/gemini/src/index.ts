import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initGeminiAdapter } from './runtime/init'
import { createGeminiSession } from './runtime/session'

export default defineAdapter({
  init: initGeminiAdapter,
  query: createGeminiSession
})
