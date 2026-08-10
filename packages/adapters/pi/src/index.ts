import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initPiAdapter } from './runtime/session/init'
import { createPiSession } from './runtime/session/session'

export default defineAdapter({
  init: initPiAdapter,
  query: createPiSession
})
