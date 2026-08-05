'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot,
  startFilesystemAuthorityBroker
} = require('../testing.cjs')

test('a delayed startup loser cannot recover or clear the endpoint winner claim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ow-authority-owner-'))
  const workspace = mkdtempSync(join(root, 'workspace-'))
  const prepared = prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
  let enterRecover
  let releaseRecover
  const entered = new Promise(resolve => {
    enterRecover = resolve
  })
  const released = new Promise(resolve => {
    releaseRecover = resolve
  })
  const winnerPromise = startFilesystemAuthorityBroker({
    beforeRecover: () => {
      enterRecover()
      return released
    },
    controlRoot: prepared.controlRoot,
    secret: prepared.secret
  })
  await entered
  let loserRecoverCalls = 0
  const loserDatabase = {
    close() {},
    recover() {
      loserRecoverCalls += 1
    }
  }
  await assert.rejects(
    startFilesystemAuthorityBroker({
      controlRoot: prepared.controlRoot,
      database: loserDatabase,
      secret: prepared.secret
    }),
    { code: 'EADDRINUSE' }
  )
  assert.equal(loserRecoverCalls, 0)
  releaseRecover()
  const winner = await winnerPromise
  const options = {
    autoStart: false,
    controlRoot: prepared.controlRoot,
    secret: prepared.secret,
    timeoutMs: 5000
  }
  const left = await openFilesystemAuthorityForTest(workspace, options)
  const right = await openFilesystemAuthorityForTest(workspace, options)
  try {
    await left.claimMutation('broker-owner', 'winner-row')
    await assert.rejects(
      startFilesystemAuthorityBroker({
        controlRoot: prepared.controlRoot,
        database: loserDatabase,
        secret: prepared.secret
      }),
      { code: 'EADDRINUSE' }
    )
    assert.equal(loserRecoverCalls, 0)
    await assert.rejects(right.claimMutation('broker-owner', 'winner-row'), { code: 'asset_create_in_progress' })
  } finally {
    left.close()
    right.close()
    await winner.close()
    rmSync(root, { force: true, recursive: true })
  }
})
