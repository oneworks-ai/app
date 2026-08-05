'use strict'

const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { test } = require('node:test')
const { openTransaction } = require('../transaction-token.cjs')
const { assert, delayedChild, getRoot, getSecret, join, prepareTree } = require('./managed-tree-fixture.cjs')

test('rejects an ancestor swap at the final quarantine boundary', async () => {
  const prepared = await prepareTree({ fault: 'pause-after-tree-final-check', key: 'ancestor-swap' })
  const movedParent = `${prepared.parent}-original`
  const adversary = delayedChild(
    `
    const { mkdirSync, renameSync, writeFileSync } = require('node:fs')
    setTimeout(() => {
      renameSync(process.argv[1], process.argv[2])
      mkdirSync(process.argv[1] + '/plugin/nested', { recursive: true })
      writeFileSync(process.argv[1] + '/plugin/nested/marker.txt', 'replacement tree')
    }, 200)
  `,
    [prepared.parent, movedParent]
  )
  try {
    await assert.rejects(prepared.authority.stageManagedTree(prepared.mutation), { code: 'managed_tree_changed' })
    await adversary
    assert.equal(readFileSync(join(movedParent, 'plugin', 'nested', 'marker.txt'), 'utf8'), 'managed tree')
    assert.equal(readFileSync(join(prepared.parent, 'plugin', 'nested', 'marker.txt'), 'utf8'), 'replacement tree')
  } finally {
    prepared.authority.close()
  }
})

test('rejects a quarantine leaf swap before descriptor-relative cleanup', async () => {
  const prepared = await prepareTree({ fault: 'pause-before-tree-remove', key: 'leaf-swap' })
  const payload = openTransaction(getSecret(), prepared.transaction)
  const quarantine = join(prepared.parent, payload.quarantineName)
  const saved = `${quarantine}-saved`
  const outside = mkdtempSync(join(getRoot(), 'quarantine-outside-'))
  writeFileSync(join(outside, 'keep.txt'), 'outside stays intact')
  try {
    await prepared.authority.stageManagedTree(prepared.mutation)
    const adversary = delayedChild(
      `
      const { renameSync, symlinkSync } = require('node:fs')
      setTimeout(() => {
        renameSync(process.argv[1], process.argv[2])
        symlinkSync(process.argv[3], process.argv[1], 'dir')
      }, 200)
    `,
      [quarantine, saved, outside]
    )
    await assert.rejects(prepared.authority.removeManagedTree(prepared.mutation), { code: 'managed_tree_changed' })
    await adversary
    assert.equal(readFileSync(join(saved, 'nested', 'marker.txt'), 'utf8'), 'managed tree')
    assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'outside stays intact')
  } finally {
    prepared.authority.close()
  }
})

test('never clobbers a replacement source while restoring quarantine', async () => {
  const prepared = await prepareTree({ key: 'restore-no-clobber' })
  const payload = openTransaction(getSecret(), prepared.transaction)
  try {
    await prepared.authority.stageManagedTree(prepared.mutation)
    mkdirSync(join(prepared.parent, 'plugin'), { recursive: true })
    writeFileSync(join(prepared.parent, 'plugin', 'replacement.txt'), 'replacement stays')
    await assert.rejects(prepared.authority.restoreManagedTree(prepared.mutation), { code: 'managed_tree_exists' })
    assert.equal(readFileSync(join(prepared.parent, 'plugin', 'replacement.txt'), 'utf8'), 'replacement stays')
    assert.equal(
      readFileSync(join(prepared.parent, payload.quarantineName, 'nested', 'marker.txt'), 'utf8'),
      'managed tree'
    )
  } finally {
    prepared.authority.close()
  }
})

test('does not clean a verified quarantine moved away after its final open', async () => {
  const prepared = await prepareTree({ fault: 'pause-after-tree-cleanup-open', key: 'cleanup-move' })
  const payload = openTransaction(getSecret(), prepared.transaction)
  const quarantine = join(prepared.parent, payload.quarantineName)
  const movedOutside = join(getRoot(), 'moved-outside-quarantine')
  try {
    await prepared.authority.stageManagedTree(prepared.mutation)
    const adversary = delayedChild(
      `
      const { renameSync } = require('node:fs')
      setTimeout(() => renameSync(process.argv[1], process.argv[2]), 200)
    `,
      [quarantine, movedOutside]
    )
    await assert.rejects(prepared.authority.removeManagedTree(prepared.mutation), { code: 'managed_tree_changed' })
    await adversary
    assert.equal(readFileSync(join(movedOutside, 'nested', 'marker.txt'), 'utf8'), 'managed tree')
  } finally {
    prepared.authority.close()
  }
})
