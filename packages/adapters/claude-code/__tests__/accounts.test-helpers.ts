import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

import type { AdapterCtx, Config } from '@oneworks/types'

export interface ClaudeAccountsTestContextOptions {
  cwd: string
  realHome: string
  userConfig?: Config
  deviceCredential?: boolean
  sharedNativeCredential?: boolean
  authOverride?: boolean
  commandLog?: string
  ignoreLoginSigterm?: boolean
  loginDelayMs?: number
  loginToken?: string
  loginEmail?: string
  loginOrgId?: string
  statusMissingAuthMethod?: boolean
  statusMissingProvider?: boolean
  statusMissingEmail?: boolean
  statusMissingOrgId?: boolean
  statusEmail?: string
  statusOrgId?: string
}

export const createClaudeAccountsTestHarness = () => {
  const tempDirs: string[] = []
  const createTempDir = async (prefix: string) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }
  const createFakeClaudeCli = async () => {
    const dir = await createTempDir('ow-fake-claude-')
    const scriptPath = join(dir, 'claude')
    await writeFile(
      scriptPath,
      `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
;(async () => {
const args = process.argv.slice(2)
const configDir = process.env.CLAUDE_CONFIG_DIR
const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
const sharedNativeCredential = process.env.FAKE_CLAUDE_SHARED_NATIVE === '1'
const nativeMarkerPath = sharedNativeCredential
  ? path.join(realHome, '.fake-claude-native-login.json')
  : configDir == null ? undefined : path.join(configDir, '.native-login')
if (process.env.FAKE_CLAUDE_COMMAND_LOG) {
  fs.appendFileSync(process.env.FAKE_CLAUDE_COMMAND_LOG, JSON.stringify(args) + '\\n')
}
if (!configDir) {
  if (!(args[0] === 'auth' && args[1] === 'status' && nativeMarkerPath && fs.existsSync(nativeMarkerPath))) {
    console.log(JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }))
    process.exit(1)
  }
}
if (configDir) fs.mkdirSync(configDir, { recursive: true })
const credentialPath = configDir == null ? undefined : path.join(configDir, '.credentials.json')
const statePath = configDir == null ? undefined : path.join(configDir, '.claude.json')
if (args[0] === 'auth' && args[1] === 'login') {
  if (process.env.FAKE_CLAUDE_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {})
  process.stdout.write('login started\\n')
  const loginDelayMs = Number(process.env.FAKE_CLAUDE_LOGIN_DELAY_MS || 0)
  if (loginDelayMs > 0) await new Promise(resolve => setTimeout(resolve, loginDelayMs))
  if (process.env.FAKE_CLAUDE_DEVICE === '1' || sharedNativeCredential) fs.writeFileSync(nativeMarkerPath, JSON.stringify({
    email: process.env.FAKE_CLAUDE_LOGIN_EMAIL || 'ada@example.test',
    orgId: process.env.FAKE_CLAUDE_LOGIN_ORG_ID || 'org-test'
  }))
  else fs.writeFileSync(credentialPath, JSON.stringify({
    claudeAiOauth: { accessToken: process.env.FAKE_CLAUDE_LOGIN_TOKEN || 'test-token' }
  }))
  fs.writeFileSync(statePath, JSON.stringify({
    oauthAccount: {
      displayName: 'Ada',
      emailAddress: 'ada@example.test',
      accessToken: 'test-nested-secret'
    },
    cachedUsageUtilization: {
      accessToken: 'test-nested-secret',
      fetchedAtMs: 1700000000000,
      utilization: {
        five_hour: {
          utilization: 42,
          resets_at: '2030-01-01T00:00:00.000Z',
          accessToken: 'test-nested-secret'
        },
        seven_day: { utilization: 18, resets_at: '2030-01-07T00:00:00.000Z' },
        extra_usage: { is_enabled: true, utilization: 9, accessToken: 'test-nested-secret' }
      }
    }
  }))
  console.log('login complete')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'logout') {
  if (credentialPath) fs.rmSync(credentialPath, { force: true })
  if (nativeMarkerPath) fs.rmSync(nativeMarkerPath, { force: true })
  console.log('logout complete')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_CUSTOM_HEADERS ||
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN ||
    process.env.CLAUDE_CODE_OAUTH_SCOPES ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    console.log(JSON.stringify({
      loggedIn: true,
      authMethod: 'api_key',
      apiProvider: 'firstParty'
    }))
    process.exit(0)
  }
  const nativeLoggedIn = nativeMarkerPath != null && fs.existsSync(nativeMarkerPath)
  const loggedIn = nativeLoggedIn || (!sharedNativeCredential && credentialPath != null && fs.existsSync(credentialPath))
  let nativeIdentity = {}
  if (nativeLoggedIn) {
    try {
      nativeIdentity = JSON.parse(fs.readFileSync(nativeMarkerPath, 'utf8'))
    } catch {}
  }
  const readyStatus = {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: process.env.FAKE_CLAUDE_STATUS_EMAIL || nativeIdentity.email || 'ada@example.test',
    orgId: process.env.FAKE_CLAUDE_STATUS_ORG_ID || nativeIdentity.orgId || 'org-test',
    orgName: 'Example',
    subscriptionType: 'pro'
  }
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_AUTH_METHOD === '1') delete readyStatus.authMethod
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_PROVIDER === '1') delete readyStatus.apiProvider
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_EMAIL === '1') delete readyStatus.email
  if (process.env.FAKE_CLAUDE_STATUS_MISSING_ORG_ID === '1') delete readyStatus.orgId
  console.log(JSON.stringify(loggedIn ? readyStatus : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }))
  process.exit(loggedIn ? 0 : 1)
}
console.error('unsupported fake claude command')
process.exit(2)
})()
`
    )
    await chmod(scriptPath, 0o755)
    return scriptPath
  }
  const cleanup = async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  }
  return { cleanup, createFakeClaudeCli, createTempDir }
}

export const createClaudeAccountsTestContext = (params: ClaudeAccountsTestContextOptions): AdapterCtx => ({
  ctxId: 'claude-account-test',
  cwd: params.cwd,
  env: {
    __ONEWORKS_PROJECT_REAL_HOME__: params.realHome,
    ...(params.deviceCredential ? { FAKE_CLAUDE_DEVICE: '1' } : {}),
    ...(params.sharedNativeCredential ? { FAKE_CLAUDE_SHARED_NATIVE: '1' } : {}),
    ...(params.authOverride
      ? {
        ANTHROPIC_API_KEY: 'must-not-bypass-selected-account',
        ANTHROPIC_AUTH_TOKEN: 'must-not-bypass-selected-account',
        ANTHROPIC_BASE_URL: 'https://must-not-bypass-selected-account.example',
        ANTHROPIC_CUSTOM_HEADERS: 'x-must-not-bypass: true',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'must-not-bypass-selected-account',
        CLAUDE_CODE_OAUTH_SCOPES: 'must-not-bypass-selected-account',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-bypass-selected-account'
      }
      : {}),
    ...(params.commandLog == null ? {} : { FAKE_CLAUDE_COMMAND_LOG: params.commandLog }),
    ...(params.ignoreLoginSigterm ? { FAKE_CLAUDE_IGNORE_SIGTERM: '1' } : {}),
    ...(params.loginDelayMs == null ? {} : { FAKE_CLAUDE_LOGIN_DELAY_MS: String(params.loginDelayMs) }),
    ...(params.loginToken == null ? {} : { FAKE_CLAUDE_LOGIN_TOKEN: params.loginToken }),
    ...(params.loginEmail == null ? {} : { FAKE_CLAUDE_LOGIN_EMAIL: params.loginEmail }),
    ...(params.loginOrgId == null ? {} : { FAKE_CLAUDE_LOGIN_ORG_ID: params.loginOrgId }),
    ...(params.statusMissingAuthMethod ? { FAKE_CLAUDE_STATUS_MISSING_AUTH_METHOD: '1' } : {}),
    ...(params.statusMissingProvider ? { FAKE_CLAUDE_STATUS_MISSING_PROVIDER: '1' } : {}),
    ...(params.statusMissingEmail ? { FAKE_CLAUDE_STATUS_MISSING_EMAIL: '1' } : {}),
    ...(params.statusMissingOrgId ? { FAKE_CLAUDE_STATUS_MISSING_ORG_ID: '1' } : {}),
    ...(params.statusEmail == null ? {} : { FAKE_CLAUDE_STATUS_EMAIL: params.statusEmail }),
    ...(params.statusOrgId == null ? {} : { FAKE_CLAUDE_STATUS_ORG_ID: params.statusOrgId })
  },
  cache: {
    get: vi.fn(async () => undefined) as AdapterCtx['cache']['get'],
    set: vi.fn(async () => ({ cachePath: '' })) as AdapterCtx['cache']['set']
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as AdapterCtx['logger'],
  configs: [{}, params.userConfig ?? {}]
})

export const readClaudeAccountsTestGlobalConfig = async (realHome: string) =>
  JSON.parse(
    await readFile(join(realHome, '.oneworks', '.oo.config.json'), 'utf8')
  ) as Config

export const waitForClaudeAccountsTestPath = async (filePath: string) => {
  const { access } = await import('node:fs/promises')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(filePath)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}
