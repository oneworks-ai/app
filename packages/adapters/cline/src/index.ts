import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { createClineSession } from './runtime/session'

export default defineAdapter({
  query: createClineSession
})
