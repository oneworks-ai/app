'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { after, before, beforeEach } = require('node:test')
const {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot,
  startFilesystemAuthorityBroker
} = require('../testing.cjs')

let broker
let control
let root
let secret
let workspace

const options = fault => ({ autoStart: false, controlRoot: control, fault, secret, timeoutMs: 5000 })
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const delayedChild = (source, arguments_) => {
  const child = spawn(process.execPath, ['-e', source, ...arguments_], { stdio: 'inherit' })
  return new Promise((resolve, reject) =>
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`Delayed filesystem adversary exited ${code}`))
    })
  )
}
const open = fault => openFilesystemAuthorityForTest(workspace, options(fault))
const prepareTree = async ({ fault, key = 'workspace-managed-plugin', name = 'plugin' } = {}) => {
  const parent = join(workspace, '.oneworks', 'managed-plugins')
  mkdirSync(join(parent, name, 'nested'), { recursive: true })
  writeFileSync(join(parent, name, 'nested', 'marker.txt'), 'managed tree')
  const authority = await open(fault)
  const generation = await authority.claimMutation('managed-plugin-directory', key)
  const transaction = await authority.prepareManagedTree({
    authorityId: authority.id,
    entryName: name,
    generation,
    parentSegments: ['.oneworks', 'managed-plugins']
  })
  return {
    authority,
    mutation: { authorityId: authority.id, generation, transaction },
    parent,
    transaction
  }
}

before(async () => {
  assert.equal(process.platform, 'darwin', 'managed tree authority regressions are macOS-only')
  root = mkdtempSync(join(tmpdir(), 'ow-managed-tree-authority-'))
  const prepared = prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
  control = prepared.controlRoot
  secret = prepared.secret
  broker = await startFilesystemAuthorityBroker({ controlRoot: control, secret })
})
beforeEach(() => {
  workspace = mkdtempSync(join(root, 'workspace-'))
})
after(async () => {
  await broker?.close()
  rmSync(root, { force: true, recursive: true })
})

module.exports = {
  assert,
  delay,
  delayedChild,
  getRoot: () => root,
  getSecret: () => secret,
  join,
  open,
  prepareTree
}
