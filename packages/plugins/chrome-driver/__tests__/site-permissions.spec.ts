import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'
import {
  createWebsitePermissionRule,
  findWebsitePermission,
  matchesWebsitePattern,
  normalizeWebsitePattern
} from '../server/src/site-permissions.js'
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

const createBridge = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-site-permissions-test-'))
  const bridge = new ChromeExtensionBridge({
    logger: { error() {}, info() {}, warn() {} },
    projectHome: join(root, 'project'),
    workspaceFolder: root
  })
  await bridge.start()
  resources.push({ bridge, root })
  return { bridge, root }
}

const connect = async (bridge: ChromeExtensionBridge, advancedAccess: AdvancedAccessInput = {}) => {
  for (const [key, enabled] of Object.entries(advancedAccess)) {
    await bridge.setConfiguredAdvancedAccess(key as keyof AdvancedAccessInput, enabled === true)
  }
  const nonce = 'nonce-site-permissions'
  const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, nonce)
  const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify({
      protocol_version: 1,
      extension_id: CHROME_EXTENSION_ID,
      extension_session_id: 'site-permissions-session',
      trusted_origin: offer.trusted_origin,
      ticket: offer.ticket,
      pairing_nonce: nonce,
      capabilities: guardedExtensionCapabilities(),
      permissions: {}
    })
  })
  const connected = await response.json() as any
  await drainAdvancedAccessSync(bridge, connected.result.session_token, advancedAccess)
  return connected.result.session_token as string
}

const ackNext = async (bridge: ChromeExtensionBridge, token: string, op: string, result: unknown) => {
  const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
  expect(poll.result.command).toMatchObject({ op })
  await extensionPost(bridge, token, '/v1/extensions/ack', {
    command_id: poll.result.command.command_id,
    ok: true,
    result
  })
  return poll.result.command
}

describe('website permission patterns', () => {
  it('supports the documented safe wildcard grammar without query matching', () => {
    expect(normalizeWebsitePattern(' HTTPS://*.Example.COM/* ')).toBe('https://*.example.com/*')
    expect(matchesWebsitePattern('https://*.example.com/account/*', 'https://a.example.com/account/1?token=x')).toBe(
      true
    )
    expect(matchesWebsitePattern('https://*.example.com/account/*', 'https://example.com/account/1#part')).toBe(true)
    expect(matchesWebsitePattern('https://*.example.com/account/*', 'http://a.example.com/account/1')).toBe(false)
    expect(matchesWebsitePattern('http://localhost:3000/*', 'http://localhost:3000/demo')).toBe(true)
    expect(matchesWebsitePattern('https://example.com:443/*', 'https://example.com/demo')).toBe(true)
    expect(() => normalizeWebsitePattern('https://example.com/*?token=*')).toThrow(/query/u)
    expect(() => normalizeWebsitePattern('https://user@example.com/*')).toThrow(/credentials/u)
  })

  it('uses the first matching rule', () => {
    const ask = createWebsitePermissionRule('https://*.example.com/*', 'always_ask')
    const allow = createWebsitePermissionRule('https://app.example.com/*', 'always_allow')
    expect(findWebsitePermission([ask, allow], 'https://app.example.com/a')?.id).toBe(ask.id)
    expect(findWebsitePermission([allow, ask], 'https://app.example.com/a')?.id).toBe(allow.id)
  })
})

describe('chrome bridge website permissions', () => {
  it('persists rules with private file permissions while disconnected', async () => {
    const { bridge, root } = await createBridge()
    await bridge.addWebsitePermission('https://*.example.com/*', 'always_ask')
    const ruleId = bridge.getWebsitePermissions().rules[0]!.id
    await bridge.setWebsitePermission(ruleId, 'always_allow')
    expect(bridge.status().connected).toBe(false)
    expect(bridge.getWebsitePermissions()).toMatchObject({
      rules: [{ mode: 'always_allow', pattern: 'https://*.example.com/*' }],
      scope: 'oneworks_configuration'
    })
    expect((await stat(bridge.websitePermissionsPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(bridge.websitePermissionsPath, 'utf8')).toContain('always_allow')
    expect(bridge.status().recent_audit).toMatchObject([
      {
        op: 'settings.site_permission',
        outcome: 'succeeded',
        summary: expect.stringContaining('mode changed')
      },
      {
        op: 'settings.site_permission',
        outcome: 'succeeded',
        summary: expect.stringContaining('permission added')
      }
    ])
    expect(JSON.stringify(bridge.status().recent_audit)).not.toContain('https://*.example.com/*')

    await bridge.dispose()
    const reloaded = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await reloaded.start()
    resources.push({ bridge: reloaded, root })
    expect(reloaded.getWebsitePermissions().rules).toMatchObject([
      { mode: 'always_allow', pattern: 'https://*.example.com/*' }
    ])
    await reloaded.removeWebsitePermission(ruleId)
    expect(reloaded.getWebsitePermissions().rules).toEqual([])
    expect(reloaded.status().recent_audit).toMatchObject([
      {
        op: 'settings.site_permission',
        outcome: 'succeeded',
        summary: expect.stringContaining('permission removed')
      }
    ])
    expect(reloaded.status().recent_audit[0]).not.toHaveProperty('connection_id')
  })

  it('requires confirmation for a low-risk operation on an always-ask site', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_ask')
    await connect(bridge)
    await expect(bridge.execute({
      args: { action: 'create', url: 'https://example.com/page' },
      op: 'tabs.create',
      riskTier: 2,
      targetKey: 'tabs'
    })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(bridge.status().pending_confirmations).toHaveLength(1)
  })

  it('allows a matching page operation but still verifies the current tab URL before dispatch', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    const token = await connect(bridge)
    const execution = bridge.execute({
      args: { action: 'click', document_id: 'document-8', tab_id: 8 },
      op: 'page.click',
      riskTier: 2,
      targetKey: 'tab:8'
    })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://example.com/page' })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://example.com/page' })
    const command = await ackNext(bridge, token, 'page.click', { clicked: true })
    expect(command.expected_targets).toEqual([{
      tab_id: 8,
      url_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
    }])
    await expect(execution).resolves.toMatchObject({ result: { clicked: true } })
    expect(bridge.status().pending_confirmations).toHaveLength(0)
  })

  it('requires confirmation when an explicitly targeted always-ask tab URL is unavailable', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_ask')
    const token = await connect(bridge)
    const execution = bridge.execute({
      args: { action: 'snapshot', tab_id: 8 },
      op: 'page.snapshot',
      riskTier: 1,
      targetKey: 'tab:8'
    })
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    await ackNext(bridge, token, 'tabs.get', { id: 8 })
    await rejected
    expect(bridge.status().pending_confirmations).toMatchObject([{ target_key: 'tab:8' }])
  })

  it('requires confirmation when any tab in an otherwise allowed multi-tab target has no URL', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    const token = await connect(bridge)
    const execution = bridge.execute({
      args: { action: 'close', tab_ids: [8, 9] },
      op: 'tabs.close',
      riskTier: 2,
      targetKey: 'tabs:8,9'
    })
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://example.com/page' })
    await ackNext(bridge, token, 'tabs.get', { id: 9 })
    await rejected
    expect(bridge.status().pending_confirmations).toMatchObject([{ target_key: 'tabs:8,9' }])
  })

  it('fails closed if the tab navigates after permission evaluation', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    const token = await connect(bridge)
    const execution = bridge.execute({
      args: { action: 'click', document_id: 'document-8', tab_id: 8 },
      op: 'page.click',
      riskTier: 2,
      targetKey: 'tab:8'
    })
    const rejected = expect(execution).rejects.toMatchObject({ code: 'SITE_PERMISSION_CONTEXT_CHANGED' })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://example.com/page' })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://other.example/page' })
    await rejected
    expect(bridge.status().recent_audit.some(entry => entry.op === 'page.click' && entry.outcome === 'succeeded')).toBe(
      false
    )
  })

  it('fails closed if a rule changes while the dispatch URL is being resolved', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    const ruleId = bridge.getWebsitePermissions().rules[0]!.id
    const token = await connect(bridge)
    const execution = bridge.execute({
      args: { action: 'click', document_id: 'document-8', tab_id: 8 },
      op: 'page.click',
      riskTier: 2,
      targetKey: 'tab:8'
    })
    const rejected = expect(execution).rejects.toMatchObject({ code: 'SITE_PERMISSION_CONTEXT_CHANGED' })
    await ackNext(bridge, token, 'tabs.get', { id: 8, url: 'https://example.com/page' })
    const dispatchCheck = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(dispatchCheck.result.command).toMatchObject({ op: 'tabs.get' })
    await bridge.setWebsitePermission(ruleId, 'always_ask')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: dispatchCheck.result.command.command_id,
      ok: true,
      result: { id: 8, url: 'https://example.com/page' }
    })
    await rejected
  })

  it('ignores URL-shaped fields that are not consumed by the operation', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    await connect(bridge)
    await expect(bridge.execute({
      args: { action: 'clear_all', url: 'https://example.com/ignored' },
      op: 'history.clear_all',
      riskTier: 4,
      targetKey: 'history'
    })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(bridge.status().pending_confirmations).toMatchObject([{ target_key: 'history' }])
  })

  it('never lets always-allow bypass the advanced access gate', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    await connect(bridge)
    await expect(bridge.execute({
      args: { expected_origin: 'https://example.com', expression: 'document.title', tab_id: 8 },
      op: 'raw.evaluate',
      riskTier: 4,
      targetKey: 'browser:raw'
    })).rejects.toMatchObject({ code: 'ADVANCED_ACCESS_DISABLED' })
  })

  it('still requires per-use confirmation after advanced access is enabled', async () => {
    const { bridge } = await createBridge()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    await connect(bridge, { cookie_values: true })
    await expect(bridge.execute({
      args: { url: 'https://example.com/account' },
      op: 'cookies.list_with_values',
      riskTier: 4,
      targetKey: 'cookies'
    })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
  })
})
