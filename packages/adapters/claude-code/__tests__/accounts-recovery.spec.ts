import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveGlobalAdapterAccountDir } from '@oneworks/utils'

import { getClaudeAccounts, manageClaudeAccount } from '../src/claude/accounts'
import {
  createClaudeAccountsTestContext as createContext,
  createClaudeAccountsTestHarness,
  readClaudeAccountsTestGlobalConfig as readGlobalConfig
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

describe('claude account login recovery', () => {
  it('kills an aborted login before recovery and prevents a delayed portable credential overwrite', async () => {
    const cwd = await createTempDir('ow-claude-portable-late-write-workspace-')
    const realHome = await createTempDir('ow-claude-portable-late-write-home-')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const globalConfig = await readGlobalConfig(realHome)
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      ignoreLoginSigterm: true,
      loginDelayMs: 300,
      loginToken: 'late-token'
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'portable',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toMatchObject({ name: 'AbortError' })

    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable'), 'config')
    const assertRestoredSnapshot = async () => {
      const credential = await readFile(join(configDir, '.credentials.json'), 'utf8')
      expect(credential).toContain('test-token')
      expect(credential).not.toContain('late-token')
      expect(await readFile(join(configDir, '.oneworks-credential-revision'), 'utf8')).not.toBe('')
    }
    await assertRestoredSnapshot()
    await new Promise(resolve => setTimeout(resolve, 350))
    await assertRestoredSnapshot()
  })

  it('waits for a killed Darwin reauthentication before marking synced inline auth missing', async () => {
    const cwd = await createTempDir('ow-claude-darwin-abort-workspace-')
    const realHome = await createTempDir('ow-claude-darwin-abort-home-')
    const commandLog = join(await createTempDir('ow-claude-darwin-abort-log-'), 'commands.jsonl')
    let ctx = createContext({ cwd, realHome })

    await manageClaudeAccount(ctx, { action: 'add', account: 'portable' })
    const globalConfig = await readGlobalConfig(realHome)
    platformSpy.mockReturnValue('darwin')
    ctx = createContext({
      cwd,
      realHome,
      userConfig: globalConfig,
      sharedNativeCredential: true,
      commandLog,
      ignoreLoginSigterm: true,
      loginDelayMs: 300
    })
    const controller = new AbortController()

    await expect(manageClaudeAccount(ctx, {
      action: 'reauthenticate',
      account: 'portable',
      signal: controller.signal,
      onProgress: (event) => {
        if (event.stream === 'stdout' && event.message.includes('login started')) controller.abort()
      }
    })).rejects.toThrow(/cannot be rolled back per account/i)

    const commands = await readFile(commandLog, 'utf8')
    expect(commands).toContain('["auth","login","--claudeai"]')
    expect(commands).not.toContain('["auth","logout"]')
    await new Promise(resolve => setTimeout(resolve, 350))
    await expect(access(join(realHome, '.fake-claude-native-login.json'))).rejects.toThrow()
    const configDir = join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'portable'), 'config')
    expect(await readFile(join(configDir, '.credentials.json'), 'utf8')).toContain('test-token')
    expect(await readFile(join(configDir, '.oneworks-credential-revision'), 'utf8')).not.toBe('')
    const accounts = await getClaudeAccounts(ctx, {})
    expect(accounts.accounts.find(account => account.key === 'portable')).toMatchObject({ status: 'missing' })
  })
})
