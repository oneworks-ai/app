import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initDshAdapter } from './runtime/install'
import { createDshSession } from './runtime/session'

export default defineAdapter({
  init: initDshAdapter,
  query: createDshSession
})
