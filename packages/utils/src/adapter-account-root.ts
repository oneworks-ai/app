import { chmod, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'

import type { PathIdentity } from './adapter-account-fs'
import {
  assertCanonicalChildDirectory,
  assertSecureDirectory,
  ensureCanonicalChildDirectory,
  identitiesMatch
} from './adapter-account-fs'
import { ensureLogicalKeyMetadata } from './adapter-account-metadata'
import { ADAPTER_KEY_METADATA_FILENAME, assertAdapterAccountPathSegment } from './adapter-account-path-validation'
import { resolveAdapterAccountsRoot } from './adapter-account-paths'
import { resolveProjectHomeDir } from './ai-path'

export interface SecureAccountsRoot {
  accountsRoot: string
  canonicalProjectHome: string
  chain: Array<{ identity: PathIdentity; path: string }>
  projectHomeIdentity: PathIdentity
}

export const ensureSecureAccountsRoot = async (params: {
  adapter: string
  cwd: string
  env: AdapterCtx['env']
  expected?: SecureAccountsRoot
}): Promise<SecureAccountsRoot> => {
  const projectHome = resolveProjectHomeDir(params.cwd, params.env)
  const accountsRoot = resolveAdapterAccountsRoot(params.cwd, params.env, params.adapter)
  const relativeAccountsRoot = relative(projectHome, accountsRoot)
  if (
    relativeAccountsRoot === '' || isAbsolute(relativeAccountsRoot) ||
    relativeAccountsRoot === '..' || relativeAccountsRoot.startsWith('../')
  ) {
    throw new Error(`Adapter accounts root must stay inside the project home: ${accountsRoot}`)
  }

  await mkdir(projectHome, { recursive: true, mode: 0o700 })
  const canonicalProjectHome = await realpath(projectHome)
  const projectHomeIdentity = await assertSecureDirectory(canonicalProjectHome, 'Canonical project home')
  if (projectHomeIdentity == null) throw new Error(`Project home is unavailable: ${projectHome}`)
  if (
    params.expected != null && (
      params.expected.canonicalProjectHome !== canonicalProjectHome ||
      !identitiesMatch(params.expected.projectHomeIdentity, projectHomeIdentity)
    )
  ) {
    throw new Error(`Canonical project home changed while adapter artifacts were being updated: ${projectHome}`)
  }

  const segments = relativeAccountsRoot.split(/[\\/]+/u).filter(Boolean)
  const chain: SecureAccountsRoot['chain'] = []
  let current = canonicalProjectHome
  for (let index = 0; index < segments.length; index += 1) {
    const label = index === segments.length - 1 ? 'Adapter accounts root' : 'Adapter accounts root ancestor'
    const child = await ensureCanonicalChildDirectory({ label, name: segments[index]!, parent: current })
    const expectedChild = params.expected?.chain[index]
    if (
      expectedChild != null && (
        expectedChild.path !== child.path || !identitiesMatch(expectedChild.identity, child.identity)
      )
    ) {
      throw new Error(`${label} changed while adapter artifacts were being updated: ${child.path}`)
    }
    chain.push(child)
    current = child.path
  }
  if (params.expected != null && params.expected.chain.length !== chain.length) {
    throw new Error(`Adapter accounts root ancestry changed: ${accountsRoot}`)
  }
  await chmod(current, 0o700)
  await ensureLogicalKeyMetadata({
    directory: dirname(current),
    filename: ADAPTER_KEY_METADATA_FILENAME,
    key: assertAdapterAccountPathSegment(params.adapter, 'adapter'),
    label: 'Adapter key'
  })
  return { accountsRoot: current, canonicalProjectHome, chain, projectHomeIdentity }
}

export const revalidateLocksRoot = async (params: {
  accountsRoot: string
  identity: PathIdentity
  path: string
}) => {
  const result = await assertCanonicalChildDirectory({
    expected: params.identity,
    label: 'Adapter account locks root',
    parent: params.accountsRoot,
    path: params.path
  })
  if (result == null) throw new Error('Adapter account locks root disappeared while locking.')
  return result
}
