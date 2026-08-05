'use strict'

const { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } = require('node:fs')
const { test } = require('node:test')
const { assert, delay, getRoot, join, open, prepareTree } = require('./managed-tree-fixture.cjs')

test('fences generic mutation claims by exact authority namespace and key', async () => {
  const left = await open()
  const right = await open()
  try {
    const generation = await left.claimMutation('managed-plugin-directory', 'workspace-a')
    await assert.rejects(right.claimMutation('managed-plugin-directory', 'workspace-a'), {
      code: 'asset_create_in_progress'
    })
    assert.equal(await left.release(generation), true)
    assert.equal(await right.claimMutation('managed-plugin-directory', 'workspace-a'), 2)
  } finally {
    left.close()
    right.close()
  }
})

test('removes a nested managed tree without following contained symlinks', async () => {
  const outside = mkdtempSync(join(getRoot(), 'managed-tree-outside-'))
  const outsideFile = join(outside, 'keep.txt')
  writeFileSync(outsideFile, 'outside stays intact')
  const prepared = await prepareTree()
  try {
    symlinkSync(outsideFile, join(prepared.parent, 'plugin', 'nested', 'outside-link'))
    assert.equal(prepared.transaction.includes('plugin'), false)
    assert.deepEqual(await prepared.authority.stageManagedTree(prepared.mutation), {
      state: 'quarantined',
      warnings: []
    })
    assert.deepEqual(await prepared.authority.removeManagedTree(prepared.mutation), {
      state: 'removed',
      warnings: []
    })
    assert.equal(existsSync(join(prepared.parent, 'plugin')), false)
    assert.equal(readFileSync(outsideFile, 'utf8'), 'outside stays intact')
  } finally {
    prepared.authority.close()
  }
})

test('recovers a staged tree under a new fenced generation', async () => {
  const prepared = await prepareTree({ key: 'recoverable' })
  assert.deepEqual(await prepared.authority.stageManagedTree(prepared.mutation), {
    state: 'quarantined',
    warnings: []
  })
  prepared.authority.close()
  await delay(100)
  const recovery = await open()
  try {
    const generation = await recovery.claimMutation('managed-plugin-directory', 'recoverable')
    const mutation = { authorityId: recovery.id, generation, transaction: prepared.transaction }
    assert.deepEqual(await recovery.stageManagedTree(mutation), { state: 'quarantined', warnings: [] })
    assert.deepEqual(await recovery.restoreManagedTree(mutation), { state: 'restored', warnings: [] })
    assert.equal(readFileSync(join(prepared.parent, 'plugin', 'nested', 'marker.txt'), 'utf8'), 'managed tree')
  } finally {
    recovery.close()
  }
})
