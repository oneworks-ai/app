import type { AdapterCtx } from '@oneworks/types'

import { assertAdapterAccountPathSegment } from './adapter-account-path-validation'
import {
  resolveAccountStoragePaths,
  resolveAdapterAccountReadRoots,
  resolveExactLegacyAccountDirSync
} from './adapter-account-paths'
import { resolvePublishedAccountGeneration } from './adapter-account-storage'

export const resolveAdapterAccountReadDirs = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => {
  const accountSegment = assertAdapterAccountPathSegment(account, 'account')
  return resolveAdapterAccountReadRoots(cwd, env, adapter).map(root => (
    resolvePublishedAccountGeneration(root, adapter, accountSegment) ??
      resolveExactLegacyAccountDirSync(cwd, env, adapter, accountSegment) ??
      resolveAccountStoragePaths(root, accountSegment).accountStateDir
  ))
}

export const resolveAdapterAccountDir = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => resolveAdapterAccountReadDirs(cwd, env, adapter, account)[0]!
