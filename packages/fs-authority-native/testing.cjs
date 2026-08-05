'use strict'
const process = require('node:process')
if (process.env.NODE_ENV !== 'test') throw new Error('@oneworks/fs-authority-native/testing is test-only')
const { startBroker } = require('./broker.cjs')
const { openAuthority } = require('./client.cjs')
const { prepareControlRoot, readOrCreateSecret } = require('./constants.cjs')
const { loadBinding } = require('./loader.cjs')
module.exports = {
  loadFilesystemAuthorityBinding: loadBinding,
  openFilesystemAuthorityForTest: openAuthority,
  prepareFilesystemAuthorityTestControlRoot: override => {
    const controlRoot = prepareControlRoot(override)
    return { controlRoot, secret: readOrCreateSecret(controlRoot) }
  },
  startFilesystemAuthorityBroker: options => startBroker({ ...options, allowFaults: true })
}
