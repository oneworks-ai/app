'use strict'

const { chmodSync, closeSync, fsyncSync, openSync } = require('node:fs')
const { join } = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const invalidClaim = () =>
  Object.assign(new Error('Filesystem authority claim is not current'), { code: 'asset_claim_lost' })

const openClaimDatabase = controlRoot => {
  const databasePath = join(controlRoot, 'claims.sqlite')
  const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false })
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS asset_claim_keys (
      claim_key TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)), owner_epoch TEXT,
      owner_token TEXT, last_state TEXT, updated_at_ms INTEGER NOT NULL
    ) STRICT;
  `)
  chmodSync(databasePath, 0o600)
  const directory = openSync(controlRoot, 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
  const select = database.prepare(
    'SELECT generation, active, owner_epoch, owner_token FROM asset_claim_keys WHERE claim_key = ?'
  )
  const insert = database.prepare(
    'INSERT INTO asset_claim_keys (claim_key, updated_at_ms) VALUES (?, ?) ON CONFLICT(claim_key) DO NOTHING'
  )
  const acquire = database.prepare(
    'UPDATE asset_claim_keys SET generation = generation + 1, active = 1, owner_epoch = ?, owner_token = ?, updated_at_ms = ? WHERE claim_key = ? AND generation = ? AND active = 0'
  )
  const finish = database.prepare(
    'UPDATE asset_claim_keys SET active = 0, owner_epoch = NULL, owner_token = NULL, last_state = ?, updated_at_ms = ? WHERE claim_key = ? AND generation = ? AND active = 1 AND owner_epoch = ? AND owner_token = ?'
  )
  const recover = database.prepare(
    "UPDATE asset_claim_keys SET active = 0, owner_epoch = NULL, owner_token = NULL, last_state = 'broker-recovered', updated_at_ms = ? WHERE active = 1 AND owner_epoch <> ?"
  )
  const transaction = callback => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const value = callback()
      database.exec('COMMIT')
      return value
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {}
      throw error
    }
  }
  const assertCurrent = claim => {
    const row = select.get(claim.key)
    if (
      row == null || row.active !== 1 || row.generation !== claim.generation || row.owner_epoch !== claim.epoch ||
      row.owner_token !== claim.token
    ) throw invalidClaim()
  }
  return {
    recover(epoch) {
      transaction(() => recover.run(Date.now(), epoch))
    },
    acquire(key, epoch, token) {
      return transaction(() => {
        const now = Date.now()
        insert.run(key, now)
        const current = select.get(key)
        if (current?.active === 1) {
          throw Object.assign(new Error('Filesystem authority claim is active'), { code: 'asset_create_in_progress' })
        }
        if (
          current == null || !Number.isSafeInteger(current.generation) || current.generation >= Number.MAX_SAFE_INTEGER
        ) throw new Error('Filesystem authority claim generation is invalid')
        if (acquire.run(epoch, token, now, key, current.generation).changes !== 1) throw invalidClaim()
        return { epoch, generation: current.generation + 1, key, token }
      })
    },
    finish(claim, state) {
      return transaction(() => {
        if (finish.run(state, Date.now(), claim.key, claim.generation, claim.epoch, claim.token).changes !== 1) {
          throw invalidClaim()
        }
      })
    },
    fencedPublish(claim, callback) {
      database.exec('BEGIN IMMEDIATE')
      let nativeResult
      try {
        assertCurrent(claim)
        nativeResult = callback()
        if (
          finish.run(nativeResult.state, Date.now(), claim.key, claim.generation, claim.epoch, claim.token).changes !==
            1
        ) throw invalidClaim()
        database.exec('COMMIT')
        return nativeResult
      } catch (error) {
        try {
          database.exec('ROLLBACK')
        } catch {}
        if (nativeResult != null) error.nativeResult = nativeResult
        throw error
      }
    },
    fencedMutation(claim, callback) {
      database.exec('BEGIN IMMEDIATE')
      let nativeResult
      try {
        assertCurrent(claim)
        nativeResult = callback()
        database.exec('COMMIT')
        return nativeResult
      } catch (error) {
        try {
          database.exec('ROLLBACK')
        } catch {}
        if (nativeResult != null) error.nativeResult = nativeResult
        throw error
      }
    },
    fencedFinish(claim, callback) {
      database.exec('BEGIN IMMEDIATE')
      let nativeResult
      try {
        assertCurrent(claim)
        nativeResult = callback()
        if (nativeResult.state === 'error') {
          database.exec('ROLLBACK')
          return nativeResult
        }
        if (
          finish.run(nativeResult.state, Date.now(), claim.key, claim.generation, claim.epoch, claim.token).changes !==
            1
        ) throw invalidClaim()
        database.exec('COMMIT')
        return nativeResult
      } catch (error) {
        try {
          database.exec('ROLLBACK')
        } catch {}
        if (nativeResult != null) error.nativeResult = nativeResult
        throw error
      }
    },
    close() {
      database.close()
    }
  }
}
module.exports = { openClaimDatabase }
