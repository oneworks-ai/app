import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { getClaudeAccountDetail, getClaudeAccounts, manageClaudeAccount } from './claude/accounts'
import { initClaudeCodeAdapter } from './claude/init'
import { createClaudeSession } from './claude/session'

export default defineAdapter({
  init: initClaudeCodeAdapter,
  getAccounts: getClaudeAccounts,
  getAccountDetail: getClaudeAccountDetail,
  manageAccount: manageClaudeAccount,
  query: createClaudeSession
})
