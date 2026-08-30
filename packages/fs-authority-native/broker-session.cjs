'use strict'
const { randomBytes } = require('node:crypto')
const { createBrokerHandshake } = require('./broker-handshake.cjs')
const {
  allowedKinds,
  decodeBytes,
  exactClaimKey,
  exactMutationClaimKey,
  hasExactKeys,
  publicationResult,
  text,
  validPublicationPath
} = require('./broker-validation.cjs')
const { createManagedTreeHandler } = require('./managed-tree-session.cjs')
const { createFrameChannel, encodeFrame } = require('./protocol.cjs')
const { writeSocket } = require('./transport.cjs')
const failure = (code, committed = false, warnings = []) => ({ error: { code, committed, warnings }, ok: false })
const createSession = (
  { allowFaults, binding, claims, controlRoot, database, epoch, initialBytes, secret, socket, workspaceRoot }
) => {
  const channel = createFrameChannel(socket, initialBytes)
  const handshake = createBrokerHandshake(epoch, secret)
  const managedTrees = createManagedTreeHandler({ allowFaults, binding, database, secret })
  const state = { authenticated: false, authority: undefined, claim: undefined, socket }
  const finishClaim = outcome => {
    const claim = state.claim
    if (claim == null) return
    if (claims.get(claim.key) === state) claims.delete(claim.key)
    state.claim = undefined
    database.finish(claim, outcome)
  }
  const handle = message => {
    if (!state.authenticated) {
      const response = handshake.handle(message)
      state.authenticated = handshake.authenticated
      return response
    }
    if (message.action === 'open') {
      const requestedRoot = text(message.workspaceRoot, 16 * 1024)
      if (!hasExactKeys(message, ['action', 'workspaceRoot']) || state.authority != null || requestedRoot == null) {
        return failure('asset_native_protocol_error')
      }
      const root = workspaceRoot(controlRoot, requestedRoot)
      state.authority = binding.openAuthority(root, controlRoot)
      return { authorityId: state.authority.id, capability: state.authority.capability, ok: true }
    }
    if (message.action === 'claim') {
      const kind = text(message.kind, 16)
      const semanticName = text(message.semanticName, 512)
      if (
        !hasExactKeys(message, ['action', 'kind', 'semanticName']) || state.authority == null || state.claim != null ||
        !allowedKinds.has(kind) || semanticName == null
      ) return failure('asset_native_protocol_error')
      const key = exactClaimKey(state.authority.id, kind, semanticName)
      if (claims.has(key)) return failure('asset_create_in_progress')
      try {
        state.claim = database.acquire(key, epoch, randomBytes(32).toString('hex'))
      } catch (error) {
        return failure(error?.code ?? 'asset_claim_indeterminate')
      }
      claims.set(key, state)
      return { generation: state.claim.generation, ok: true }
    }
    if (message.action === 'claim-mutation') {
      const namespace = text(message.namespace, 128)
      const mutationKey = text(message.key, 4096)
      if (
        !hasExactKeys(message, ['action', 'key', 'namespace']) || state.authority == null || state.claim != null ||
        namespace == null || mutationKey == null
      ) return failure('asset_native_protocol_error')
      const key = exactMutationClaimKey(state.authority.id, namespace, mutationKey)
      if (claims.has(key)) return failure('asset_create_in_progress')
      try {
        state.claim = database.acquire(key, epoch, randomBytes(32).toString('hex'))
      } catch (error) {
        return failure(error?.code ?? 'asset_claim_indeterminate')
      }
      claims.set(key, state)
      return { generation: state.claim.generation, ok: true }
    }
    if (message.action === 'release') {
      if (
        !hasExactKeys(message, ['action', 'generation']) || state.claim == null ||
        message.generation !== state.claim.generation
      ) return failure('asset_claim_lost')
      finishClaim('released-before-publish')
      return { ok: true, released: true }
    }
    if (typeof message.action === 'string' && message.action.startsWith('tree-')) {
      let outcome
      try {
        outcome = managedTrees.handle(message, state)
      } catch (error) {
        const nativeResult = error?.nativeResult
        if (nativeResult != null && nativeResult.state !== 'error') {
          return {
            ok: true,
            result: {
              state: 'committed-indeterminate',
              warnings: [...new Set([...(nativeResult.warnings ?? []), 'managed_tree_claim_terminal_indeterminate'])]
            }
          }
        }
        return failure(error?.code ?? 'managed_tree_mutation_indeterminate')
      }
      if (outcome.finished === true && state.claim != null) {
        claims.delete(state.claim.key)
        state.claim = undefined
      }
      return outcome.response
    }
    if (message.action !== 'publish') return failure('asset_native_protocol_error')
    const parents = Array.isArray(message.parentSegments)
      ? message.parentSegments.map(value => text(value, 255))
      : undefined
    const basename = text(message.basename, 255)
    const bytes = decodeBytes(message.content)
    const publishKeys = ['action', 'authorityId', 'basename', 'content', 'generation', 'parentSegments']
    if (allowFaults && Object.hasOwn(message, 'fault')) publishKeys.push('fault')
    if (
      !hasExactKeys(message, publishKeys) || state.authority == null || state.claim == null ||
      message.authorityId !== state.authority.id || message.generation !== state.claim.generation || parents == null ||
      parents.length === 0 || parents.some(value => value == null) || basename == null || bytes == null
    ) return failure('asset_native_protocol_error')
    if (!validPublicationPath(parents, basename)) {
      finishClaim('rejected-before-native-publish')
      return failure('asset_destination_forbidden')
    }
    const fault = allowFaults ? text(message.fault, 64) : undefined
    let result
    try {
      result = database.fencedPublish(
        state.claim,
        () =>
          binding.publishSync(
            state.authority.handle,
            message.authorityId,
            parents,
            basename,
            bytes,
            randomBytes(16).toString('hex'),
            fault == null ? undefined : { fault }
          )
      )
      claims.delete(state.claim.key)
      state.claim = undefined
    } catch (error) {
      const nativeResult = error?.nativeResult
      if (nativeResult != null && nativeResult.state !== 'error') {
        return {
          ok: true,
          result: {
            state: 'committed-indeterminate',
            warnings: [...new Set([...(nativeResult?.warnings ?? []), 'asset_claim_terminal_indeterminate'])]
          }
        }
      }
      return failure(error?.code ?? 'asset_claim_indeterminate')
    }
    return result.state === 'error'
      ? failure(result.code, result.committed, result.warnings)
      : { ok: true, result: publicationResult(result) }
  }
  const run = async () => {
    try {
      while (!socket.destroyed) await writeSocket(socket, encodeFrame(handle(await channel.next())))
    } catch (error) {
      if (!socket.destroyed) {
        try {
          await writeSocket(socket, encodeFrame(failure(error?.code ?? 'asset_filesystem_authority_unavailable')))
        } catch {}
      }
    } finally {
      try {
        finishClaim('connection-closed')
      } catch {}
      const authority = state.authority
      state.authority = undefined
      try {
        if (authority != null) binding.closeAuthority(authority.handle)
      } catch {}
      socket.destroy()
    }
  }
  return { run, state }
}
module.exports = { createSession, exactClaimKey }
