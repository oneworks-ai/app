'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { once } = require('node:events')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot,
  startFilesystemAuthorityBroker
} = require('../testing.cjs')

const getConnectionCount = server =>
  new Promise((resolve, reject) => {
    server.getConnections((error, count) => error == null ? resolve(count) : reject(error))
  })

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

test('holds a trusted local connection until broker recovery is ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ow-authority-readiness-'))
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
  const brokerPromise = startFilesystemAuthorityBroker({
    beforeRecover: context => {
      enterRecover(context)
      return released
    },
    controlRoot: prepared.controlRoot,
    secret: prepared.secret
  })
  const { server } = await entered
  const connected = once(server, 'connection')
  const authorityPromise = openFilesystemAuthorityForTest(workspace, {
    autoStart: false,
    controlRoot: prepared.controlRoot,
    secret: prepared.secret,
    timeoutMs: 1000
  })
  await connected

  releaseRecover()
  const [broker, authority] = await Promise.all([brokerPromise, authorityPromise])
  try {
    assert.equal(await authority.claimMutation('broker-readiness', 'slow-start'), 1)
  } finally {
    authority.close()
    await broker.close()
    rmSync(root, { force: true, recursive: true })
  }
})

test('cleans up a connection that times out while broker recovery never becomes ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ow-authority-timeout-'))
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
  const brokerPromise = startFilesystemAuthorityBroker({
    beforeRecover: context => {
      enterRecover(context)
      return released
    },
    controlRoot: prepared.controlRoot,
    secret: prepared.secret
  })
  const { server } = await entered
  let socket
  const closed = once(server, 'connection').then(([connection]) => {
    socket = connection
    return once(socket, 'close')
  })
  const authorityPromise = openFilesystemAuthorityForTest(workspace, {
    autoStart: false,
    controlRoot: prepared.controlRoot,
    secret: prepared.secret,
    timeoutMs: 25
  })
  await assert.rejects(
    authorityPromise,
    { code: 'asset_filesystem_authority_unavailable', committed: false }
  )
  await closed
  assert.equal(socket.listenerCount('data'), 0)

  releaseRecover()
  const broker = await brokerPromise
  try {
    assert.equal(await getConnectionCount(broker.server), 0)
  } finally {
    await broker.close()
    rmSync(root, { force: true, recursive: true })
  }
})

test('rejects and cleans up pending connections when broker recovery fails terminally', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ow-authority-fail-'))
  const workspace = mkdtempSync(join(root, 'workspace-'))
  const prepared = prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
  let enterRecover
  let failRecover
  const entered = new Promise(resolve => {
    enterRecover = resolve
  })
  const failed = new Promise(resolve => {
    failRecover = resolve
  })
  const brokerPromise = startFilesystemAuthorityBroker({
    beforeRecover: async context => {
      enterRecover(context)
      await failed
      throw new Error('recovery failed')
    },
    controlRoot: prepared.controlRoot,
    secret: prepared.secret
  })
  const { server } = await entered
  let socket
  const connected = once(server, 'connection').then(([connection]) => {
    socket = connection
  })
  const authorityPromise = openFilesystemAuthorityForTest(workspace, {
    autoStart: false,
    controlRoot: prepared.controlRoot,
    secret: prepared.secret,
    timeoutMs: 1000
  })
  await connected
  failRecover()

  await assert.rejects(brokerPromise, /recovery failed/u)
  await assert.rejects(
    authorityPromise,
    { code: 'asset_filesystem_authority_unavailable', committed: false }
  )
  assert.equal(socket.listenerCount('data'), 0)
  rmSync(root, { force: true, recursive: true })
})
