'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { after, before, beforeEach, test } = require('node:test')

const { createBrokerHandshake } = require('../broker-handshake.cjs')
const { PROTOCOL_VERSION, resolveDefaultControlRoot } = require('../constants.cjs')
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
const publish = async ({ basename = 'asset.md', fault, semanticName = basename } = {}) => {
  const authority = await openFilesystemAuthorityForTest(workspace, options(fault))
  try {
    const generation = await authority.claim('rule', semanticName)
    return await authority.publish({
      authorityId: authority.id,
      basename,
      bytes: Buffer.from('content'),
      generation,
      parentSegments: ['.oo', 'rules']
    })
  } finally {
    authority.close()
  }
}

before(async () => {
  assert.equal(process.platform, 'darwin', 'native authority regression suite is macOS-only')
  root = mkdtempSync(join(tmpdir(), 'ow-fs-authority-'))
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

test('publishes exact bytes once and never overwrites the target', async () => {
  assert.deepEqual(await publish(), { state: 'committed' })
  const target = join(workspace, '.oo', 'rules', 'asset.md')
  assert.equal(readFileSync(target, 'utf8'), 'content')
  await assert.rejects(publish({ semanticName: 'second-claim' }), { code: 'asset_exists', committed: false })
  assert.equal(readFileSync(target, 'utf8'), 'content')
})

test('rejects a final symlink without writing outside the authority', async () => {
  const outside = mkdtempSync(join(root, 'outside-'))
  const outsideFile = join(outside, 'outside.md')
  writeFileSync(outsideFile, 'outside stays intact')
  require('node:fs').mkdirSync(join(workspace, '.oo', 'rules'), { recursive: true })
  symlinkSync(outsideFile, join(workspace, '.oo', 'rules', 'asset.md'))
  await assert.rejects(publish({ semanticName: 'final-link' }), { code: 'asset_exists' })
  assert.equal(readFileSync(outsideFile, 'utf8'), 'outside stays intact')
})

test('fences concurrent semantic claims and advances the next generation', async () => {
  const left = await openFilesystemAuthorityForTest(workspace, options())
  const right = await openFilesystemAuthorityForTest(workspace, options())
  try {
    const first = await left.claim('entity', 'release-gate')
    await assert.rejects(right.claim('entity', 'release-gate'), { code: 'asset_create_in_progress' })
    assert.equal(await left.release(first), true)
    assert.equal(await right.claim('entity', 'release-gate'), 2)
  } finally {
    left.close()
    right.close()
  }
})

test('rejects the legacy wire version before authority open', () => {
  assert.equal(PROTOCOL_VERSION, 3)
  assert.equal(resolveDefaultControlRoot('/Users/runtime'), '/Users/runtime/.oneworks/runtime/fs-authority-v3')
  const handshake = createBrokerHandshake('e'.repeat(64), 'a'.repeat(64))
  assert.deepEqual(
    handshake.handle({
      action: 'hello',
      nonce: 'b'.repeat(64),
      protocol: 2
    }),
    {
      error: { code: 'asset_native_protocol_error', committed: false, warnings: [] },
      ok: false
    }
  )
})

test('reports post-publication durability ambiguity without deleting the visible target', async () => {
  assert.deepEqual(await publish({ basename: 'ambiguous.md', fault: 'identity-probe' }), {
    state: 'committed-indeterminate',
    warnings: ['asset_target_identity_unconfirmed']
  })
  assert.equal(readFileSync(join(workspace, '.oo', 'rules', 'ambiguous.md'), 'utf8'), 'content')
})

test('loads the complete native authority export contract', () => {
  const binding = require('../testing.cjs').loadFilesystemAuthorityBinding()
  assert.equal(typeof binding.treeSync, 'function')
})
