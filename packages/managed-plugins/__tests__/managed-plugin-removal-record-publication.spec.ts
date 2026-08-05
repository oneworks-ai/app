import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MAX_REMOVAL_RECORD_BYTES } from '../src/managed-plugin-removal-journal'
import { publishRemovalRecord } from '../src/managed-plugin-removal-record-publication'

describe.runIf(process.platform === 'darwin')('managed plugin removal record publication', () => {
  let journal: string | undefined

  const createJournal = async () => {
    journal = await mkdtemp(path.join(tmpdir(), 'ow-removal-record-'))
    return journal
  }

  afterEach(async () => {
    if (journal != null) await rm(journal, { force: true, recursive: true })
    journal = undefined
  })

  it('atomically rejects a preexisting final record without replacement', async () => {
    const directory = await createJournal()
    const operationId = '9'.repeat(64)
    const target = path.join(directory, `${operationId}.json`)
    await writeFile(target, 'attacker-owned')

    await expect(publishRemovalRecord(
      directory,
      operationId,
      'a'.repeat(64),
      '{"record":"candidate"}\n'
    )).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(readFile(target, 'utf8')).resolves.toBe('attacker-owned')
  })

  it('rejects an oversized record before creating any publication artifact', async () => {
    const directory = await createJournal()
    await expect(publishRemovalRecord(
      directory,
      '7'.repeat(64),
      'b'.repeat(64),
      'x'.repeat(MAX_REMOVAL_RECORD_BYTES + 1)
    )).rejects.toThrow('transaction record is invalid')
    await expect(readdir(directory)).resolves.toEqual([])
  })
})
