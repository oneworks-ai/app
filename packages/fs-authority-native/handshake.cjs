'use strict'
const { Buffer } = require('node:buffer')
const { createHmac, timingSafeEqual } = require('node:crypto')
const handshakeProof = (secret, role, nonce, epoch) =>
  createHmac('sha256', secret).update('oneworks-fs-authority-v2\0').update(role).update('\0').update(nonce).update('\0')
    .update(epoch).digest('hex')
const equalProof = (actual, expected) =>
  typeof actual === 'string' && /^[a-f0-9]{64}$/u.test(actual) &&
  timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
module.exports = { equalProof, handshakeProof }
