import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { getCodexAccountDetail, getCodexAccounts, manageCodexAccount } from './runtime/accounts'
import { initCodexAdapter } from './runtime/init'
import { createCodexSession } from './runtime/session'
import { collectCodexUsage } from './runtime/usage'

export default defineAdapter({
  init: initCodexAdapter,
  getUsage: collectCodexUsage,
  getAccounts: getCodexAccounts,
  getAccountDetail: getCodexAccountDetail,
  manageAccount: manageCodexAccount,
  query: createCodexSession
})
