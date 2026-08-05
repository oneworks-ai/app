'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot
} = require('../testing.cjs')
const { openTransaction } = require('../transaction-token.cjs')

const brokerPath = join(__dirname, '..', 'broker.cjs')
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const startBroker = controlRoot => {
  const child = spawn(process.execPath, [brokerPath, '--test-control-root', controlRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const ready = new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('READY ')) resolve()
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Broker exited before ready: ${code}`)))
  })
  return { child, exited, ready }
}
const stopBroker = async broker => {
  if (broker.child.exitCode == null && broker.child.signalCode == null) broker.child.kill('SIGTERM')
  await broker.exited
}
const createContext = () => {
  assert.equal(process.platform, 'darwin', 'managed tree crash recovery is macOS-only')
  const root = mkdtempSync(join(tmpdir(), 'ow-tree-crash-'))
  const workspace = mkdtempSync(join(root, 'workspace-'))
  const prepared = prepareFilesystemAuthorityTestControlRoot(join(root, 'control'))
  const parent = join(workspace, '.oneworks', 'managed-plugins')
  mkdirSync(join(parent, 'plugin', 'nested'), { recursive: true })
  writeFileSync(join(parent, 'plugin', 'nested', 'marker.txt'), 'managed tree')
  return { control: prepared.controlRoot, parent, root, secret: prepared.secret, workspace }
}
const open = (context, fault) =>
  openFilesystemAuthorityForTest(context.workspace, {
    autoStart: false,
    controlRoot: context.control,
    fault,
    secret: context.secret,
    timeoutMs: 5000
  })
const claim = async (context, key, fault, token) => {
  const authority = await open(context, fault)
  const generation = await authority.claimMutation('managed-plugin-directory', key)
  let transaction = token
  if (transaction == null) {
    transaction = await authority.prepareManagedTree({
      authorityId: authority.id,
      entryName: 'plugin',
      generation,
      parentSegments: ['.oneworks', 'managed-plugins']
    })
  }
  return { authority, mutation: { authorityId: authority.id, generation, transaction }, transaction }
}
const expectCrash = async (promise, broker) => {
  await assert.rejects(promise, { code: 'managed_tree_mutation_indeterminate', committed: 'indeterminate' })
  assert.deepEqual(await broker.exited, { code: 86, signal: null })
}

test('recovers all forward mutations after a real broker crash before parent fsync', async () => {
  for (const action of ['stage', 'restore', 'remove']) {
    const context = createContext()
    let broker = startBroker(context.control)
    await broker.ready
    const key = `${action}-crash-window`
    const initial = await claim(context, key)
    if (action !== 'stage') await initial.authority.stageManagedTree(initial.mutation)
    initial.authority.close()
    await delay(100)
    const crashing = await claim(context, key, `crash-after-tree-${action}-before-sync`, initial.transaction)
    await expectCrash(crashing.authority[`${action}ManagedTree`](crashing.mutation), broker)
    crashing.authority.close()
    broker = startBroker(context.control)
    await broker.ready
    const syncGate = await claim(context, key, 'tree-parent-sync', initial.transaction)
    const syncWarning = action === 'stage'
      ? 'managed_tree_quarantine_sync_indeterminate'
      : `managed_tree_${action}_sync_indeterminate`
    assert.deepEqual(await syncGate.authority[`${action}ManagedTree`](syncGate.mutation), {
      state: 'committed-indeterminate',
      warnings: [syncWarning]
    })
    syncGate.authority.close()
    await delay(100)
    const recovery = await claim(context, key, undefined, initial.transaction)
    try {
      const result = await recovery.authority[`${action}ManagedTree`](recovery.mutation)
      if (action === 'remove') {
        assert.deepEqual(result, {
          state: 'committed-indeterminate',
          warnings: ['managed_tree_remove_state_indeterminate']
        })
        const payload = openTransaction(context.secret, initial.transaction)
        assert.equal(existsSync(join(context.parent, payload.quarantineName)), false)
      } else {
        assert.deepEqual(result, { state: action === 'stage' ? 'quarantined' : 'restored', warnings: [] })
      }
    } finally {
      recovery.authority.close()
      await stopBroker(broker)
      rmSync(context.root, { force: true, recursive: true })
    }
  }
})
