import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writeCodexPrivateFileAtomically } from '#~/runtime/atomic-file.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('codex private atomic file writer', () => {
  it('never exposes a missing or partial config to concurrent readers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ow-codex-atomic-config-'))
    const filePath = join(directory, 'config.toml')
    tempDirs.push(directory)
    const versions = [
      `model = "initial"\n${'#'.repeat(128_000)}\n`,
      ...Array.from({ length: 12 }, (_, index) => `model = "version-${index}"\n${String(index).repeat(128_000)}\n`)
    ]
    await writeCodexPrivateFileAtomically(filePath, versions[0]!)
    const observed: string[] = []
    const state = { writing: true }
    const reader = (async () => {
      for (let index = 0; index < 10_000; index += 1) {
        observed.push(await readFile(filePath, 'utf8'))
        if (!state.writing) return
      }
      throw new Error('Concurrent config reader did not observe writer completion.')
    })()

    for (const version of versions.slice(1)) {
      await writeCodexPrivateFileAtomically(filePath, version)
    }
    state.writing = false
    await reader

    expect(observed.length).toBeGreaterThan(1)
    expect(observed.every(content => versions.includes(content))).toBe(true)
  })
})
