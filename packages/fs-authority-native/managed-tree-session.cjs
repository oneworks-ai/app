'use strict'

const { randomBytes } = require('node:crypto')

const {
  hasExactKeys,
  publicationResult,
  text,
  validManagedTreePath,
  validTransaction
} = require('./broker-validation.cjs')
const { openTransaction, sealTransaction } = require('./transaction-token.cjs')

const failure = (code, committed = false, warnings = []) => ({ error: { code, committed, warnings }, ok: false })

const createManagedTreeHandler = ({ allowFaults, binding, database, secret }) => {
  const nativeTree = (state, transaction, action, fault) =>
    binding.treeSync(
      state.authority.handle,
      action,
      transaction.authorityId,
      transaction.parentSegments,
      transaction.entryName,
      transaction.quarantineName,
      transaction.parentIdentity,
      transaction.identity,
      fault == null ? undefined : { fault }
    )
  const readTransaction = (state, token) => {
    let transaction
    try {
      transaction = openTransaction(secret, token)
    } catch {
      return undefined
    }
    if (
      !validTransaction(transaction) || transaction.authorityId !== state.authority?.id ||
      transaction.claimKey !== state.claim?.key
    ) return undefined
    return transaction
  }
  const prepare = (message, state) => {
    const parents = Array.isArray(message.parentSegments)
      ? message.parentSegments.map(value => text(value, 255))
      : undefined
    const entryName = text(message.entryName, 255)
    if (
      !hasExactKeys(message, ['action', 'authorityId', 'entryName', 'generation', 'parentSegments']) ||
      state.authority == null || state.claim == null || message.authorityId !== state.authority.id ||
      message.generation !== state.claim.generation || parents == null || parents.some(value => value == null) ||
      entryName == null || !validManagedTreePath(parents, entryName)
    ) return { response: failure('asset_native_protocol_error') }
    const identified = database.fencedMutation(state.claim, () =>
      binding.treeSync(
        state.authority.handle,
        'identify',
        state.authority.id,
        parents,
        entryName,
        '',
        '',
        ''
      ))
    if (
      identified.state === 'error' || text(identified.parentIdentity, 512) == null ||
      text(identified.identity, 512) == null
    ) {
      return { response: failure(identified.code ?? 'managed_tree_changed', identified.committed, identified.warnings) }
    }
    const transaction = sealTransaction(secret, {
      authorityId: state.authority.id,
      claimKey: state.claim.key,
      entryName,
      identity: identified.identity,
      parentIdentity: identified.parentIdentity,
      parentSegments: parents,
      quarantineName: `.ow-quarantine-${randomBytes(16).toString('hex')}`,
      schemaVersion: 1
    })
    return { response: { ok: true, transaction } }
  }
  const mutate = (message, state) => {
    const keys = ['action', 'authorityId', 'generation', 'transaction']
    if (allowFaults && Object.hasOwn(message, 'fault')) keys.push('fault')
    if (
      !hasExactKeys(message, keys) || state.authority == null || state.claim == null ||
      message.authorityId !== state.authority.id || message.generation !== state.claim.generation
    ) return { response: failure('asset_native_protocol_error') }
    const transaction = readTransaction(state, message.transaction)
    if (transaction == null) return { response: failure('managed_tree_transaction_invalid') }
    const action = message.action.slice('tree-'.length)
    if (action !== 'stage' && action !== 'restore' && action !== 'remove') {
      return { response: failure('managed_tree_transaction_invalid') }
    }
    const fault = allowFaults ? text(message.fault, 64) : undefined
    const operation = () => nativeTree(state, transaction, action, fault)
    const terminal = action === 'restore' || action === 'remove'
    const result = terminal
      ? database.fencedFinish(state.claim, operation)
      : database.fencedMutation(state.claim, operation)
    if (result.state === 'error') {
      return { response: failure(result.code ?? 'managed_tree_changed', result.committed, result.warnings) }
    }
    return { finished: terminal, response: { ok: true, result: publicationResult(result) } }
  }
  return {
    handle(message, state) {
      return message.action === 'tree-prepare' ? prepare(message, state) : mutate(message, state)
    }
  }
}

module.exports = { createManagedTreeHandler }
