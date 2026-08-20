import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveClaudeAccountQuota } from '../src/claude/usage'

const tempDirs: string[] = []
const platformSpy = vi.spyOn(process, 'platform', 'get')

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const writeDesktopUsage = async (realHome: string, samples: unknown[]) => {
  const dir = join(realHome, 'Library', 'Application Support', 'Claude')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plan-usage-history.json'), JSON.stringify({ version: 2, samples }))
}

const writeDesktopUsageCache = async (
  realHome: string,
  organizationId: string,
  body: unknown,
  updatedAt: number,
  suffix = '?skip_spend=1',
  fileName = 'usage-response_0'
) => {
  const dir = join(realHome, 'Library', 'Application Support', 'Claude', 'Cache', 'Cache_Data')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, fileName),
    Buffer.concat([
      Buffer.from(`https://claude.ai/api/organizations/${organizationId}/usage${suffix}\0`),
      zstdCompressSync(Buffer.from(JSON.stringify(body))),
      Buffer.from(`\nHTTP/1.1 200\ndate:${new Date(updatedAt).toUTCString()}\n`)
    ])
  )
}

const writeCredential = async (configDir: string, accessToken: string, expiresInMs = 60_000) => {
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken, expiresAt: Date.now() + expiresInMs } })
  )
}

const formatLocalReset = (value: string) => {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `Resets ${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`
}

beforeEach(() => {
  platformSpy.mockReturnValue('linux')
  vi.unstubAllGlobals()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude account usage sources', () => {
  it('uses the newest fresh Desktop sample for the exact organization', async () => {
    platformSpy.mockReturnValue('darwin')
    const realHome = await createTempDir('ow-claude-desktop-usage-')
    const now = Date.now()
    await writeDesktopUsage(realHome, [
      { t: now - 60_000, org: 'org-other', u: { fh: 99, sd: 99 } },
      { t: now - 30_000, org: 'org-current', u: { fh: 12, sd: 34 } },
      { t: now - 90_000, org: 'org-current', u: { fh: 1, sd: 2 } }
    ])

    await expect(resolveClaudeAccountQuota({
      cachedQuota: { summary: 'stale', updatedAt: now - 120_000 },
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toEqual({
      summary: '5-hour usage: 12% · 7-day usage: 34%',
      metrics: [
        {
          id: 'five-hour',
          label: '5-hour usage',
          value: '12%',
          primary: true,
          description: 'Reset time unavailable; refresh to query Claude.'
        },
        {
          id: 'seven-day',
          label: '7-day usage',
          value: '34%',
          primary: true,
          description: 'Reset time unavailable; refresh to query Claude.'
        }
      ],
      updatedAt: now - 30_000
    })
  })

  it('ignores stale and cross-organization Desktop samples', async () => {
    platformSpy.mockReturnValue('darwin')
    const realHome = await createTempDir('ow-claude-stale-desktop-usage-')
    const now = Date.now()
    await writeDesktopUsage(realHome, [
      { t: now - 31 * 60_000, org: 'org-current', u: { fh: 10, sd: 20 } },
      { t: now - 10_000, org: 'org-other', u: { fh: 90, sd: 90 } }
    ])

    await expect(resolveClaudeAccountQuota({
      configDir: join(realHome, 'missing-profile'),
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toBeUndefined()
  })

  it('reads reset times from the exact organization Desktop HTTP cache', async () => {
    platformSpy.mockReturnValue('darwin')
    const realHome = await createTempDir('ow-claude-desktop-cache-')
    const now = Date.now()
    const resetAt = '2030-01-07T13:59:59.000Z'
    await writeDesktopUsageCache(realHome, 'org-current', {
      five_hour: { utilization: 0, resets_at: null },
      seven_day: { utilization: 34, resets_at: resetAt }
    }, now - 5_000)

    await expect(resolveClaudeAccountQuota({
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toMatchObject({
      summary: '5-hour usage: 0% · 7-day usage: 34%',
      metrics: [
        expect.objectContaining({
          id: 'five-hour',
          value: '0%',
          description: 'Starts when a message is sent.'
        }),
        expect.objectContaining({
          id: 'seven-day',
          value: '34%',
          description: formatLocalReset(resetAt)
        })
      ]
    })
  })

  it('does not treat a missing or malformed reset as a session that has not started', async () => {
    platformSpy.mockReturnValue('darwin')
    const now = Date.now()
    for (
      const [name, fiveHour] of [
        ['missing', { utilization: 0 }],
        ['malformed', { utilization: 0, resets_at: 'not-a-time' }]
      ] as const
    ) {
      const realHome = await createTempDir(`ow-claude-${name}-reset-cache-`)
      await writeDesktopUsageCache(realHome, 'org-current', { five_hour: fiveHour }, now - 5_000)

      await expect(resolveClaudeAccountQuota({
        expectedEmail: 'ada@example.test',
        expectedOrganizationId: 'org-current',
        realHome
      })).resolves.toMatchObject({
        metrics: [expect.objectContaining({
          id: 'five-hour',
          value: '0%',
          description: 'Reset time unavailable; refresh to query Claude.'
        })]
      })
    }
  })

  it('drops a Desktop cache window that reset after the response was stored', async () => {
    platformSpy.mockReturnValue('darwin')
    const realHome = await createTempDir('ow-claude-reset-desktop-cache-')
    const now = Date.now()
    await writeDesktopUsageCache(realHome, 'org-current', {
      seven_day: { utilization: 34, resets_at: new Date(now - 60_000).toISOString() }
    }, now - 5 * 60_000)

    await expect(resolveClaudeAccountQuota({
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toBeUndefined()
  })

  it('rejects stale, prefix-lookalike, malformed, and oversized Desktop cache entries', async () => {
    platformSpy.mockReturnValue('darwin')
    const now = Date.now()
    const validBody = {
      seven_day: { utilization: 34, resets_at: '2030-01-07T13:59:59.000Z' }
    }
    for (
      const [name, suffix, body, ageMs] of [
        ['stale_0', '?skip_spend=1', validBody, 31 * 60_000],
        ['lookalike_0', '-export', validBody, 5_000],
        ['parenthesized-lookalike_0', '(lookalike)', validBody, 5_000],
        ['oversized_0', '?skip_spend=1', { ...validBody, padding: 'x'.repeat(1_000_001) }, 5_000]
      ] as const
    ) {
      const realHome = await createTempDir(`ow-claude-${name}-`)
      await writeDesktopUsageCache(realHome, 'org-current', body, now - ageMs, suffix, name)
      await expect(resolveClaudeAccountQuota({
        expectedEmail: 'ada@example.test',
        expectedOrganizationId: 'org-current',
        realHome
      })).resolves.toBeUndefined()
    }

    const malformedHome = await createTempDir('ow-claude-malformed-cache-')
    const cacheDir = join(malformedHome, 'Library', 'Application Support', 'Claude', 'Cache', 'Cache_Data')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      join(cacheDir, 'malformed_0'),
      `https://claude.ai/api/organizations/org-current/usage?skip_spend=1\0${JSON.stringify(validBody)}`
    )
    await expect(resolveClaudeAccountQuota({
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome: malformedHome
    })).resolves.toBeUndefined()
  })

  it('keeps fresh Desktop percentages and supplements reset times from verified CLI cache', async () => {
    platformSpy.mockReturnValue('darwin')
    const realHome = await createTempDir('ow-claude-merged-desktop-usage-')
    const now = Date.now()
    await writeDesktopUsage(realHome, [
      { t: now - 10_000, org: 'org-current', u: { fh: 12, sd: 34 } }
    ])

    await expect(resolveClaudeAccountQuota({
      cachedQuota: {
        summary: 'older values',
        metrics: [
          {
            id: 'five-hour',
            label: '5-hour usage',
            value: '11%',
            description: 'Resets 2030-01-01T00:00:00.000Z'
          },
          {
            id: 'seven-day',
            label: '7-day usage',
            value: '33%',
            description: 'Resets 2030-01-07T00:00:00.000Z'
          }
        ],
        updatedAt: now - 60_000
      },
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-current',
      realHome
    })).resolves.toMatchObject({
      summary: '5-hour usage: 12% · 7-day usage: 34%',
      metrics: [
        expect.objectContaining({
          id: 'five-hour',
          value: '12%',
          description: 'Resets 2030-01-01T00:00:00.000Z'
        }),
        expect.objectContaining({
          id: 'seven-day',
          value: '34%',
          description: 'Resets 2030-01-07T00:00:00.000Z'
        })
      ]
    })
  })

  it('queries OAuth usage in memory when the profile matches the selected account', async () => {
    const realHome = await createTempDir('ow-claude-oauth-usage-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'matching-usage-token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account: { uuid: 'account-test', email: 'ada@example.test', has_claude_max: true },
            organization: { uuid: 'org-test', name: 'Example' }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            five_hour: { utilization: 42, resets_at: '2030-01-01T00:00:00.000Z' },
            seven_day: { utilization: 18, resets_at: '2030-01-07T00:00:00.000Z' }
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveClaudeAccountQuota({
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    })).resolves.toMatchObject({
      summary: '5-hour usage: 42% · 7-day usage: 18%',
      metrics: [
        expect.objectContaining({
          id: 'five-hour',
          value: '42%',
          description: formatLocalReset('2030-01-01T00:00:00.000Z')
        }),
        expect.objectContaining({
          id: 'seven-day',
          value: '18%',
          description: formatLocalReset('2030-01-07T00:00:00.000Z')
        })
      ]
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: 'Bearer matching-usage-token',
        'anthropic-beta': 'oauth-2025-04-20'
      })
    })
  })

  it('rejects expired OAuth usage windows', async () => {
    const realHome = await createTempDir('ow-claude-expired-oauth-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'expired-usage-token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account: { uuid: 'account-test', email: 'ada@example.test' },
            organization: { uuid: 'org-test' }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            five_hour: { utilization: 42, resets_at: '2020-01-01T00:00:00.000Z' }
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveClaudeAccountQuota({
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    })).resolves.toBeUndefined()
  })

  it('rejects OAuth quota when the token profile belongs to another account', async () => {
    const realHome = await createTempDir('ow-claude-mismatched-oauth-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'mismatched-usage-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          account: { uuid: 'account-other', email: 'other@example.test', has_claude_pro: true },
          organization: { uuid: 'org-other', name: 'Other' }
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveClaudeAccountQuota({
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honors OAuth usage Retry-After without repeating requests', async () => {
    vi.useFakeTimers()
    const realHome = await createTempDir('ow-claude-rate-limited-oauth-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'rate-limited-usage-token', 2 * 60 * 60 * 1000)
    const profileResponse = () =>
      new Response(
        JSON.stringify({
          account: { uuid: 'account-test', email: 'ada@example.test', has_claude_max: true },
          organization: { uuid: 'org-test', name: 'Example' }
        }),
        { status: 200 }
      )
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'rate_limit_error',
            message: 'Rate limited.'
          }),
          { status: 429, headers: { 'retry-after': '3600' } }
        )
      )
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            five_hour: { utilization: 1, resets_at: '2030-01-01T00:00:00.000Z' }
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const options = {
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    }

    await expect(resolveClaudeAccountQuota(options)).resolves.toBeUndefined()
    vi.advanceTimersByTime(10 * 60 * 1000)
    await expect(resolveClaudeAccountQuota(options)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(51 * 60 * 1000)
    await expect(resolveClaudeAccountQuota(options)).resolves.toMatchObject({
      metrics: [expect.objectContaining({ id: 'five-hour', value: '1%' })]
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('honors OAuth profile Retry-After without repeating requests', async () => {
    const realHome = await createTempDir('ow-claude-profile-rate-limited-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'rate-limited-profile-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ type: 'rate_limit_error', message: 'Rate limited.' }),
        { status: 429, headers: { 'retry-after': '3600' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const options = {
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    }

    await expect(resolveClaudeAccountQuota(options)).resolves.toBeUndefined()
    await expect(resolveClaudeAccountQuota(options)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an OAuth response that declares an oversized payload', async () => {
    const realHome = await createTempDir('ow-claude-oversized-oauth-home-')
    const configDir = join(realHome, 'config')
    await writeCredential(configDir, 'oversized-response-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-length': '1000001' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveClaudeAccountQuota({
      configDir,
      expectedEmail: 'ada@example.test',
      expectedOrganizationId: 'org-test',
      forceNetwork: true,
      realHome
    })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
