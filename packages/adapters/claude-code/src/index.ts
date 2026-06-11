import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { initClaudeCodeAdapter } from './claude/init'
import { createClaudeSession } from './claude/session'

export default defineAdapter({
  init: initClaudeCodeAdapter,
  query: createClaudeSession
})
