import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initQwenCodeAdapter } from './runtime/init'
import { createQwenCodeSession } from './runtime/session'

export default defineAdapter({
  init: initQwenCodeAdapter,
  query: createQwenCodeSession
})
