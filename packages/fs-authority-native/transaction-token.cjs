'use strict'

const { Buffer } = require('node:buffer')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')

const PREFIX = 'owft1'
const keyBytes = secret => Buffer.from(secret, 'hex')

const sealTransaction = (secret, payload) => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), nonce)
  cipher.setAAD(Buffer.from(PREFIX))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()])
  return [
    PREFIX,
    nonce.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url')
  ]
    .join('.')
}

const openTransaction = (secret, token) => {
  if (typeof token !== 'string' || token.length > 24 * 1024) throw new Error('Managed tree transaction is invalid')
  const [prefix, encodedNonce, encodedCiphertext, encodedTag, extra] = token.split('.')
  if (prefix !== PREFIX || extra != null) throw new Error('Managed tree transaction is invalid')
  const nonce = Buffer.from(encodedNonce ?? '', 'base64url')
  const ciphertext = Buffer.from(encodedCiphertext ?? '', 'base64url')
  const tag = Buffer.from(encodedTag ?? '', 'base64url')
  if (nonce.length !== 12 || ciphertext.length === 0 || tag.length !== 16) {
    throw new Error('Managed tree transaction is invalid')
  }
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), nonce)
  decipher.setAAD(Buffer.from(PREFIX))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}

module.exports = { openTransaction, sealTransaction }
