'use strict'
const { Buffer } = require('node:buffer')
const { randomBytes } = require('node:crypto')
const { prepareControlRoot, PROTOCOL_VERSION, readOrCreateSecret, resolveBrokerEndpoint } = require('./constants.cjs')
const { equalProof, handshakeProof } = require('./handshake.cjs')
const { loadBinding } = require('./loader.cjs')
const { createFrameChannel, encodeFrame } = require('./protocol.cjs')
const { connectWithStart, writeSocket } = require('./transport.cjs')
class FilesystemAuthorityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause == null ? undefined : { cause: options.cause })
    this.name = 'FilesystemAuthorityError'
    this.code = code
    this.committed = options.committed ?? false
    this.warnings = Object.freeze([...(options.warnings ?? [])])
  }
}
const publicationTransportError = (cause, sent) =>
  new FilesystemAuthorityError(
    sent ? 'asset_publish_indeterminate' : 'asset_filesystem_authority_unavailable',
    'Filesystem authority publish transport failed',
    { cause, committed: sent ? 'indeterminate' : false }
  )
const managedTreeTransportError = (cause, sent) =>
  new FilesystemAuthorityError(
    sent ? 'managed_tree_mutation_indeterminate' : 'asset_filesystem_authority_unavailable',
    'Managed tree transaction transport failed',
    { cause, committed: sent ? 'indeterminate' : false }
  )
const openAuthority = async (workspaceRoot, testing) => {
  const controlRoot = prepareControlRoot(testing?.controlRoot)
  const secret = testing?.secret ?? readOrCreateSecret(controlRoot)
  const endpoint = resolveBrokerEndpoint(controlRoot)
  const binding = testing?.binding ?? loadBinding()
  let socket
  try {
    socket = await connectWithStart(endpoint, controlRoot, binding, testing?.autoStart ?? true)
  } catch (error) {
    throw new FilesystemAuthorityError(
      'asset_filesystem_authority_unavailable',
      'Filesystem authority broker is unavailable',
      { cause: error }
    )
  }
  const channel = createFrameChannel(socket)
  let closed = false
  const request = async (message, onSent) => {
    if (closed) {
      throw new FilesystemAuthorityError(
        'asset_filesystem_authority_unavailable',
        'Filesystem authority connection is closed'
      )
    }
    await writeSocket(socket, encodeFrame(message))
    onSent?.()
    const response = await channel.next(testing?.timeoutMs)
    if (response.ok !== true) {
      throw new FilesystemAuthorityError(
        response.error?.code ?? 'asset_native_protocol_error',
        'Filesystem authority request failed',
        { committed: response.error?.committed ?? false, warnings: response.error?.warnings }
      )
    }
    return response
  }
  try {
    const nonce = randomBytes(32).toString('hex')
    const hello = await request({ action: 'hello', nonce, protocol: PROTOCOL_VERSION })
    if (
      hello.protocol !== PROTOCOL_VERSION || typeof hello.epoch !== 'string' ||
      !equalProof(hello.proof, handshakeProof(secret, 'server', nonce, hello.epoch))
    ) throw new Error('Filesystem authority broker handshake is invalid')
    await request({ action: 'authenticate', proof: handshakeProof(secret, 'client', nonce, hello.epoch) })
    const opened = await request({ action: 'open', workspaceRoot })
    if (
      typeof opened.authorityId !== 'string' || opened.authorityId === '' || typeof opened.capability !== 'string' ||
      opened.capability === ''
    ) throw new Error('Filesystem authority identity is invalid')
    const managedTreeRequest = async (action, transaction) => {
      let sent = false
      try {
        const response = await request({
          action: `tree-${action}`,
          authorityId: transaction.authorityId,
          generation: transaction.generation,
          transaction: transaction.transaction,
          ...(testing?.fault == null ? {} : { fault: testing.fault })
        }, () => {
          sent = true
        })
        return response.result
      } catch (error) {
        if (error instanceof FilesystemAuthorityError) throw error
        throw managedTreeTransportError(error, sent)
      }
    }
    return Object.freeze({
      capability: opened.capability,
      id: opened.authorityId,
      async claim(kind, semanticName) {
        const result = await request({ action: 'claim', kind, semanticName })
        if (!Number.isSafeInteger(result.generation) || result.generation <= 0) {
          throw new FilesystemAuthorityError('asset_claim_indeterminate', 'Filesystem authority generation is invalid')
        }
        return result.generation
      },
      async claimMutation(namespace, key) {
        const result = await request({ action: 'claim-mutation', key, namespace })
        if (!Number.isSafeInteger(result.generation) || result.generation <= 0) {
          throw new FilesystemAuthorityError('asset_claim_indeterminate', 'Filesystem authority generation is invalid')
        }
        return result.generation
      },
      async prepareManagedTree(transaction) {
        const result = await request({
          action: 'tree-prepare',
          authorityId: transaction.authorityId,
          entryName: transaction.entryName,
          generation: transaction.generation,
          parentSegments: transaction.parentSegments
        })
        if (typeof result.transaction !== 'string' || result.transaction === '') {
          throw new FilesystemAuthorityError(
            'managed_tree_transaction_invalid',
            'Managed tree transaction token is invalid'
          )
        }
        return result.transaction
      },
      async stageManagedTree(transaction) {
        return await managedTreeRequest('stage', transaction)
      },
      async restoreManagedTree(transaction) {
        return await managedTreeRequest('restore', transaction)
      },
      async removeManagedTree(transaction) {
        return await managedTreeRequest('remove', transaction)
      },
      async publish(publication) {
        let publishSent = false
        try {
          const response = await request({
            action: 'publish',
            authorityId: publication.authorityId,
            basename: publication.basename,
            content: Buffer.from(publication.bytes).toString('base64'),
            generation: publication.generation,
            parentSegments: publication.parentSegments,
            ...(testing?.fault == null ? {} : { fault: testing.fault })
          }, () => {
            publishSent = true
          })
          return response.result
        } catch (error) {
          if (error instanceof FilesystemAuthorityError) throw error
          throw publicationTransportError(error, publishSent)
        }
      },
      async release(generation) {
        return (await request({ action: 'release', generation })).released === true
      },
      close() {
        if (closed) return
        closed = true
        socket.destroy()
      }
    })
  } catch (error) {
    closed = true
    socket.destroy()
    if (error instanceof FilesystemAuthorityError) throw error
    throw new FilesystemAuthorityError(
      'asset_filesystem_authority_unavailable',
      'Filesystem authority protocol failed',
      { cause: error, committed: false }
    )
  }
}
module.exports = {
  FilesystemAuthorityError,
  openAuthority,
  openFilesystemAuthority: workspaceRoot => openAuthority(workspaceRoot),
  publicationTransportError,
  managedTreeTransportError
}
