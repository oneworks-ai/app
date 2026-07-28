import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'
import type { AdvancedAccessInput } from './bridge-test-helpers.js'
import { drainAdvancedAccessSync, extensionPost, guardedExtensionCapabilities } from './bridge-test-helpers.js'

const trustedOrigin = 'http://127.0.0.1:5207'
const extensionOrigin = `chrome-extension://${CHROME_EXTENSION_ID}`
const resources: Array<{ bridge: ChromeExtensionBridge; root: string }> = []

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ bridge, root }) => {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    })
  )
})

async function setup(advancedAccess: AdvancedAccessInput = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-security-test-'))
  const bridge = new ChromeExtensionBridge({
    logger: { error() {}, info() {}, warn() {} },
    projectHome: join(root, 'project'),
    workspaceFolder: root
  })
  await bridge.start()
  for (const [key, enabled] of Object.entries(advancedAccess)) {
    await bridge.setConfiguredAdvancedAccess(key as keyof typeof advancedAccess, enabled)
  }
  resources.push({ bridge, root })
  const pairingNonce = 'nonce-advanced-security'
  const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
  const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify({
      protocol_version: 1,
      extension_id: CHROME_EXTENSION_ID,
      extension_session_id: 'advanced-security-session',
      trusted_origin: offer.trusted_origin,
      ticket: offer.ticket,
      pairing_nonce: pairingNonce,
      capabilities: guardedExtensionCapabilities(),
      permissions: {}
    })
  })
  const connected = await response.json() as any
  await drainAdvancedAccessSync(bridge, connected.result.session_token, advancedAccess)
  return { bridge, token: connected.result.session_token }
}

describe('chrome bridge advanced security', () => {
  it('persists advanced access preferences without a browser connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-advanced-config-test-'))
    const options = {
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    }
    const first = new ChromeExtensionBridge(options)
    await first.start()
    resources.push({ bridge: first, root })

    await expect(first.setConfiguredAdvancedAccess('cookie_values', true)).resolves.toMatchObject({
      cookie_values: true,
      raw_debugger: false,
      scope: 'oneworks_configuration',
      sensitive_fields: false
    })
    expect(first.status().connected).toBe(false)
    await expect(readFile(first.advancedAccessPath, 'utf8')).resolves.toContain('"cookie_values": true')
    expect((await stat(first.advancedAccessPath)).mode & 0o777).toBe(0o600)

    await first.dispose()
    const second = new ChromeExtensionBridge(options)
    await second.start()
    resources.push({ bridge: second, root })
    expect(second.getConfiguredAdvancedAccess()).toMatchObject({
      cookie_values: true,
      raw_debugger: false,
      scope: 'oneworks_configuration',
      sensitive_fields: false
    })
  })

  it('serializes concurrent preference writes before reloading them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-advanced-concurrency-test-'))
    const options = {
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    }
    const first = new ChromeExtensionBridge(options)
    await first.start()
    resources.push({ bridge: first, root })
    await Promise.all([
      first.setConfiguredAdvancedAccess('raw_debugger', true),
      first.setConfiguredAdvancedAccess('cookie_values', true),
      first.setConfiguredAdvancedAccess('sensitive_fields', true)
    ])
    expect(JSON.parse(await readFile(first.advancedAccessPath, 'utf8'))).toMatchObject({
      cookie_values: true,
      raw_debugger: true,
      sensitive_fields: true
    })

    await first.dispose()
    const second = new ChromeExtensionBridge(options)
    await second.start()
    resources.push({ bridge: second, root })
    expect(second.getConfiguredAdvancedAccess()).toMatchObject({
      cookie_values: true,
      raw_debugger: true,
      sensitive_fields: true
    })
  })

  it('applies safe defaults even when the extension reports stale enabled policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-advanced-default-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    const pairingNonce = 'nonce-advanced-default'
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'advanced-default-session',
        trusted_origin: offer.trusted_origin,
        ticket: offer.ticket,
        pairing_nonce: pairingNonce,
        capabilities: {
          advanced_access: { cookie_values: true, raw_debugger: true, sensitive_fields: true },
          modules: { raw: true }
        },
        permissions: {}
      })
    })
    const connected = await response.json() as any
    const commands = []
    for (let index = 0; index < 3; index += 1) {
      const poll = await extensionPost(bridge, connected.result.session_token, '/v1/extensions/poll')
      commands.push(poll.result.command)
      await extensionPost(bridge, connected.result.session_token, '/v1/extensions/ack', {
        command_id: poll.result.command.command_id,
        ok: true,
        result: { cookie_values: false, raw_debugger: false, sensitive_fields: false }
      })
    }
    expect(commands.map(command => command.args)).toEqual([
      { enabled: false, key: 'raw_debugger' },
      { enabled: false, key: 'cookie_values' },
      { enabled: false, key: 'sensitive_fields' }
    ])
    await vi.waitFor(() => expect(bridge.getConfiguredAdvancedAccess().sync_state).toBe('synced'))
  })

  it('never synchronizes a preference whose persistent commit failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-advanced-commit-failure-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    await mkdir(bridge.advancedAccessPath, { recursive: true })
    const failedPreference = bridge.setConfiguredAdvancedAccess('raw_debugger', true)
    const failedPreferenceExpectation = expect(failedPreference).rejects.toBeInstanceOf(Error)

    const pairingNonce = 'nonce-advanced-commit-failure'
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'advanced-commit-failure-session',
        trusted_origin: offer.trusted_origin,
        ticket: offer.ticket,
        pairing_nonce: pairingNonce,
        capabilities: { modules: { raw: true } },
        permissions: {}
      })
    })
    const connected = await response.json() as any
    await failedPreferenceExpectation
    const commands = []
    for (let index = 0; index < 3; index += 1) {
      const poll = await extensionPost(bridge, connected.result.session_token, '/v1/extensions/poll')
      commands.push(poll.result.command)
      await extensionPost(bridge, connected.result.session_token, '/v1/extensions/ack', {
        command_id: poll.result.command.command_id,
        ok: true,
        result: { cookie_values: false, raw_debugger: false, sensitive_fields: false }
      })
    }
    expect(commands.map(command => command.args)).toEqual([
      { enabled: false, key: 'raw_debugger' },
      { enabled: false, key: 'cookie_values' },
      { enabled: false, key: 'sensitive_fields' }
    ])
    expect(bridge.getConfiguredAdvancedAccess().raw_debugger).toBe(false)
  })

  it('reports a connected synchronization failure without losing the saved preference', async () => {
    const { bridge, token } = await setup()
    const setting = bridge.setConfiguredAdvancedAccess('cookie_values', true)
    const rawPoll = await extensionPost(bridge, token, '/v1/extensions/poll')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: rawPoll.result.command.command_id,
      ok: true,
      result: { cookie_values: false, raw_debugger: false, sensitive_fields: false }
    })
    const cookiePoll = await extensionPost(bridge, token, '/v1/extensions/poll')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: cookiePoll.result.command.command_id,
      ok: false,
      error: { code: 'SYNC_REJECTED', message: 'The extension rejected the policy update.', recoverable: true }
    })

    await expect(setting).resolves.toMatchObject({
      cookie_values: true,
      sync_error: 'The extension rejected the policy update.',
      sync_state: 'sync_failed'
    })
    expect(JSON.parse(await readFile(bridge.advancedAccessPath, 'utf8'))).toMatchObject({ cookie_values: true })
    await expect(bridge.execute({
      args: { action: 'list_with_values', url: 'https://example.com/' },
      op: 'cookies.list_with_values',
      riskTier: 4,
      targetKey: 'origin:https://example.com'
    })).rejects.toMatchObject({ code: 'ADVANCED_ACCESS_NOT_SYNCHRONIZED' })
  })

  it('blocks an old enabled extension policy when disabling fails to synchronize', async () => {
    const { bridge, token } = await setup({ cookie_values: true })
    const setting = bridge.setConfiguredAdvancedAccess('cookie_values', false)
    const rawPoll = await extensionPost(bridge, token, '/v1/extensions/poll')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: rawPoll.result.command.command_id,
      ok: true,
      result: { cookie_values: true, raw_debugger: false, sensitive_fields: false }
    })
    const cookiePoll = await extensionPost(bridge, token, '/v1/extensions/poll')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: cookiePoll.result.command.command_id,
      ok: false,
      error: { code: 'SYNC_REJECTED', message: 'The extension rejected the policy update.', recoverable: true }
    })
    await expect(setting).resolves.toMatchObject({ cookie_values: false, sync_state: 'sync_failed' })
    await expect(bridge.execute({
      args: { action: 'list_with_values', url: 'https://example.com/' },
      op: 'cookies.list_with_values',
      riskTier: 4,
      targetKey: 'origin:https://example.com'
    })).rejects.toMatchObject({ code: 'ADVANCED_ACCESS_DISABLED' })
  })

  it('synchronizes saved preferences when a compatible browser connects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-advanced-sync-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    await bridge.setConfiguredAdvancedAccess('raw_debugger', true)
    await bridge.setConfiguredAdvancedAccess('cookie_values', true)
    await bridge.setConfiguredAdvancedAccess('sensitive_fields', true)

    const pairingNonce = 'nonce-advanced-sync'
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'advanced-sync-session',
        trusted_origin: offer.trusted_origin,
        ticket: offer.ticket,
        pairing_nonce: pairingNonce,
        capabilities: { modules: { raw: false } },
        permissions: {}
      })
    })
    const connected = await response.json() as any
    const commands = []
    for (let index = 0; index < 3; index += 1) {
      const poll = await extensionPost(bridge, connected.result.session_token, '/v1/extensions/poll')
      commands.push(poll.result.command)
      await extensionPost(bridge, connected.result.session_token, '/v1/extensions/ack', {
        command_id: poll.result.command.command_id,
        ok: true,
        result: { cookie_values: true, raw_debugger: false, sensitive_fields: true }
      })
    }

    expect(commands.map(command => ({ args: command.args, op: command.op }))).toEqual([
      { args: { enabled: false, key: 'raw_debugger' }, op: 'security.set_policy' },
      { args: { enabled: true, key: 'cookie_values' }, op: 'security.set_policy' },
      { args: { enabled: true, key: 'sensitive_fields' }, op: 'security.set_policy' }
    ])
    expect(bridge.getConfiguredAdvancedAccess()).toMatchObject({
      cookie_values: true,
      raw_debugger: true,
      sensitive_fields: true
    })

    await extensionPost(bridge, connected.result.session_token, '/v1/extensions/capabilities', {
      capabilities: { modules: { raw: true } },
      permissions: {}
    })
    const upgradedCommands = []
    for (let index = 0; index < 3; index += 1) {
      const poll = await extensionPost(bridge, connected.result.session_token, '/v1/extensions/poll')
      upgradedCommands.push(poll.result.command)
      await extensionPost(bridge, connected.result.session_token, '/v1/extensions/ack', {
        command_id: poll.result.command.command_id,
        ok: true,
        result: { cookie_values: true, raw_debugger: true, sensitive_fields: true }
      })
    }
    expect(upgradedCommands[0]).toMatchObject({
      args: { enabled: true, key: 'raw_debugger' },
      op: 'security.set_policy'
    })
  })

  it('lets a same-process same-role pairing rollover replace stale bridge credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-rollover-test-'))
    const options = {
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      runtimeRole: 'manager' as const,
      workspaceFolder: root
    }
    const first = new ChromeExtensionBridge(options)
    const second = new ChromeExtensionBridge(options)
    await first.start()
    await first.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, 'nonce-rollover-first')
    await second.start()
    await second.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, 'nonce-rollover-second')
    resources.push({ bridge: first, root }, { bridge: second, root })
    const credential = JSON.parse(await readFile(second.credentialPath, 'utf8'))
    expect(credential).toMatchObject({ baseUrl: second.url, controlToken: second.controlToken, runtimeRole: 'manager' })
  })

  it('shows typed destructive scopes without persisting secret values', async () => {
    const { bridge } = await setup()
    const cases = [
      {
        op: 'browsingData.remove',
        targetKey: 'browsingData',
        args: {
          action: 'remove',
          origins: ['https://example.com/private?token=secret'],
          since: '2026-07-01T00:00:00.000Z',
          types: ['cookies', 'localStorage'],
          protected_web: true,
          extension_origins: false
        },
        expected: ['origins=https://example.com', 'types=cookies|localStorage', 'protected_web=true']
      },
      {
        op: 'proxy.set',
        targetKey: 'proxy',
        args: { action: 'set', mode: 'fixed_servers', host: 'proxy.example.com', port: 8443, scope: 'regular' },
        expected: ['mode=fixed_servers', 'host=proxy.example.com', 'port=8443', 'scope=regular']
      },
      {
        op: 'contentSettings.set',
        targetKey: 'contentSettings',
        args: {
          action: 'set',
          setting: 'cookies',
          primary_pattern: 'https://example.com/*',
          value: 'allow',
          scope: 'regular'
        },
        expected: [
          'setting=cookies',
          'primary_pattern=https://example.com/*',
          'value=type=string;sha256=',
          'scope=regular'
        ]
      },
      {
        op: 'management.uninstall',
        targetKey: 'management',
        args: { action: 'uninstall', extension_id: 'abcdefghijklmnopabcdefghijklmnop' },
        expected: ['extension_id=abcdefghijklmnopabcdefghijklmnop']
      },
      {
        op: 'cookies.set',
        targetKey: 'cookies',
        args: {
          action: 'set',
          url: 'https://example.com/?token=secret',
          name: 'session-token',
          path: '/account',
          value: 'cookie-secret'
        },
        expected: ['name=sha256:', 'path=/account', 'value=type=string;sha256=']
      }
    ]
    for (const item of cases) {
      await expect(bridge.execute({ ...item, riskTier: 4 })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
      const summary = bridge.status().pending_confirmations.at(-1)!.summary
      for (const expected of item.expected) expect(summary).toContain(expected)
      expect(summary).not.toContain('cookie-secret')
      expect(summary).not.toContain('token=secret')
    }
  })

  it('reapplies OneWorks preferences after extension capability updates', async () => {
    const { bridge, token } = await setup()
    await expect(extensionPost(bridge, token, '/v1/extensions/capabilities', {
      capabilities: { advanced_access: { raw_debugger: true }, modules: { raw: true } },
      permissions: { permissions: ['tabs', 'debugger'], origins: [] }
    })).resolves.toMatchObject({ ok: true, result: { accepted: true } })
    await drainAdvancedAccessSync(bridge, token)
    expect(bridge.status().connection).toMatchObject({
      capabilities: { advanced_access: { raw_debugger: false } },
      permissions: { permissions: ['tabs', 'debugger'] }
    })
  })

  it('preserves only sensitive element values from sensitive snapshots', async () => {
    const { bridge, token } = await setup({ sensitive_fields: true })
    const input = {
      args: { action: 'snapshot_sensitive', tab_id: 8, document_id: 'document-8' },
      op: 'page.snapshot_sensitive',
      riskTier: 4,
      targetKey: 'tab:8'
    }
    const confirmation = bridge.execute(input)
    const confirmationExpectation = expect(confirmation).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const confirmationTarget = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(confirmationTarget.result.command).toMatchObject({ op: 'tabs.get' })
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: confirmationTarget.result.command.command_id,
      ok: true,
      result: { id: 8, url: 'https://example.com/account' }
    })
    await confirmationExpectation
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)
    const execution = bridge.execute(input)
    for (let index = 0; index < 2; index += 1) {
      const targetCheck = await extensionPost(bridge, token, '/v1/extensions/poll')
      expect(targetCheck.result.command).toMatchObject({ op: 'tabs.get' })
      await extensionPost(bridge, token, '/v1/extensions/ack', {
        command_id: targetCheck.result.command.command_id,
        ok: true,
        result: { id: 8, url: 'https://example.com/account' }
      })
    }
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(poll.result.command).toMatchObject({
      expected_targets: [{ tab_id: 8, url_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }],
      op: 'page.snapshot_sensitive'
    })
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: poll.result.command.command_id,
      ok: true,
      result: {
        url: 'https://example.com/?token=query-secret',
        text: 'Authorization: Bearer body-secret',
        elements: [
          { sensitive: true, value: 'password-secret' },
          { sensitive: false, value: 'Authorization: Bearer normal-secret' }
        ]
      }
    })
    const result = await execution
    expect(result).toMatchObject({
      result: { elements: expect.arrayContaining([{ sensitive: true, value: 'password-secret' }]) }
    })
    expect(JSON.stringify(result)).not.toContain('query-secret')
    expect(JSON.stringify(result)).not.toContain('body-secret')
    expect(JSON.stringify(result)).not.toContain('normal-secret')
  })
})
