import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'

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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-security-test-'))
  const bridge = new ChromeExtensionBridge({
    logger: { error() {}, info() {}, warn() {} },
    projectHome: join(root, 'project'),
    workspaceFolder: root
  })
  await bridge.start()
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
      capabilities: {},
      permissions: {}
    })
  })
  const connected = await response.json() as any
  return { bridge, token: connected.result.session_token }
}

const extensionPost = (bridge: ChromeExtensionBridge, token: string, path: string, body = {}) =>
  fetch(new URL(path, bridge.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify(body)
  }).then(response => response.json()) as Promise<any>

describe('chrome bridge advanced security', () => {
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

  it('synchronizes popup capability updates into bridge status', async () => {
    const { bridge, token } = await setup()
    await expect(extensionPost(bridge, token, '/v1/extensions/capabilities', {
      capabilities: { advanced_access: { raw_debugger: true }, modules: { raw: true } },
      permissions: { permissions: ['tabs', 'debugger'], origins: [] }
    })).resolves.toMatchObject({ ok: true, result: { accepted: true } })
    expect(bridge.status().connection).toMatchObject({
      capabilities: { advanced_access: { raw_debugger: true } },
      permissions: { permissions: ['tabs', 'debugger'] }
    })
  })

  it('preserves only sensitive element values from sensitive snapshots', async () => {
    const { bridge, token } = await setup()
    const input = {
      args: { action: 'snapshot_sensitive', tab_id: 8, document_id: 'document-8' },
      op: 'page.snapshot_sensitive',
      riskTier: 4,
      targetKey: 'tab:8'
    }
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)
    const execution = bridge.execute(input)
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
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
