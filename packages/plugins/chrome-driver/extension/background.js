import {
  bookmarksOperation,
  browsingDataOperation,
  contentSettingsOperation,
  cookiesOperation,
  devicesOperation,
  downloadsOperation,
  groupsOperation,
  historyOperation,
  managementOperation,
  privacyOperation,
  proxyOperation,
  readingListOperation,
  sessionsOperation,
  tabsOperation,
  windowsOperation
} from './operations/browser-data.js'
import { discoverCapabilities } from './operations/capabilities.js'
import { normalizeStoredCursorSession, selectCursorSession } from './operations/cursor-session.js'
import { debugOperation } from './operations/debug.js'
import { deliverCommand } from './operations/delivery.js'
import { cleanupPageCursors, framesOperation, pageOperation } from './operations/page.js'
import { rawDebugOperation } from './operations/raw-debug.js'
import { securityOperation, setAdvancedAccessPolicy } from './operations/security.js'
import {
  EXTENSION_VERSION,
  PROTOCOL_VERSION,
  error,
  sanitizeResult,
  sanitizeSensitiveSnapshotResult
} from './operations/shared.js'

const storageKey = 'oneWorksChromeConnection'
const sessionStorageKey = 'oneWorksChromeExtensionSessionId'
const cursorSessionStorageKey = 'oneWorksExternalBrowserCursorSessionId'
const extensionSessionId = (async () => {
  const stored = (await chrome.storage.session.get(sessionStorageKey))[sessionStorageKey]
  if (typeof stored === 'string' && stored !== '') return stored
  const created = crypto.randomUUID()
  await chrome.storage.session.set({ [sessionStorageKey]: created })
  return created
})()
let connection
let connecting
let workerGeneration = 0
let lastPairingTicket
let workerControllers = []
const inactiveCursorSessions = new Set()
const sensitiveResult = Symbol('oneWorksSensitiveResult')

async function deactivateCursorSession(cursorSessionId) {
  if (typeof cursorSessionId !== 'string' || cursorSessionId === '') return
  inactiveCursorSessions.add(cursorSessionId)
  const stored = normalizeStoredCursorSession(
    (await chrome.storage.session.get(cursorSessionStorageKey))[cursorSessionStorageKey]
  )
  if (stored?.cursorSessionId === cursorSessionId) await chrome.storage.session.remove(cursorSessionStorageKey)
  await cleanupPageCursors(cursorSessionId)
}

const encodeBase64Utf8 = value => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

const handlers = {
  windows: windowsOperation,
  tabs: tabsOperation,
  groups: groupsOperation,
  sessions: sessionsOperation,
  history: historyOperation,
  bookmarks: bookmarksOperation,
  downloads: downloadsOperation,
  readingList: readingListOperation,
  management: managementOperation,
  devices: devicesOperation,
  frames: framesOperation,
  page: (action, args) => pageOperation(action, args, debugOperation),
  debug: debugOperation,
  cookies: cookiesOperation,
  contentSettings: contentSettingsOperation,
  browsingData: browsingDataOperation,
  proxy: proxyOperation,
  privacy: privacyOperation,
  raw: rawDebugOperation,
  security: securityOperation
}

async function post(path, body, token, signal) {
  if (connection?.bridge_url == null && body.bridge_url == null) {
    throw error('PAIRING_REQUIRED', 'OneWorks pairing is required.')
  }
  const bridgeUrl = body.bridge_url ?? connection.bridge_url
  const response = await fetch(new URL(path, bridgeUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal
  })
  const payload = await response.json().catch(() => undefined)
  if (!response.ok || payload?.ok !== true) {
    throw error(
      payload?.error?.code ?? 'BRIDGE_FAILED',
      payload?.error?.message ?? `Bridge failed with HTTP ${response.status}.`,
      payload?.error
    )
  }
  return payload.result
}

async function connect(input = {}) {
  if (connection != null && input.ticket == null) return publicStatus()
  if (connecting != null) return connecting
  connecting = (async () => {
    const saved = (await chrome.storage.local.get(storageKey))[storageKey] ?? {}
    const bridgeUrl = input.bridge_url ?? saved.bridge_url
    const trustedOrigin = input.trusted_origin ?? saved.trusted_origin
    if (bridgeUrl == null || trustedOrigin == null) {
      throw error('PAIRING_REQUIRED', 'Open External Browser in OneWorks Settings and create a pairing offer.')
    }
    const capabilities = await discoverCapabilities()
    const previousConnection = connection
    const hadConnection = previousConnection != null
    const result = await post('/v1/extensions/connect', {
      bridge_url: bridgeUrl,
      protocol_version: PROTOCOL_VERSION,
      extension_session_id: await extensionSessionId,
      extension_id: chrome.runtime.id,
      extension_version: EXTENSION_VERSION,
      chrome_version: navigator.userAgent,
      trusted_origin: trustedOrigin,
      pairing_nonce: input.pairing_nonce,
      oneworks_tab_id: input.oneworks_tab_id ?? saved.oneworks_tab_id,
      ticket: input.ticket,
      client_token: saved.client_token,
      capabilities,
      permissions: capabilities.permissions
    })
    const storedCursorSession = normalizeStoredCursorSession(
      (await chrome.storage.session.get(cursorSessionStorageKey))[cursorSessionStorageKey]
    )
    const cursorSessionId = selectCursorSession({
      connectionId: result.connection_id,
      createId: () => crypto.randomUUID(),
      previousConnection,
      reused: result.reused === true,
      storedSession: storedCursorSession
    })
    const storedCursorSessionId = storedCursorSession?.cursorSessionId
    if (
      typeof storedCursorSessionId === 'string' && storedCursorSessionId !== '' &&
      storedCursorSessionId !== cursorSessionId
    ) {
      await deactivateCursorSession(storedCursorSessionId)
    }
    await chrome.storage.session.set({
      [cursorSessionStorageKey]: { connection_id: result.connection_id, cursor_session_id: cursorSessionId }
    })
    connection = {
      bridge_url: bridgeUrl,
      trusted_origin: trustedOrigin,
      client_token: result.client_token,
      session_token: result.session_token,
      connection_id: result.connection_id,
      cursor_session_id: cursorSessionId,
      connected_at: new Date().toISOString()
    }
    inactiveCursorSessions.delete(cursorSessionId)
    await chrome.storage.local.set({
      [storageKey]: {
        bridge_url: bridgeUrl,
        trusted_origin: trustedOrigin,
        client_token: result.client_token,
        oneworks_tab_id: input.oneworks_tab_id ?? saved.oneworks_tab_id
      }
    })
    if (result.reused !== true || !hadConnection) startWorkers(result.poll_workers ?? 4)
    return publicStatus()
  })().finally(() => {
    connecting = undefined
  })
  return connecting
}

async function synchronizeCapabilities(capabilities) {
  capabilities ??= await discoverCapabilities()
  const activeConnection = connection
  if (activeConnection == null) return capabilities
  try {
    await post('/v1/extensions/capabilities', {
      bridge_url: activeConnection.bridge_url,
      capabilities,
      permissions: capabilities.permissions
    }, activeConnection.session_token)
  } catch {
    if (connection?.cursor_session_id === activeConnection.cursor_session_id) {
      connection = undefined
      await deactivateCursorSession(activeConnection.cursor_session_id)
    }
    chrome.alarms.create('oneWorksChromeReconnect', { delayInMinutes: 0.1 })
  }
  return capabilities
}

async function execute(command, commandConnection = connection) {
  if (
    commandConnection?.connection_id != null &&
    connection?.connection_id !== commandConnection.connection_id
  ) throw error('CONNECTION_CHANGED', 'The browser connection changed before this command could run.')
  if (command.op === 'capabilities.discover') return discoverCapabilities()
  const [module, action] = command.op.split('.')
  const handler = handlers[module]
  if (handler == null || !action) {
    throw error('UNSUPPORTED_OPERATION', `Unsupported typed Chrome operation: ${command.op}`)
  }
  const args = module === 'page'
    ? { ...command.args, cursor_session_id: commandConnection?.cursor_session_id }
    : command.args ?? {}
  const result = await handler(action, args)
  if (module === 'raw') {
    const serialized = JSON.stringify(result)
    if (serialized.length > 512 * 1024) {
      return {
        [sensitiveResult]: true,
        value: {
          data_base64: encodeBase64Utf8(serialized),
          mime_type: 'application/json',
          result_artifact: true
        }
      }
    }
  }
  if (module === 'page' && action === 'snapshot_sensitive') {
    return { [sensitiveResult]: true, value: sanitizeSensitiveSnapshotResult(result) }
  }
  if (module === 'raw' || (module === 'cookies' && action === 'list_with_values')) {
    return { [sensitiveResult]: true, value: result }
  }
  return result
}

async function pollWorker(generation, controller) {
  const workerConnection = connection
  if (workerConnection == null) return
  while (generation === workerGeneration) {
    try {
      const result = await post(
        '/v1/extensions/poll',
        { bridge_url: workerConnection.bridge_url },
        workerConnection.session_token,
        controller.signal
      )
      const command = result.command
      if (command == null) continue
      await deliverCommand(command, {
        connection: workerConnection,
        execute: command => execute(command, workerConnection),
        post,
        sanitizeResult: result => result?.[sensitiveResult] === true ? result.value : sanitizeResult(result),
        sleep: delay => new Promise(resolve => setTimeout(resolve, delay)),
        uploadLargeArtifact
      })
    } catch (pollError) {
      if (controller.signal.aborted || pollError?.name === 'AbortError') return
      const workerStillActive = connection?.cursor_session_id === workerConnection.cursor_session_id
      if (workerStillActive) connection = undefined
      await deactivateCursorSession(workerConnection.cursor_session_id)
      await chrome.action.setBadgeText({ text: '!' })
      await chrome.action.setBadgeBackgroundColor({ color: '#B42318' })
      chrome.alarms.create('oneWorksChromeReconnect', { delayInMinutes: 0.1 })
      return
    }
  }
}

async function uploadLargeArtifact(result, activeConnection) {
  if (
    result == null || typeof result !== 'object' || typeof result.data_base64 !== 'string' ||
    result.data_base64.length <= 1024 * 1024
  ) return result
  const data = result.data_base64
  const base = { bridge_url: activeConnection.bridge_url }
  const started = await post(
    '/v1/extensions/artifacts/start',
    { ...base, size: data.length },
    activeConnection.session_token
  )
  const chunkSize = 512 * 1024
  for (let offset = 0, index = 0; offset < data.length; offset += chunkSize, index += 1) {
    await post('/v1/extensions/artifacts/chunk', {
      ...base,
      artifact_id: started.artifact_id,
      index,
      data: data.slice(offset, offset + chunkSize)
    }, activeConnection.session_token)
  }
  await post(
    '/v1/extensions/artifacts/finish',
    { ...base, artifact_id: started.artifact_id },
    activeConnection.session_token
  )
  const { data_base64: _data, ...rest } = result
  return { ...rest, artifact_id: started.artifact_id }
}

function startWorkers(count) {
  for (const controller of workerControllers) controller.abort()
  workerControllers = []
  workerGeneration += 1
  const generation = workerGeneration
  void chrome.action.setBadgeText({ text: '' })
  for (let index = 0; index < Math.min(8, Math.max(1, count)); index += 1) {
    const controller = new AbortController()
    workerControllers.push(controller)
    void pollWorker(generation, controller)
  }
}

async function publicStatus() {
  const saved = (await chrome.storage.local.get(storageKey))[storageKey]
  return {
    connected: connection != null,
    connection_id: connection?.connection_id,
    trusted_origin: connection?.trusted_origin ?? saved?.trusted_origin,
    paired: saved?.client_token != null,
    protocol_version: PROTOCOL_VERSION,
    extension_version: EXTENSION_VERSION,
    capabilities: await discoverCapabilities()
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = async () => {
    if (message?.type === 'oneworks:pairing-offer') {
      if (sender.tab?.url == null) {
        throw error('ORIGIN_MISMATCH', 'Pairing offers must come from a visible OneWorks tab.')
      }
      const senderOrigin = new URL(sender.tab.url).origin
      if (senderOrigin !== message.offer?.trusted_origin) {
        throw error('ORIGIN_MISMATCH', 'The pairing offer did not match the OneWorks tab origin.')
      }
      if (message.offer?.ticket != null && message.offer.ticket === lastPairingTicket && connection != null) {
        return publicStatus()
      }
      lastPairingTicket = message.offer?.ticket
      return connect({ ...message.offer, oneworks_tab_id: sender.tab.id })
    }
    if (message?.type === 'oneworks:status') return publicStatus()
    if (message?.type === 'oneworks:external-browser:cursor-session-active') {
      const storedCursorSession = normalizeStoredCursorSession(
        (await chrome.storage.session.get(cursorSessionStorageKey))[cursorSessionStorageKey]
      )
      const cursorSessionId = message.cursor_session_id
      return {
        active: typeof cursorSessionId === 'string' && cursorSessionId !== '' &&
          !inactiveCursorSessions.has(cursorSessionId) &&
          (connection?.cursor_session_id === cursorSessionId ||
            storedCursorSession?.cursorSessionId === cursorSessionId)
      }
    }
    if (message?.type === 'oneworks:inject-bridge') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id == null || tab.url == null || !/^https?:/.test(tab.url)) {
        throw error('RESTRICTED_PAGE', 'Open the OneWorks Web page in the active tab first.')
      }
      const origin = new URL(tab.url).origin
      await chrome.permissions.request({ permissions: ['scripting'], origins: [`${origin}/*`] })
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] })
      return { injected: true, tab_id: tab.id, origin }
    }
    if (message?.type === 'oneworks:grant-permissions') {
      const granted = await chrome.permissions.request({
        permissions: message.permissions ?? [],
        origins: message.origins ?? []
      })
      return { granted, capabilities: await synchronizeCapabilities() }
    }
    if (message?.type === 'oneworks:set-advanced-access') {
      const policy = await setAdvancedAccessPolicy(message.key, message.enabled)
      await synchronizeCapabilities()
      return policy
    }
    if (message?.type === 'oneworks:forget') {
      const storedCursorSession = normalizeStoredCursorSession(
        (await chrome.storage.session.get(cursorSessionStorageKey))[cursorSessionStorageKey]
      )
      const cursorSessionId = connection?.cursor_session_id ?? storedCursorSession?.cursorSessionId
      connection = undefined
      workerGeneration += 1
      for (const controller of workerControllers) controller.abort()
      workerControllers = []
      await deactivateCursorSession(cursorSessionId)
      await chrome.storage.local.remove(storageKey)
      return publicStatus()
    }
    throw error('UNKNOWN_MESSAGE', 'Unknown OneWorks Chrome extension message.')
  }
  void respond().then(
    result => sendResponse({ ok: true, result }),
    failure =>
      sendResponse({
        ok: false,
        error: {
          code: failure.code ?? 'EXTENSION_FAILED',
          message: failure.message,
          missing_permissions: failure.missing_permissions
        }
      })
  )
  return true
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'oneWorksChromeReconnect') void connect().catch(() => undefined)
})
chrome.runtime.onStartup.addListener(() => {
  void connect().catch(() => undefined)
})
chrome.runtime.onInstalled.addListener(() => {
  void connect().catch(() => undefined)
})
