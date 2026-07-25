import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'
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

describe('chrome bridge connection isolation', () => {
  it('does not dispatch an approved queued sensitive operation after the browser session changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-connection-isolation-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    resources.push({ bridge, root })
    await bridge.start()
    await bridge.setConfiguredAdvancedAccess('sensitive_fields', true)
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, 'nonce-old-session')
    const oldConnectResponse = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'old-extension-session',
        trusted_origin: offer.trusted_origin,
        ticket: offer.ticket,
        pairing_nonce: 'nonce-old-session',
        capabilities: guardedExtensionCapabilities(),
        permissions: {}
      })
    })
    const oldConnection = await oldConnectResponse.json() as any
    await drainAdvancedAccessSync(bridge, oldConnection.result.session_token, { sensitive_fields: true })

    const sensitiveInput = {
      args: { action: 'snapshot_sensitive', document_id: 'document-8', tab_id: 8 },
      op: 'page.snapshot_sensitive',
      riskTier: 4,
      targetKey: 'tab:8'
    }
    const confirmation = bridge.execute(sensitiveInput)
    const confirmationExpectation = expect(confirmation).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const confirmationTarget = await extensionPost(bridge, oldConnection.result.session_token, '/v1/extensions/poll')
    expect(confirmationTarget.result.command).toMatchObject({ op: 'tabs.get', target_key: 'tab:8' })
    await extensionPost(bridge, oldConnection.result.session_token, '/v1/extensions/ack', {
      command_id: confirmationTarget.result.command.command_id,
      ok: true,
      result: { id: 8, url: 'https://example.com/account' }
    })
    await confirmationExpectation
    bridge.approveConfirmation(bridge.status().pending_confirmations[0]!.confirmation_id)

    const blocking = bridge.execute({
      args: { action: 'click', document_id: 'document-8', tab_id: 8 },
      op: 'page.click',
      riskTier: 1,
      targetKey: 'tab:8'
    })
    const blockingPoll = await extensionPost(bridge, oldConnection.result.session_token, '/v1/extensions/poll')
    expect(blockingPoll.result.command).toMatchObject({ op: 'page.click', target_key: 'tab:8' })

    const queuedSensitive = bridge.execute(sensitiveInput)
    const blockingExpectation = expect(blocking).rejects.toMatchObject({ code: 'DISCONNECTED' })
    const queuedSensitiveExpectation = expect(queuedSensitive).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' })

    const newConnectResponse = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'new-extension-session',
        trusted_origin: trustedOrigin,
        client_token: oldConnection.result.client_token,
        capabilities: guardedExtensionCapabilities(),
        permissions: {}
      })
    })
    const newConnection = await newConnectResponse.json() as any
    await blockingExpectation
    await queuedSensitiveExpectation

    const newSessionOperations = []
    for (let index = 0; index < 3; index += 1) {
      const poll = await extensionPost(bridge, newConnection.result.session_token, '/v1/extensions/poll')
      newSessionOperations.push(poll.result.command.op)
      await extensionPost(bridge, newConnection.result.session_token, '/v1/extensions/ack', {
        command_id: poll.result.command.command_id,
        ok: true,
        result: { cookie_values: false, raw_debugger: false, sensitive_fields: true }
      })
    }
    expect(newSessionOperations).toEqual(['security.set_policy', 'security.set_policy', 'security.set_policy'])
  })
})
