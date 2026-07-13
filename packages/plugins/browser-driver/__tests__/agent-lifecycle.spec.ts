import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__ = 'http://127.0.0.1:49091'
process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__ = 'test-token'
process.env.__ONEWORKS_PROJECT_SESSION_ID__ = 'session-browser'

const require = createRequire(import.meta.url)
const createStdioServer = require('../bin/browser-driver-stdio.cjs') as (options: {
  callTool: (
    name?: string,
    args?: Record<string, unknown>,
    context?: { requestId: number | string; signal: AbortSignal }
  ) => Promise<unknown>
  onCancel?: (input: { requestId: number | string }) => Promise<void>
  onClose: () => Promise<void>
  serverInfo: Record<string, unknown>
  tools: unknown[]
}) => { cancelAll: () => Promise<void>; start: (input?: NodeJS.ReadableStream) => void }
const driver = require('../bin/browser-driver.cjs') as {
  getQueuedPageCount: () => number
  handleRequest: (request: Record<string, unknown>) => Promise<void>
}

const bridgeResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

afterEach(async () => {
  await vi.waitFor(() => expect(driver.getQueuedPageCount()).toBe(0))
  vi.unstubAllGlobals()
})

describe('browser-driver Agent action lifecycle', () => {
  it('runs the registered cleanup when the MCP input disconnects', async () => {
    const input = new PassThrough()
    const onClose = vi.fn(async () => undefined)
    createStdioServer({ callTool: async () => ({}), onClose, serverInfo: {}, tools: [] }).start(input)

    input.end()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('aborts and cleans an active request before handling an MCP stdin close', async () => {
    const input = new PassThrough()
    const onCancel = vi.fn(async () => undefined)
    const onClose = vi.fn(async () => undefined)
    const callTool = vi.fn(async (
      _name?: string,
      _args?: Record<string, unknown>,
      context?: { requestId: number | string; signal: AbortSignal }
    ) =>
      await new Promise((_resolve, reject) => {
        context?.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    )
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      createStdioServer({ callTool, onCancel, onClose, serverInfo: {}, tools: [] }).start(input)
      input.write(`${
        JSON.stringify({
          id: 91,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: {}, name: 'execute_in_app_browser_workflow' }
        })
      }\n`)
      await vi.waitFor(() => expect(callTool).toHaveBeenCalledOnce())
      input.end()

      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      expect(onCancel).toHaveBeenCalledWith({ requestId: '91' })
    } finally {
      stdout.mockRestore()
    }
  })

  it('cancels the current workflow action and releases its exact Agent state lease', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        if (body.op === 'release_agent_action_state') {
          return bridgeResponse({ ok: true, result: { ok: true, restored_pages: 1 } })
        }
        await new Promise<void>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true })
        })
        return bridgeResponse({ ok: true, result: { ok: true } })
      })
    )
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const execution = driver.handleRequest({
        id: 701,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            page_id: 'page_cancel',
            steps: [{ node_id: 'scroll-current', op: 'scroll', y: 240 }]
          },
          name: 'execute_in_app_browser_workflow'
        }
      })
      await vi.waitFor(() => expect(bodies).toHaveLength(1))
      const operationId = bodies[0]?.agent_operation_id

      await driver.handleRequest({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 701 }
      })
      await execution

      expect(operationId).toEqual(expect.stringMatching(/^agent_/u))
      expect(bodies).toContainEqual(expect.objectContaining({
        agent_operation_id: operationId,
        op: 'release_agent_action_state'
      }))
    } finally {
      stdout.mockRestore()
    }
  })

  it('releases the driver-scoped Agent tab state on a real stdio disconnect', async () => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.once('end', () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, result: { ok: true } }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Test broker did not bind a port.')
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/browser-driver.cjs', import.meta.url))], {
      env: {
        ...process.env,
        __ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__: 'disconnect-test-token',
        __ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__: `http://127.0.0.1:${address.port}`,
        __ONEWORKS_PROJECT_SESSION_ID__: 'disconnect-test-session'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin.end()
    const [exitCode] = await once(child, 'exit')
    await new Promise<void>((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)))

    expect(exitCode).toBe(0)
    expect(requests).toEqual([expect.objectContaining({
      driver_instance_id: expect.any(String),
      op: 'release_agent_action_state',
      session_id: 'disconnect-test-session'
    })])
  })
})
