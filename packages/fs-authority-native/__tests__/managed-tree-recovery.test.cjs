'use strict'

const { existsSync } = require('node:fs')
const { test } = require('node:test')
const { openTransaction } = require('../transaction-token.cjs')
const { assert, getSecret, join, prepareTree } = require('./managed-tree-fixture.cjs')
const indeterminate = warning => ({ state: 'committed-indeterminate', warnings: [warning] })

test('reports fixed indeterminate outcomes for parent sync and rollback collision', async () => {
  const syncing = await prepareTree({ fault: 'tree-parent-sync', key: 'sync-failure' })
  try {
    assert.deepEqual(
      await syncing.authority.stageManagedTree(syncing.mutation),
      indeterminate('managed_tree_quarantine_sync_indeterminate')
    )
  } finally {
    syncing.authority.close()
  }
  const collision = await prepareTree({ fault: 'tree-stage-rollback-collision', key: 'rollback-collision' })
  const payload = openTransaction(getSecret(), collision.transaction)
  try {
    assert.deepEqual(
      await collision.authority.stageManagedTree(collision.mutation),
      indeterminate('managed_tree_stage_rollback_indeterminate')
    )
    assert.equal(existsSync(join(collision.parent, 'plugin')), true)
    assert.equal(existsSync(join(collision.parent, payload.quarantineName, 'nested', 'marker.txt')), true)
  } finally {
    collision.authority.close()
  }
  const rollbackSync = await prepareTree({
    fault: 'tree-stage-rollback-sync-failure',
    key: 'rollback-sync-failure'
  })
  const rollbackPayload = openTransaction(getSecret(), rollbackSync.transaction)
  try {
    assert.deepEqual(
      await rollbackSync.authority.stageManagedTree(rollbackSync.mutation),
      indeterminate('managed_tree_stage_rollback_indeterminate')
    )
    assert.equal(existsSync(join(rollbackSync.parent, 'plugin', 'nested', 'marker.txt')), true)
    assert.equal(existsSync(join(rollbackSync.parent, rollbackPayload.quarantineName)), false)
  } finally {
    rollbackSync.authority.close()
  }
})
