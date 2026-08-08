import { describe, expect, it } from 'vitest'

import * as adapterAccountRevision from '#~/adapter-account-revision.js'
import * as adapterAccount from '#~/adapter-account.js'

describe('adapter account public api', () => {
  it('exports only the established artifact API in addition to revision helpers', () => {
    const artifactExports = Object.keys(adapterAccount)
      .filter(name => !Reflect.has(adapterAccountRevision, name))
      .sort()

    expect(artifactExports).toEqual([
      'assertAdapterAccountPathSegment',
      'migrateStoredAdapterAccounts',
      'persistAdapterAccountArtifacts',
      'removeStoredAdapterAccount',
      'resolveAdapterAccountDir',
      'resolveAdapterAccountReadDirs',
      'resolveAdapterAccountReadRoots',
      'resolveAdapterAccountsRoot',
      'resolveGlobalAdapterAccountDir'
    ])
    expect(Reflect.has(adapterAccount, 'ACCOUNT_STORE_DIRNAME')).toBe(false)
    expect(Reflect.has(adapterAccount, 'encodeLogicalPathKey')).toBe(false)
    expect(Reflect.has(adapterAccount, 'resolveAccountStoragePaths')).toBe(false)
  })
})
