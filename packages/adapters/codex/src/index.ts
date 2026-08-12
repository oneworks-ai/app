import './adapter-config'

import { defineAdapter } from '@oneworks/types'

import { createCodexModelSharingBridge } from './model-sharing'
import { getCodexAccountDetail, getCodexAccounts, manageCodexAccount } from './runtime/accounts'
import { initCodexAdapter } from './runtime/init'
import { createCodexSession } from './runtime/session'
import { collectCodexUsage } from './runtime/usage'
import { executeCodexSharedModel } from './shared-model'

export default defineAdapter({
  init: initCodexAdapter,
  getUsage: collectCodexUsage,
  getAccounts: getCodexAccounts,
  getAccountDetail: getCodexAccountDetail,
  manageAccount: manageCodexAccount,
  createModelSharingBridge: createCodexModelSharingBridge,
  executeSharedModel: executeCodexSharedModel,
  query: createCodexSession
})
