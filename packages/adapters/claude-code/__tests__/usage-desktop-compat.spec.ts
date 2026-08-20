import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveClaudeAccountQuota } from '../src/claude/usage'

vi.mock('node:zlib', () => ({}))

const tempDirs: string[] = []
const platformSpy = vi.spyOn(process, 'platform', 'get')

beforeEach(() => {
  platformSpy.mockReturnValue('darwin')
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude Desktop usage compatibility', () => {
  it('ignores cached zstd usage when the current Node runtime has no decompressor', async () => {
    const realHome = await mkdtemp(join(tmpdir(), 'ow-claude-no-zstd-'))
    tempDirs.push(realHome)
    const cacheDir = join(realHome, 'Library', 'Application Support', 'Claude', 'Cache', 'Cache_Data')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      join(cacheDir, 'usage_0'),
      Buffer.concat([
        Buffer.from('https://claude.ai/api/organizations/org-current/usage?skip_spend=1\0'),
        Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x00]),
        Buffer.from(`\nHTTP/1.1 200\ndate:${new Date().toUTCString()}\n`)
      ])
    )

    await expect(resolveClaudeAccountQuota({
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toBeUndefined()
  })
})
