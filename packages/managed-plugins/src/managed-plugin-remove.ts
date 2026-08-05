import { randomBytes } from 'node:crypto'
import path from 'node:path'

import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { getManagedPluginsRoot } from '@oneworks/utils/managed-plugin'

import { markManagedPluginAuthorityTerminal, withManagedPluginAuthority } from './managed-plugin-mutation'
import type { ManagedPluginMutationRuntime } from './managed-plugin-mutation'
import {
  createRemovalRecord,
  hasRemovalReceipt,
  isManagedPluginPathSegment,
  listPendingRemovalRecords,
  readRemovalRecord,
  validRemovalOperationId,
  writeRemovalReceipt,
  writeRemovalRecord
} from './managed-plugin-removal-journal'
import type { ManagedPluginRemovalIdentity, ManagedPluginRemovalRecord } from './managed-plugin-removal-journal'
import { assertRemovalRecordCanBePublished } from './managed-plugin-removal-record-content'

export type { ManagedPluginRemovalIdentity } from './managed-plugin-removal-journal'

export interface ManagedPluginRemovalRuntime {
  mutation?: ManagedPluginMutationRuntime
}
export interface ManagedPluginRemovalHandle extends ManagedPluginRemovalRecord {
  cwd: string
  env?: NodeJS.ProcessEnv
  runtime?: ManagedPluginRemovalRuntime
}
export interface ManagedPluginRemovalRecoveryResult {
  action: 'cleaned' | 'restored'
  identity: ManagedPluginRemovalIdentity
  operationId: string
}
export class ManagedPluginRemovalIndeterminateError extends Error {
  readonly warnings: readonly string[]

  constructor(warnings: readonly string[]) {
    super('Managed plugin removal reached an indeterminate committed state.')
    this.name = 'ManagedPluginRemovalIndeterminateError'
    this.warnings = Object.freeze([...warnings])
  }
}

const assertOutcome = (
  outcome: { state: string; warnings?: readonly string[] },
  expected: 'quarantined' | 'removed' | 'restored'
) => {
  if (outcome.state === expected) return
  throw new ManagedPluginRemovalIndeterminateError(outcome.warnings ?? ['managed_tree_mutation_indeterminate'])
}

const isRecoveredRemoval = (outcome: { state: string; warnings?: readonly string[] }) => (
  outcome.state === 'removed' ||
  (outcome.state === 'committed-indeterminate' &&
    outcome.warnings?.length === 1 && outcome.warnings[0] === 'managed_tree_remove_state_indeterminate')
)

export const stageManagedPluginRemoval = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  install: ManagedPluginInstall
  operationId: string
  runtime?: ManagedPluginRemovalRuntime
}): Promise<ManagedPluginRemovalHandle> => {
  const managedRoot = getManagedPluginsRoot(params.cwd, params.env)
  assertRemovalRecordCanBePublished(createRemovalRecord(
    params.install,
    params.operationId,
    managedRoot,
    '0'.repeat(32 * 1024)
  ))
  return withManagedPluginAuthority(
    { cwd: params.cwd, env: params.env, runtime: params.runtime?.mutation },
    async (lease) => {
      const relative = path.relative(lease.managedRoot, params.install.installDir).split(path.sep)
      if (relative.length !== 3 || relative[2] !== 'install' || !relative.every(isManagedPluginPathSegment)) {
        throw new TypeError('Managed plugin install is outside its authority root.')
      }
      const transaction = await lease.authority.prepareManagedTree({
        authorityId: lease.authority.id,
        entryName: 'install',
        generation: lease.generation,
        parentSegments: [relative[0], relative[1]]
      })
      const record = await writeRemovalRecord(
        lease.managedRoot,
        createRemovalRecord(params.install, params.operationId, lease.managedRoot, transaction)
      )
      const outcome = await lease.authority.stageManagedTree({
        authorityId: lease.authority.id,
        generation: lease.generation,
        transaction
      })
      assertOutcome(outcome, 'quarantined')
      return { ...record, cwd: params.cwd, env: params.env, runtime: params.runtime }
    }
  )
}

const finishRemoval = async (handle: ManagedPluginRemovalHandle, action: 'remove' | 'restore') =>
  withManagedPluginAuthority(
    { cwd: handle.cwd, env: handle.env, runtime: handle.runtime?.mutation },
    async (lease) => {
      const mutation = {
        authorityId: lease.authority.id,
        generation: lease.generation,
        transaction: handle.transaction
      }
      const outcome = action === 'remove'
        ? await lease.authority.removeManagedTree(mutation)
        : await lease.authority.restoreManagedTree(mutation)
      markManagedPluginAuthorityTerminal(lease)
      assertOutcome(outcome, action === 'remove' ? 'removed' : 'restored')
      await writeRemovalReceipt(lease.managedRoot, handle, action === 'remove' ? 'removed' : 'restored')
    }
  )

export const restoreManagedPluginRemoval = async (handle: ManagedPluginRemovalHandle) => {
  await finishRemoval(handle, 'restore')
}
export const commitManagedPluginRemoval = async (handle: ManagedPluginRemovalHandle) => {
  await finishRemoval(handle, 'remove')
}
export const removeManagedPluginInstall = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  install: ManagedPluginInstall
  runtime?: ManagedPluginRemovalRuntime
}) => {
  const handle = await stageManagedPluginRemoval({
    ...params,
    operationId: randomBytes(32).toString('hex')
  })
  await commitManagedPluginRemoval(handle)
}

export const getManagedPluginRemovalCompletion = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  operationId: string
}) => {
  if (!validRemovalOperationId(params.operationId)) return undefined
  return withManagedPluginAuthority(params, async (lease) => {
    const record = await readRemovalRecord(lease.managedRoot, params.operationId)
    if (!await hasRemovalReceipt(lease.managedRoot, record, 'removed')) return undefined
    return { identity: record.identity, operationId: record.operationId }
  })
}

export const recoverManagedPluginRemovals = async (params: {
  cwd: string
  env?: NodeJS.ProcessEnv
  isDeclarationPresent: (identity: ManagedPluginRemovalIdentity) => Promise<boolean>
  runtime?: ManagedPluginRemovalRuntime
}) => {
  const managedRoot = getManagedPluginsRoot(params.cwd, params.env)
  const records = await listPendingRemovalRecords(managedRoot)
  const results: ManagedPluginRemovalRecoveryResult[] = []
  for (const record of records) {
    await withManagedPluginAuthority(
      { cwd: params.cwd, env: params.env, runtime: params.runtime?.mutation },
      async (lease) => {
        const declarationPresent = await params.isDeclarationPresent(record.identity)
        const mutation = {
          authorityId: lease.authority.id,
          generation: lease.generation,
          transaction: record.transaction
        }
        const outcome = declarationPresent
          ? await lease.authority.restoreManagedTree(mutation)
          : await lease.authority.removeManagedTree(mutation)
        markManagedPluginAuthorityTerminal(lease)
        if (declarationPresent) assertOutcome(outcome, 'restored')
        else if (!isRecoveredRemoval(outcome)) assertOutcome(outcome, 'removed')
        await writeRemovalReceipt(lease.managedRoot, record, declarationPresent ? 'restored' : 'removed')
        results.push({
          action: declarationPresent ? 'restored' : 'cleaned',
          identity: record.identity,
          operationId: record.operationId
        })
      }
    )
  }
  return results
}
