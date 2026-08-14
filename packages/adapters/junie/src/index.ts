import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initJunieAdapter } from './runtime/init'
import { createJunieSession } from './runtime/session'

export default defineAdapter({
  init: initJunieAdapter,
  query: createJunieSession
})
