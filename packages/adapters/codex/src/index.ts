import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { getCodexAccountDetail, getCodexAccounts, manageCodexAccount } from './runtime/accounts'
import { initCodexAdapter } from './runtime/init'
import { createCodexSession } from './runtime/session'

export default defineAdapter({
  supportedProjectConfigPolicies: ['include', 'global-only'] as const,
  init: initCodexAdapter,
  getAccounts: getCodexAccounts,
  getAccountDetail: getCodexAccountDetail,
  manageAccount: manageCodexAccount,
  query: createCodexSession
})
