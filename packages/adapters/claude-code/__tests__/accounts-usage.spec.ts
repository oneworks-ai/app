import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getClaudeAccountDetail, manageClaudeAccount } from '../src/claude/accounts'
import {
  createClaudeAccountsTestContext as createContext,
  createClaudeAccountsTestHarness,
  readClaudeAccountsTestGlobalConfig as readGlobalConfig
} from './accounts.test-helpers'

const mocks = vi.hoisted(() => ({
  cliPath: '',
  resolveQuota: vi.fn(async () => undefined)
}))

vi.mock('../src/claude/cli', () => ({
  ensureClaudeCliPath: vi.fn(async () => mocks.cliPath)
}))

vi.mock('../src/claude/usage', () => ({
  resolveClaudeAccountQuota: mocks.resolveQuota
}))

const { cleanup, createFakeClaudeCli, createTempDir } = createClaudeAccountsTestHarness()

beforeEach(async () => {
  mocks.cliPath = await createFakeClaudeCli()
  mocks.resolveQuota.mockClear()
})

afterEach(async () => {
  await cleanup()
})

describe('claude managed account usage', () => {
  it('rejects a changed machine identity before reading quota', async () => {
    const cwd = await createTempDir('ow-claude-usage-identity-workspace-')
    const realHome = await createTempDir('ow-claude-usage-identity-home-')
    let ctx = createContext({ cwd, realHome })
    await manageClaudeAccount(ctx, { action: 'add', account: 'work' })
    const globalConfig = await readGlobalConfig(realHome)
    mocks.resolveQuota.mockClear()
    ctx = createContext({
      cwd,
      realHome,
      statusEmail: 'other@example.test',
      userConfig: globalConfig
    })

    await expect(getClaudeAccountDetail(ctx, { account: 'work', refresh: true })).resolves.toMatchObject({
      account: expect.objectContaining({
        key: 'work',
        status: 'error'
      })
    })
    expect(mocks.resolveQuota).not.toHaveBeenCalled()
  })
})
