'use strict'
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const process = require('node:process')
const PACKAGE_ROOT = __dirname
const ARTIFACTS = Object.freeze({
  'darwin-arm64': 'prebuilds/darwin-arm64/fs-authority.node',
  'darwin-x64': 'prebuilds/darwin-x64/fs-authority.node'
})
let cached
const fail = (code, message, cause) => {
  const error = new Error(message, cause == null ? undefined : { cause })
  error.code = code
  throw error
}
const loadBinding = () => {
  if (cached != null) return cached
  const tuple = `${process.platform}-${process.arch}`
  const relativePath = ARTIFACTS[tuple]
  if (relativePath == null) fail('asset_filesystem_authority_unavailable', `Unsupported authority tuple ${tuple}`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'prebuilds/manifest.json'), 'utf8'))
  } catch (error) {
    fail('asset_filesystem_authority_unavailable', 'Authority manifest is missing', error)
  }
  const entry = manifest?.schemaVersion === 1 && manifest?.napiVersion === 8 ? manifest.artifacts?.[tuple] : undefined
  if (
    entry?.path !== relativePath || !Number.isSafeInteger(entry.size) || entry.size <= 0 ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256)
  ) fail('asset_filesystem_authority_unavailable', 'Authority manifest entry is invalid')
  const artifactPath = join(PACKAGE_ROOT, relativePath)
  let bytes
  try {
    const stat = lstatSync(artifactPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) {
      fail('asset_filesystem_authority_unavailable', 'Authority artifact is unsafe')
    }
    bytes = readFileSync(artifactPath)
  } catch (error) {
    if (error?.code === 'asset_filesystem_authority_unavailable') throw error
    fail('asset_filesystem_authority_unavailable', 'Authority artifact is missing', error)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    fail('asset_filesystem_authority_unavailable', 'Authority artifact hash mismatch')
  }
  try {
    cached = require(artifactPath)
  } catch (error) {
    fail('asset_filesystem_authority_unavailable', 'Authority artifact failed to load', error)
  }
  if (
    typeof cached?.closeAuthority !== 'function' || typeof cached?.openAuthority !== 'function' ||
    typeof cached?.publishSync !== 'function' || typeof cached?.verifyLocalPeer !== 'function'
  ) fail('asset_native_protocol_error', 'Authority native exports are invalid')
  return cached
}
module.exports = { ARTIFACTS, loadBinding }
