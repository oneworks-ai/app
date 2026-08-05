'use strict'
const { Buffer } = require('node:buffer')
const allowedKinds = new Set(['entity', 'spec', 'rule'])
const text = (value, max = 512) =>
  typeof value === 'string' && value !== '' && Buffer.byteLength(value, 'utf8') <= max ? value : undefined
const decodeBytes = value => {
  if (
    typeof value !== 'string' || value.length > 352 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) return undefined
  const bytes = Buffer.from(value, 'base64')
  return bytes.length <= 256 * 1024 ? bytes : undefined
}
const validSegment = value =>
  text(value, 255) != null && value !== '.' && value !== '..' && ![...value].some(character => {
    const code = character.codePointAt(0)
    return code < 0x20 || code === 0x7F || character === '/' || character === '\\'
  })
const validPublicationPath = (parents, basename) =>
  Array.isArray(parents) && parents.length > 0 && parents.length <= 32 && parents.every(validSegment) &&
  validSegment(basename) && basename.endsWith('.md')
const exactClaimKey = (authorityId, kind, semanticName) => JSON.stringify([authorityId, kind, semanticName])
const hasExactKeys = (message, expected) => {
  const actual = Object.keys(message).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
const publicationResult = result =>
  result.state === 'committed'
    ? { state: 'committed' }
    : { state: result.state, warnings: [...(result.warnings ?? [])] }
module.exports = {
  allowedKinds,
  decodeBytes,
  exactClaimKey,
  hasExactKeys,
  publicationResult,
  text,
  validPublicationPath
}
