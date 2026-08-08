import type { AdapterCtx } from '@oneworks/types'

import { assertSecureDirectory, identitiesMatch } from './adapter-account-fs'
import { resolveExactLegacyAccountDirSync } from './adapter-account-paths'

export const readExactLegacyAccountIdentity = async (params: {
  account: string
  adapter: string
  cwd: string
  env: AdapterCtx['env']
}) => {
  const path = resolveExactLegacyAccountDirSync(params.cwd, params.env, params.adapter, params.account)
  if (path == null) return undefined
  const identity = await assertSecureDirectory(path, 'Legacy adapter account directory')
  return identity == null ? undefined : { identity, path }
}

export const assertExactLegacyAccountIdentity = async (params: {
  account: string
  adapter: string
  cwd: string
  env: AdapterCtx['env']
  expected: Awaited<ReturnType<typeof readExactLegacyAccountIdentity>>
}) => {
  const current = await readExactLegacyAccountIdentity(params)
  if (params.expected == null && current != null) {
    throw new Error('Legacy adapter account directory appeared while it was being updated.')
  }
  if (
    params.expected != null && (
      current == null || current.path !== params.expected.path ||
      !identitiesMatch(current.identity, params.expected.identity)
    )
  ) {
    throw new Error('Legacy adapter account directory changed while it was being updated.')
  }
  return current
}
