import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initGrokAdapter } from './runtime/init'
import { createGrokSession } from './runtime/session'

export default defineAdapter({
  init: initGrokAdapter,
  query: createGrokSession
})
