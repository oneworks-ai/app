import type { IncomingMessage } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

import type { ServerEnv } from '@oneworks/core'

const connectionLoadingMocks = vi.hoisted(() => ({
  pluginServiceModuleLoaded: vi.fn(),
  sessionServiceModuleLoaded: vi.fn()
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn(() => ({
    getSession: vi.fn(),
    getSessionRuntimeState: vi.fn()
  }))
}))

vi.mock('#~/services/auth/index.js', () => ({
  AUTH_COOKIE_NAME: 'oneworks_web_auth',
  getBearerTokenFromHeader: vi.fn(),
  getCookieFromHeader: vi.fn(),
  resolveWebAuthConfig: vi.fn(async () => ({ enabled: false })),
  verifySessionToken: vi.fn(async () => true)
}))

vi.mock('#~/services/mobile-debug/index.js', () => ({
  handleMobileDeviceVideoStreamSocket: vi.fn(async () => undefined)
}))

vi.mock('#~/services/plugins/index.js', () => {
  connectionLoadingMocks.pluginServiceModuleLoaded()
  return {
    getPluginManager: vi.fn(() => ({
      getRecord: vi.fn(() => ({})),
      load: vi.fn(async () => undefined),
      subscribeWatchEvents: vi.fn(() => vi.fn())
    }))
  }
})

vi.mock('#~/services/session/index.js', () => {
  connectionLoadingMocks.sessionServiceModuleLoaded()
  return {
    interruptSession: vi.fn(),
    killSession: vi.fn(),
    processUserMessage: vi.fn(),
    startAdapterSession: vi.fn()
  }
})

vi.mock('#~/services/session/interaction.js', () => ({
  handleInteractionResponse: vi.fn()
}))

vi.mock('#~/services/session/runtime.js', () => ({
  addSessionSubscriberSocket: vi.fn(),
  attachSocketToSession: vi.fn(),
  detachSocketFromSession: vi.fn(),
  getAdapterSessionRuntime: vi.fn(),
  removeSessionSubscriberSocket: vi.fn()
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() }))
}))

vi.mock('../../src/websocket/terminal.js', () => ({
  handleTerminalSocketConnection: vi.fn(async () => undefined),
  sendTerminalFatalError: vi.fn()
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('websocket protocol loading', () => {
  it('does not load the session runtime for a plugin-only connection', async () => {
    const { handleWebSocketConnection } = await import('../../src/websocket/connection.js')
    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    } as unknown as WebSocket
    const request = {
      headers: { host: 'localhost' },
      url: '/ws?channel=plugin&scope=*'
    } as IncomingMessage

    await handleWebSocketConnection(ws, request, {} as ServerEnv)

    expect(connectionLoadingMocks.pluginServiceModuleLoaded).toHaveBeenCalledOnce()
    expect(connectionLoadingMocks.sessionServiceModuleLoaded).not.toHaveBeenCalled()
  })
})
