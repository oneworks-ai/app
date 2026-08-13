import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initKiroAdapter } from './runtime/init'
import { createKiroSession } from './runtime/session'

export default defineAdapter({
  init: initKiroAdapter,
  query: createKiroSession
})
