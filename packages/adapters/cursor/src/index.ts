import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initCursorAdapter } from './runtime/init'
import { createCursorSession } from './runtime/session'

export default defineAdapter({
  init: initCursorAdapter,
  query: createCursorSession
})
