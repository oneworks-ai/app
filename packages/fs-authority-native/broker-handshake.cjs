'use strict'
const { hasExactKeys, text } = require('./broker-validation.cjs')
const { PROTOCOL_VERSION } = require('./constants.cjs')
const { equalProof, handshakeProof } = require('./handshake.cjs')
const failure = () => ({ error: { code: 'asset_native_protocol_error', committed: false, warnings: [] }, ok: false })
const createBrokerHandshake = (epoch, secret) => {
  let authenticated = false
  let nonce
  return {
    get authenticated() {
      return authenticated
    },
    handle(message) {
      if (nonce == null) {
        const requested = text(message.nonce, 64)
        if (
          !hasExactKeys(message, ['action', 'nonce', 'protocol']) || message.action !== 'hello' ||
          message.protocol !== PROTOCOL_VERSION || requested == null || !/^[a-f0-9]{64}$/u.test(requested)
        ) return failure()
        nonce = requested
        return { epoch, ok: true, proof: handshakeProof(secret, 'server', nonce, epoch), protocol: PROTOCOL_VERSION }
      }
      if (
        !hasExactKeys(message, ['action', 'proof']) || message.action !== 'authenticate' ||
        !equalProof(message.proof, handshakeProof(secret, 'client', nonce, epoch))
      ) return failure()
      authenticated = true
      return { ok: true }
    }
  }
}
module.exports = { createBrokerHandshake }
