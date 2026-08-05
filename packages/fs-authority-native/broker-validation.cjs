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
const exactMutationClaimKey = (authorityId, namespace, key) => JSON.stringify([authorityId, 'mutation', namespace, key])
const validManagedTreePath = (parents, entryName) =>
  Array.isArray(parents) && parents.length > 0 && parents.length <= 32 && parents.every(validSegment) &&
  validSegment(entryName)
const hasExactKeys = (message, expected) => {
  const actual = Object.keys(message).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
const validTransaction = value =>
  value != null && typeof value === 'object' && !Array.isArray(value) &&
  hasExactKeys(value, [
    'authorityId',
    'claimKey',
    'entryName',
    'identity',
    'parentIdentity',
    'parentSegments',
    'quarantineName',
    'schemaVersion'
  ]) && value.schemaVersion === 1 && text(value.authorityId, 512) != null && text(value.claimKey, 4096) != null &&
  validManagedTreePath(value.parentSegments, value.entryName) && validSegment(value.quarantineName) &&
  text(value.identity, 512) != null && text(value.parentIdentity, 512) != null
const publicationResult = result =>
  result.state === 'committed'
    ? { state: 'committed' }
    : { state: result.state, warnings: [...(result.warnings ?? [])] }
module.exports = {
  allowedKinds,
  decodeBytes,
  exactClaimKey,
  exactMutationClaimKey,
  hasExactKeys,
  publicationResult,
  text,
  validManagedTreePath,
  validPublicationPath,
  validTransaction
}
