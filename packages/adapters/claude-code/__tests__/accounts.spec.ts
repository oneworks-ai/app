import { Buffer } from 'node:buffer'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '@oneworks/types'
import { resolveGlobalAdapterAccountDir } from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import {
  acquireClaudeAccountSessionLease,
  getClaudeAccounts,
  manageClaudeAccount,
  resolveClaudeRuntimeAccount
} from '../src/claude/accounts'
import {
  createClaudeAccountsTestContext as createContext,
  createClaudeAccountsTestHarness,
  readClaudeAccountsTestGlobalConfig as readGlobalConfig,
  waitForClaudeAccountsTestPath as waitForPath
} from './accounts.test-helpers'

const cliMock = vi.hoisted(() => ({ path: '' }))

vi.mock('../src/claude/cli', () => ({
  ensureClaudeCliPath: vi.fn(async () => cliMock.path)
}))

const { cleanup, createFakeClaudeCli, createTempDir } = createClaudeAccountsTestHarness()
const platformSpy = vi.spyOn(process, 'platform', 'get')

beforeEach(async () => {
  platformSpy.mockReturnValue('linux')
  cliMock.path = await createFakeClaudeCli()
})

afterEach(async () => {
  await cleanup()
})

afterAll(() => {
  platformSpy.mockRestore()
})

describe('claude account lifecycle', () => {
  it.runIf(process.platform !== 'win32')(
    'keeps a whitespace-bearing real home distinct for account state',
    async () => {
      const cwd = await createTempDir('ow-claude-workspace-')
      const realHome = await createTempDir('ow-claude-home-')
      const exactHome = `${realHome} `
      await mkdir(exactHome, { recursive: true })
      await writeFile(
        join(exactHome, '.claude.json'),
        JSON.stringify({ cachedUsage: { fiveHour: { utilization: 7 } } })
      )
      const accounts = await getClaudeAccounts(createContext({ cwd, realHome: exactHome }), {})
      expect(accounts.accounts).toEqual(expect.any(Array))
    }
  )

  it('serializes same-key adds before a second official login can change credentials', async () => {
    const cwd = await createTempDir('ow-claude-concurrent-workspace-')
    const realHome = await createTempDir('ow-claude-concurrent-home-')
    const ctx = createContext({ cwd, realHome })
    const progress = vi.fn()

    const outcomes = await Promise.allSettled([
      manageClaudeAccount(ctx, { action: 'add', account: 'shared', onProgress: progress }),
      manageClaudeAccount(ctx, { action: 'add', account: 'shared', onProgress: progress })
    ])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: expect.stringMatching(/already exists/i) })
    })
    expect(
      progress.mock.calls.filter(([event]) =>
        event.stream === 'status' && event.message.includes('Starting official Claude login')
      )
    ).toHaveLength(1)

    const globalConfig = await readGlobalConfig(realHome)
    expect(Object.keys((globalConfig.adapters?.['claude-code'] as any).accounts)).toEqual(['shared'])
  })

  it('uses official auth commands, stores portable credentials, and exposes cached usage', async () => {
    const cwd = await createTempDir('ow-claude-workspace-')
    const realHome = await createTempDir('ow-claude-home-')
    let ctx = createContext({ cwd, realHome })
    const progress = vi.fn()

    const added = await manageClaudeAccount(ctx, {
      action: 'add',
      account: 'Work Account',
      onProgress: progress
    })

    expect(added.accountKey).toBe('work-account')
    expect(added.account).toMatchObject({
      email: 'ada@example.test',
      planType: 'pro',
      status: 'ready',
      quota: {
        summary: '5-hour usage: 42% · 7-day usage: 18%'
      }
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      stream: 'status',
      message: expect.stringContaining('official Claude login')
    }))

    const globalConfig = await readGlobalConfig(realHome)
    const storedAccount = (globalConfig.adapters?.['claude-code'] as any).accounts['work-account']
    expect(storedAccount).toMatchObject({
      auth: {
        storage: 'inline',
        type: 'claude-credentials-json',
        portability: 'portable',
        encoding: 'base64'
      },
      state: {
        type: 'claude-account-state-json',
        portability: 'portable',
        encoding: 'base64'
      },
      source: 'claude-auth-login'
    })
    expect(Buffer.from(storedAccount.auth.token, 'base64').toString('utf8')).toContain('test-token')
    expect(Buffer.from(storedAccount.state.token, 'base64').toString('utf8')).not.toContain('test-nested-secret')
    expect(storedAccount.quota.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'extra-usage', value: '9%' })
    ]))

    ctx = createContext({ cwd, realHome, userConfig: globalConfig })
    const accountConfigDir = join(
      resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'),
      'config'
    )
    await writeFile(
      join(accountConfigDir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { displayName: 'Ada' },
        cachedUsageUtilization: {
          fetchedAtMs: 1700000001000,
          utilization: {
            five_hour: { utilization: 7, resets_at: '2030-01-01T00:00:00.000Z' }
          }
        }
      })
    )
    await writeFile(
      join(accountConfigDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'refreshed-token' } })
    )
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts).toMatchObject({
      defaultAccount: 'work-account',
      accounts: [{
        key: 'work-account',
        status: 'ready',
        quota: { summary: '5-hour usage: 7%' }
      }]
    })
    await manageClaudeAccount(ctx, { action: 'refresh', account: 'work-account' })
    const refreshedConfig = await readGlobalConfig(realHome)
    const refreshedAccount = (refreshedConfig.adapters?.['claude-code'] as any).accounts['work-account']
    expect(refreshedAccount.credentialRevision).not.toBe(storedAccount.credentialRevision)
    expect(Buffer.from(refreshedAccount.auth.token, 'base64').toString('utf8')).toContain('refreshed-token')
    ctx = createContext({ cwd, realHome, userConfig: refreshedConfig })
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'work-account'
    })).resolves.toMatchObject({
      accountKey: 'work-account',
      configDir: join(
        resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'),
        'config'
      )
    })

    const releaseSessionLease = await acquireClaudeAccountSessionLease(ctx, 'work-account')
    await expect(manageClaudeAccount(ctx, {
      action: 'remove',
      account: 'work-account'
    })).rejects.toThrow(/active sessions/i)
    await releaseSessionLease()
    await manageClaudeAccount(ctx, { action: 'remove', account: 'work-account' })
    const removedConfig = await readGlobalConfig(realHome)
    expect((removedConfig.adapters?.['claude-code'] as any).accounts).toEqual({})
    expect((removedConfig.adapters?.['claude-code'] as any).accountTombstones['work-account'])
      .toEqual([storedAccount.generation])
    await expect(access(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'))).rejects.toThrow()
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'work-account'
    })).rejects.toThrow(/deleted before this operation/i)
    await expect(access(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'work-account'))).rejects.toThrow()
  })

  it.each([
    ['missing', undefined],
    ['unknown', { storage: 'future', type: 'future-credential' }],
    ['malformed', {
      storage: 'inline',
      type: 'claude-credentials-json',
      encoding: 'base64',
      portability: 'portable',
      token: Buffer.from('not-json', 'utf8').toString('base64')
    }]
  ])('purges stale materialized credentials for a %s managed auth envelope', async (key, auth) => {
    const cwd = await createTempDir(`ow-claude-${key}-envelope-workspace-`)
    const realHome = await createTempDir(`ow-claude-${key}-envelope-home-`)
    const account = {
      ...(auth == null ? {} : { auth }),
      generation: `generation-${key}`,
      credentialRevision: '1:00000000-0000-4000-8000-000000000001'
    }
    const userConfig = {
      adapters: {
        'claude-code': {
          accounts: { [key]: account },
          defaultAccount: key
        }
      }
    } as unknown as Config
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(userConfig))
    const ctx = createContext({ cwd, realHome, userConfig })
    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, '.credentials.json'), JSON.stringify({ stale: true }))
    await writeFile(join(configDir, '.oneworks-credential-revision'), 'stale-generation')

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: key
    })).rejects.toThrow(/credential|storage mode/i)
    await expect(access(join(configDir, '.credentials.json'))).rejects.toThrow()
    await expect(access(join(configDir, '.oneworks-credential-revision'))).rejects.toThrow()
  })

  it.each([
    ['auth method', { statusMissingAuthMethod: true }],
    ['provider', { statusMissingProvider: true }],
    ['email', { statusMissingEmail: true }],
    ['organization', { statusMissingOrgId: true }],
    ['organization identity', { statusOrgId: 'org-other' }]
  ])('fails closed when official managed auth status has invalid or missing %s', async (_label, statusOptions) => {
    const cwd = await createTempDir('ow-claude-status-schema-workspace-')
    const realHome = await createTempDir('ow-claude-status-schema-home-')
    let ctx = createContext({ cwd, realHome })
    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      ...statusOptions
    })

    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'portable'
    })).rejects.toThrow(/not authenticated on this device/i)
  })

  it('checks the expected generation inside the global config lock before removal', async () => {
    const cwd = await createTempDir('ow-claude-remove-cas-workspace-')
    const realHome = await createTempDir('ow-claude-remove-cas-home-')
    const commandLog = join(await createTempDir('ow-claude-remove-cas-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })
    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const configPath = join(realHome, '.oneworks', '.oo.config.json')
    ctx = createContext({
      cwd,
      realHome,
      userConfig: await readGlobalConfig(realHome),
      commandLog
    })

    let removal!: Promise<unknown>
    await withDirectoryInstallLock({ lockDir: `${configPath}.oneworks-write-lock` }, async () => {
      removal = manageClaudeAccount(ctx, { action: 'remove', account: 'portable' })
      const accountDir = resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable')
      await waitForPath(`${accountDir}.oneworks-operation-lock`)
      await new Promise(resolve => setTimeout(resolve, 25))
      const changed = await readGlobalConfig(realHome) as any
      changed.adapters['claude-code'].accounts.portable.generation = 'generation-raced'
      await writeFile(configPath, JSON.stringify(changed))
    })

    await expect(removal).rejects.toThrow(/changed while removal was waiting/i)
    await expect(readFile(commandLog, 'utf8')).rejects.toThrow()
    expect((await readGlobalConfig(realHome)).adapters?.['claude-code']).toMatchObject({
      accounts: { portable: { generation: 'generation-raced' } }
    })
  })

  it('reports unresolved secret references as missing on this device', async () => {
    const cwd = await createTempDir('ow-claude-secret-workspace-')
    const realHome = await createTempDir('ow-claude-secret-home-')
    const userConfig = {
      adapters: {
        'claude-code': {
          accounts: {
            secret: {
              auth: {
                portability: 'portable',
                ref: 'secret://personal/claude-code/secret/1',
                storage: 'secret',
                type: 'claude-credentials-json'
              },
              generation: 'generation-secret',
              title: 'Secret account'
            }
          },
          defaultAccount: 'secret'
        }
      }
    } as Config
    await mkdir(join(realHome, '.oneworks'), { recursive: true })
    await writeFile(join(realHome, '.oneworks', '.oo.config.json'), JSON.stringify(userConfig))
    const ctx = createContext({ cwd, realHome, userConfig })

    await expect(getClaudeAccounts(ctx, {})).resolves.toMatchObject({
      accounts: [{ key: 'secret', status: 'missing' }]
    })
    await expect(resolveClaudeRuntimeAccount({
      ctx,
      requestedAccount: 'secret'
    })).rejects.toThrow(/not available on this device/i)
  })
})
