import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHROME_EXTENSION_ID, ChromeExtensionBridge } from '../server/src/bridge.js'

const trustedOrigin = 'http://127.0.0.1:5207'
const pairingNonce = 'nonce-0123456789abcdef'
const extensionOrigin = `chrome-extension://${CHROME_EXTENSION_ID}`

const resources: Array<{ bridge: ChromeExtensionBridge; root: string }> = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    resources.splice(0).map(async ({ bridge, root }) => {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    })
  )
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-bridge-test-'))
  const bridge = new ChromeExtensionBridge({
    logger: { error() {}, info() {}, warn() {} },
    projectHome: join(root, 'project'),
    workspaceFolder: root
  })
  await bridge.start()
  resources.push({ bridge, root })
  const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
  const connectResponse = await fetch(new URL('/v1/extensions/connect', bridge.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify({
      protocol_version: 1,
      extension_id: CHROME_EXTENSION_ID,
      extension_version: '0.1.0',
      pairing_nonce: pairingNonce,
      extension_session_id: 'extension-session-1',
      trusted_origin: offer.trusted_origin,
      ticket: offer.ticket,
      capabilities: { tabs: true },
      permissions: { permissions: ['tabs'] }
    })
  })
  const connected = await connectResponse.json() as any
  expect(connected.ok).toBe(true)
  return {
    bridge,
    clientToken: connected.result.client_token,
    connectionId: connected.result.connection_id,
    token: connected.result.session_token,
    root
  }
}

const extensionPost = (bridge: ChromeExtensionBridge, token: string, path: string, body = {}) =>
  fetch(new URL(path, bridge.url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: extensionOrigin },
    body: JSON.stringify(body)
  }).then(response => response.json()) as Promise<any>

describe('chrome extension bridge', () => {
  it('keeps workspace credentials authoritative while a manager bridge is alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-role-test-'))
    const logger = { error() {}, info() {}, warn() {} }
    const manager = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'manager'),
      runtimeRole: 'manager',
      workspaceFolder: root
    })
    const workspace = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'workspace'),
      runtimeRole: 'workspace',
      workspaceFolder: root
    })
    await manager.start()
    await workspace.start()
    resources.push({ bridge: manager, root }, { bridge: workspace, root })

    await new Promise(resolveWait => setTimeout(resolveWait, 2_200))
    const credential = JSON.parse(await readFile(workspace.credentialPath, 'utf8'))
    expect(credential).toMatchObject({
      baseUrl: workspace.url,
      controlToken: workspace.controlToken,
      runtimeRole: 'workspace',
      workspaceFolder: root
    })
  })

  it('does not let a manager pairing offer replace an active workspace credential lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-role-offer-test-'))
    const logger = { error() {}, info() {}, warn() {} }
    const workspace = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'workspace'),
      runtimeRole: 'workspace',
      workspaceFolder: root
    })
    const manager = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'manager'),
      runtimeRole: 'manager',
      workspaceFolder: root
    })
    await workspace.start()
    await manager.start()
    resources.push({ bridge: workspace, root }, { bridge: manager, root })
    await workspace.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    await manager.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, `${pairingNonce}-manager`)
    const credential = JSON.parse(await readFile(workspace.credentialPath, 'utf8'))
    expect(credential).toMatchObject({ baseUrl: workspace.url, runtimeRole: 'workspace' })
  })

  it('keeps an idle workspace credential claimed while manager pairing is in progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-manager-claim-test-'))
    const logger = { error() {}, info() {}, warn() {} }
    const workspace = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'workspace'),
      runtimeRole: 'workspace',
      workspaceFolder: root
    })
    const manager = new ChromeExtensionBridge({
      logger,
      projectHome: join(root, 'manager'),
      runtimeRole: 'manager',
      workspaceFolder: root
    })
    await workspace.start()
    await manager.start()
    resources.push({ bridge: workspace, root }, { bridge: manager, root })

    await manager.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, `${pairingNonce}-manager`)
    await new Promise(resolveWait => setTimeout(resolveWait, 2_200))

    const credential = JSON.parse(await readFile(workspace.credentialPath, 'utf8'))
    expect(credential).toMatchObject({
      baseUrl: manager.url,
      controlToken: manager.controlToken,
      runtimeRole: 'manager'
    })
  })

  it('binds a pairing ticket to the pinned extension identity and challenge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-identity-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    const malicious = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pairing_nonce: pairingNonce,
        trusted_origin: trustedOrigin,
        ticket: offer.ticket
      })
    })
    expect(malicious.status).toBe(400)
    await expect(malicious.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_MISMATCH' } })
    const correct = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        pairing_nonce: pairingNonce,
        trusted_origin: trustedOrigin,
        ticket: offer.ticket
      })
    })
    expect(correct.status).toBe(200)
  })

  it('protects automation pairing offers with the workspace-scoped control token', async () => {
    const { bridge } = await setup()
    const unauthorized = await fetch(new URL('/v1/pairing-offer', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trusted_origin: trustedOrigin })
    })
    expect(unauthorized.status).toBe(401)
    const response = await fetch(new URL('/v1/pairing-offer', bridge.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.controlToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        trusted_origin: trustedOrigin,
        extension_id: CHROME_EXTENSION_ID,
        pairing_nonce: pairingNonce
      })
    })
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { protocol_version: 1, trusted_origin: trustedOrigin }
    })
  })

  it('serializes one target while dispatching different targets concurrently', async () => {
    const { bridge, token } = await setup()
    const first = bridge.execute({
      args: { tab_id: 1, action: 'reload' },
      op: 'tabs.reload',
      riskTier: 2,
      targetKey: 'tab:1'
    })
    const secondSame = bridge.execute({
      args: { tab_id: 1, action: 'reload' },
      op: 'tabs.reload',
      riskTier: 2,
      targetKey: 'tab:1'
    })
    const other = bridge.execute({
      args: { tab_id: 2, action: 'reload' },
      op: 'tabs.reload',
      riskTier: 2,
      targetKey: 'tab:2'
    })
    const [pollA, pollB] = await Promise.all([
      extensionPost(bridge, token, '/v1/extensions/poll'),
      extensionPost(bridge, token, '/v1/extensions/poll')
    ])
    const commands = [pollA.result.command, pollB.result.command]
    expect(commands.map(command => command.target_key).sort()).toEqual(['tab:1', 'tab:2'])
    await Promise.all(
      commands.map(command =>
        extensionPost(bridge, token, '/v1/extensions/ack', {
          command_id: command.command_id,
          ok: true,
          result: { tab_id: command.args.tab_id }
        })
      )
    )
    const thirdPoll = await extensionPost(bridge, token, '/v1/extensions/poll')
    expect(thirdPoll.result.command.target_key).toBe('tab:1')
    await extensionPost(bridge, token, '/v1/extensions/ack', {
      command_id: thirdPoll.result.command.command_id,
      ok: true,
      result: { tab_id: 1 }
    })
    await expect(Promise.all([first, secondSame, other])).resolves.toHaveLength(3)
  })

  it('accepts chunked artifacts larger than the JSON request limit and duplicate acknowledgements', async () => {
    const { bridge, token } = await setup()
    const execution = bridge.execute({ args: { tab_id: 5 }, op: 'page.screenshot', riskTier: 2, targetKey: 'tab:5' })
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
    const data = 'A'.repeat(3 * 1024 * 1024)
    const started = await extensionPost(bridge, token, '/v1/extensions/artifacts/start', { size: data.length })
    const artifactId = started.result.artifact_id
    const chunkSize = 512 * 1024
    for (let offset = 0, index = 0; offset < data.length; offset += chunkSize, index += 1) {
      const result = await extensionPost(bridge, token, '/v1/extensions/artifacts/chunk', {
        artifact_id: artifactId,
        index,
        data: data.slice(offset, offset + chunkSize)
      })
      expect(result.ok).toBe(true)
    }
    await extensionPost(bridge, token, '/v1/extensions/artifacts/finish', { artifact_id: artifactId })
    const acknowledgement = {
      command_id: poll.result.command.command_id,
      ok: true,
      result: { artifact_id: artifactId, mime_type: 'image/png', text: 'Bearer canary-secret' }
    }
    expect((await extensionPost(bridge, token, '/v1/extensions/ack', acknowledgement)).ok).toBe(true)
    expect((await extensionPost(bridge, token, '/v1/extensions/ack', acknowledgement)).ok).toBe(true)
    const completed = await execution
    expect(completed).toMatchObject({ result: { data_base64: expect.stringMatching(/^A+$/u), mime_type: 'image/png' } })
    expect(JSON.stringify(completed)).not.toContain('canary-secret')
  })

  it('rejects artifact overrun and aggregate reservations beyond the session quota', async () => {
    const { bridge, token } = await setup()
    const tiny = await extensionPost(bridge, token, '/v1/extensions/artifacts/start', { size: 1 })
    const overrun = await extensionPost(bridge, token, '/v1/extensions/artifacts/chunk', {
      artifact_id: tiny.result.artifact_id,
      index: 0,
      data: 'AA'
    })
    expect(overrun).toMatchObject({ ok: false, error: { code: 'ARTIFACT_SIZE_MISMATCH' } })
    const reserved = await extensionPost(bridge, token, '/v1/extensions/artifacts/start', { size: 30 * 1024 * 1024 })
    expect(reserved.ok).toBe(true)
    const quota = await extensionPost(bridge, token, '/v1/extensions/artifacts/start', { size: 30 * 1024 * 1024 })
    expect(quota).toMatchObject({ ok: false, error: { code: 'ARTIFACT_QUOTA_EXCEEDED' } })
  })

  it('requires exact high-risk confirmation and records redacted audit summaries', async () => {
    const { bridge } = await setup()
    const input = {
      args: { action: 'remove_url', url: 'https://user:pass@example.com/path?token=secret#frag' },
      op: 'history.remove_url',
      riskTier: 3,
      targetKey: 'history'
    }
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const pending = bridge.status().pending_confirmations
    expect(pending).toHaveLength(1)
    expect(pending[0].summary).not.toContain('secret')
    expect(pending[0].summary).not.toContain('pass')
    bridge.approveConfirmation(pending[0].confirmation_id)
    await expect(bridge.execute({ ...input, args: { ...input.args, url: 'https://example.com/other' } })).rejects
      .toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
  })

  it('preserves explicitly enabled raw results while keeping code out of persistent audit', async () => {
    const { bridge, root, token } = await setup()
    const input = {
      args: { action: 'evaluate', tab_id: 7, expected_origin: 'https://example.com', expression: 'localStorage.token' },
      op: 'raw.evaluate',
      riskTier: 4,
      targetKey: 'tab:7'
    }
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const confirmation = bridge.status().pending_confirmations[0]
    expect(confirmation).toMatchObject({ target_key: 'browser:raw' })
    expect(confirmation.summary).toContain('localStorage.token')
    expect(confirmation.summary).toMatch(/args_sha256=[a-f0-9]{16}/u)
    bridge.approveConfirmation(confirmation.confirmation_id)

    const execution = bridge.execute(input)
    const poll = await extensionPost(bridge, token, '/v1/extensions/poll')
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

  it('expires confirmations and invalidates them when the browser session changes', async () => {
    const { bridge, clientToken } = await setup()
    const input = { args: { tab_ids: [11] }, op: 'tabs.close', riskTier: 3, targetKey: 'tab:11' }
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const firstId = bridge.status().pending_confirmations[0].confirmation_id
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    expect(() => bridge.approveConfirmation(firstId)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_NOT_FOUND' })
    )
    vi.useRealTimers()
    await expect(bridge.execute(input)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const secondId = bridge.status().pending_confirmations[0].confirmation_id
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'replacement-session',
        trusted_origin: trustedOrigin,
        client_token: clientToken,
        capabilities: {},
        permissions: {}
      })
    })
    expect(response.status).toBe(200)
    expect(bridge.status().pending_confirmations).toHaveLength(0)
    expect(() => bridge.approveConfirmation(secondId)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_NOT_FOUND' })
    )
  })

  it('enforces the server-side minimum risk when a control caller under-reports it', async () => {
    const { bridge } = await setup()
    const response = await fetch(new URL('/v1/control', bridge.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.controlToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'history.remove_url',
        args: { action: 'remove_url', url: 'https://example.com' },
        risk_tier: 0,
        target_key: 'history'
      })
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CONFIRMATION_REQUIRED', recoverable: true }
    })
    expect(bridge.status().pending_confirmations[0]).toMatchObject({ risk_tier: 3 })
    const overwrite = await fetch(new URL('/v1/control', bridge.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.controlToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'downloads.start',
        args: { action: 'start', url: 'https://example.com/file', conflict_action: 'overwrite' },
        risk_tier: 0,
        target_key: 'downloads'
      })
    })
    expect(overwrite.status).toBe(409)
    await expect(overwrite.json()).resolves.toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' } })
    const raw = await fetch(new URL('/v1/control', bridge.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.controlToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'raw.cdp_command',
        args: {
          action: 'cdp_command',
          tab_id: 9,
          expected_origin: 'https://example.com',
          method: 'Runtime.getIsolateId'
        },
        risk_tier: 0,
        target_key: 'tab:9'
      })
    })
    expect(raw.status).toBe(409)
    await expect(raw.json()).resolves.toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' } })
    expect(bridge.status().pending_confirmations.at(-1)).toMatchObject({ risk_tier: 4 })
  })

  it('surfaces version mismatch as a recoverable pairing state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-version-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    const offer = await bridge.createPairingOffer(trustedOrigin, CHROME_EXTENSION_ID, pairingNonce)
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 99,
        extension_id: CHROME_EXTENSION_ID,
        trusted_origin: offer.trusted_origin,
        ticket: offer.ticket
      })
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'VERSION_MISMATCH', recoverable: true }
    })
  })

  it('keeps one request/ack session when the same extension worker refreshes its page identity', async () => {
    const { bridge, clientToken, connectionId, token } = await setup()
    const response = await fetch(new URL('/v1/extensions/connect', bridge.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({
        protocol_version: 1,
        extension_id: CHROME_EXTENSION_ID,
        extension_session_id: 'extension-session-1',
        extension_version: '0.1.0',
        trusted_origin: trustedOrigin,
        client_token: clientToken,
        oneworks_tab_id: 42,
        capabilities: { tabs: true },
        permissions: { permissions: ['tabs'] }
      })
    })
    const refreshed = await response.json() as any
    expect(refreshed.result).toMatchObject({ connection_id: connectionId, reused: true, session_token: token })
    expect(bridge.status().connection).toMatchObject({ connection_id: connectionId, oneworks_tab_id: 42 })
  })
})
