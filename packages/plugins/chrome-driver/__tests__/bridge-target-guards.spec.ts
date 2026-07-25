import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'
import { drainAdvancedAccessSync, extensionPost, guardedExtensionCapabilities } from './bridge-test-helpers.js'

const trustedOrigin = 'http://127.0.0.1:5207'
const extensionOrigin = `chrome-extension://${CHROME_EXTENSION_ID}`
const resources: Array<{ bridge: ChromeExtensionBridge; root: string }> = []
const targetFingerprint = (value: string) => createHash('sha256').update(new URL(value).toString()).digest('hex')

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ bridge, root }) => {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    })
  )
})

async function setup(options: { executionTargetGuard?: boolean; executionTargetGuardVersion?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-target-guard-test-'))
  const bridge = new ChromeExtensionBridge({
    logger: { error() {}, info() {}, warn() {} },
    projectHome: join(root, 'project'),
    workspaceFolder: root
  })
  await bridge.start()
  await bridge.setConfiguredAdvancedAccess('raw_debugger', true)
  resources.push({ bridge, root })
  const pairingNonce = 'nonce-target-guard'
  const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
  const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify({
      protocol_version: 1,
      extension_id: CHROME_EXTENSION_ID,
      extension_version: '0.1.0',
      pairing_nonce: pairingNonce,
      extension_session_id: 'target-guard-session',
      trusted_origin: offer.trusted_origin,
      ticket: offer.ticket,
      capabilities: options.executionTargetGuard === false
        ? { modules: { raw: true }, tabs: true }
        : {
          ...guardedExtensionCapabilities({ modules: { raw: true }, tabs: true }),
          ...(options.executionTargetGuardVersion == null
            ? {}
            : {
              execution_target_guard: {
                algorithm: 'SHA-256',
                canonicalization: 'whatwg-url-href-v1',
                version: options.executionTargetGuardVersion
              }
            })
        },
      permissions: { permissions: ['tabs'] }
    })
  })
  const connected = await response.json() as any
  await drainAdvancedAccessSync(bridge, connected.result.session_token, { raw_debugger: true })
  return { bridge, root, token: connected.result.session_token as string }
}

async function acknowledgeTargetCheck(
  bridge: ChromeExtensionBridge,
  token: string,
  url: string
) {
  const targetCheck = await extensionPost(bridge, token, '/v1/extensions/poll')
  expect(targetCheck.result.command).toMatchObject({ op: 'tabs.get', target_key: 'tab:7' })
  await extensionPost(bridge, token, '/v1/extensions/ack', {
    command_id: targetCheck.result.command.command_id,
    ok: true,
    result: { id: 7, url }
  })
}

describe('chrome bridge execution target guards', () => {
  it.each(['page.screenshot', 'page.type_sensitive'])(
    'requires an extension capability before dispatching bounded target operation %s',
    async op => {
      const { bridge } = await setup({ executionTargetGuard: false })
      await expect(bridge.execute({
        args: { action: op.split('.')[1], tab_id: 7 },
        op,
        riskTier: op === 'page.type_sensitive' ? 4 : 2,
        targetKey: 'tab:7'
      })).rejects.toMatchObject({
        code: 'EXTENSION_UPDATE_REQUIRED',
        details: { recoverable: true }
      })
      expect(bridge.status().recent_audit.some(entry => entry.op === op)).toBe(false)
    }
  )

  it('rejects an incompatible execution target guard capability version before business dispatch', async () => {
    const { bridge } = await setup({ executionTargetGuardVersion: 2 })
    await expect(bridge.execute({
      args: { action: 'screenshot', tab_id: 7 },
      op: 'page.screenshot',
      riskTier: 2,
      targetKey: 'tab:7'
    })).rejects.toMatchObject({
      code: 'EXTENSION_UPDATE_REQUIRED',
      details: { recoverable: true }
    })
    expect(bridge.status().recent_audit.some(entry => entry.op === 'page.screenshot')).toBe(false)
  })

  it('carries the exact raw target URL while keeping code and results out of persistent audit', async () => {
    const { bridge, root, token } = await setup()
    const targetUrl = 'https://example.com/checked?tenant=A#account'
    const input = {
      args: { action: 'evaluate', tab_id: 7, expected_origin: 'https://example.com', expression: 'localStorage.token' },
      op: 'raw.evaluate',
      riskTier: 4,
      targetKey: 'tab:7'
    }
    const confirmationExecution = bridge.execute(input)
    const confirmationExpectation = expect(confirmationExecution).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED'
    })
    const confirmationTarget = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(confirmationTarget.result.command).toMatchObject({ op: 'tabs.get', target_key: 'tab:7' })
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: confirmationTarget.result.command.command_id,
      ok: true,
      result: { id: 7, url: targetUrl }
    })
    await confirmationExpectation
    const confirmation = bridge.status().pending_confirmations[0]
    expect(confirmation).toMatchObject({ target_key: 'browser:raw' })
    expect(confirmation.summary).toContain('localStorage.token')
    expect(confirmation.summary).toMatch(/args_sha256=[a-f0-9]{16}/u)
    bridge.approveConfirmation(confirmation.confirmation_id)

    const execution = bridge.execute(input)
    for (let index = 0; index < 2; index += 1) {
      const targetCheck = await extensionPost(bridge, token, '/v1/extensions/poll')
      expect(targetCheck.result.command).toMatchObject({ op: 'tabs.get', target_key: 'tab:7' })
      await extensionPost(bridge, token, '/v1/extensions/ack', {
        command_id: targetCheck.result.command.command_id,
        ok: true,
        result: { id: 7, url: targetUrl }
      })
    }
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(poll.result.command).toMatchObject({
      expected_targets: [{ tab_id: 7, url_sha256: targetFingerprint(targetUrl) }],
      op: 'raw.evaluate'
    })
    expect(JSON.stringify(poll.result.command)).not.toContain('tenant=A')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: poll.result.command.command_id,
      ok: true,
      result: { result: { value: 'Bearer canary-secret' } }
    })
    await expect(execution).resolves.toMatchObject({ result: { result: { value: 'Bearer canary-secret' } } })
    expect(JSON.stringify(bridge.status().recent_audit)).not.toContain('localStorage.token')
    await new Promise(resolve => setTimeout(resolve, 20))
    const persisted = await readFile(join(root, 'project', 'chrome-driver', 'audit.jsonl'), 'utf8')
    expect(persisted).not.toContain('localStorage.token')
    expect(persisted).not.toContain('canary-secret')
  })

  it('dispatches debugger detach as cleanup without a website target guard', async () => {
    const { bridge, token } = await setup()
    await bridge.addWebsitePermission('https://example.com/*', 'always_allow')
    const input = {
      args: { action: 'detach', tab_id: 7 },
      op: 'debug.detach',
      riskTier: 3,
      targetKey: 'tab:7'
    }
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)

    const execution = bridge.execute(input)
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(poll.result.command).toMatchObject({ op: 'debug.detach', target_key: 'tab:7' })
    expect(poll.result.command).not.toHaveProperty('expected_targets')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: poll.result.command.command_id,
      ok: true,
      result: { attached: false, tab_id: 7 }
    })
    await expect(execution).resolves.toMatchObject({ result: { attached: false, tab_id: 7 } })
  })

  it('binds sensitive typing to an exact URL without requiring a website rule', async () => {
    const { bridge, token } = await setup()
    const targetUrl = 'https://example.com/account?tenant=A#checked'
    const input = {
      args: {
        action: 'type_sensitive',
        document_id: 'document-7',
        ref: 'password',
        tab_id: 7,
        text: 'secret'
      },
      op: 'page.type_sensitive',
      riskTier: 4,
      targetKey: 'tab:7'
    }
    const confirmationExecution = bridge.execute(input)
    const confirmationExpectation = expect(confirmationExecution).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED'
    })
    await acknowledgeTargetCheck(bridge, token, targetUrl)
    await confirmationExpectation
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)

    const execution = bridge.execute(input)
    await acknowledgeTargetCheck(bridge, token, targetUrl)
    await acknowledgeTargetCheck(bridge, token, targetUrl)
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(poll.result.command).toMatchObject({
      expected_targets: [{ tab_id: 7, url_sha256: targetFingerprint(targetUrl) }],
      op: 'page.type_sensitive'
    })
    expect(JSON.stringify(poll.result.command)).not.toContain('tenant=A')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: poll.result.command.command_id,
      ok: true,
      result: { typed: true }
    })
    await expect(execution).resolves.toMatchObject({ result: { typed: true } })
  })

  it('rejects sensitive typing when the approved path/query/fragment identity changes before dispatch', async () => {
    const { bridge, token } = await setup()
    const checkedUrl = 'https://example.com/account?tenant=A#checked'
    const changedUrl = 'https://example.com/account?tenant=B#changed'
    const input = {
      args: {
        action: 'type_sensitive',
        document_id: 'document-7',
        ref: 'password',
        tab_id: 7,
        text: 'secret'
      },
      op: 'page.type_sensitive',
      riskTier: 4,
      targetKey: 'tab:7'
    }
    const confirmationExecution = bridge.execute(input)
    const confirmationExpectation = expect(confirmationExecution).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED'
    })
    await acknowledgeTargetCheck(bridge, token, checkedUrl)
    await confirmationExpectation
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)

    const execution = bridge.execute(input)
    const executionExpectation = expect(execution).rejects.toMatchObject({
      code: 'SITE_PERMISSION_CONTEXT_CHANGED'
    })
    await acknowledgeTargetCheck(bridge, token, checkedUrl)
    await acknowledgeTargetCheck(bridge, token, changedUrl)
    await executionExpectation
  })
})
