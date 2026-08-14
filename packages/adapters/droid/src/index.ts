import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initDroidAdapter } from './runtime/init'
import { createDroidSession } from './runtime/session'

export default defineAdapter({
  init: initDroidAdapter,
  query: createDroidSession
})
