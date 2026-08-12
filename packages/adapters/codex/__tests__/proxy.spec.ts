/* eslint-disable max-lines -- proxy tests keep end-to-end request handling cases together. */
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  CODEX_PROXY_META_HEADER_NAME,
  encodeCodexProxyMeta,
  ensureCodexProxyServer,
  getCodexProxyDispatcherCountForTests,
  resetCodexProxyDispatchersForTests
} from '#~/runtime/proxy.js'

const upstreamServers: Server[] = []
const tempDirs: string[] = []

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

const readRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

afterEach(async () => {
  await resetCodexProxyDispatchersForTests()
  await Promise.all(upstreamServers.splice(0).map(closeServer))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex proxy', () => {
  it('reuses a single local proxy instance across repeated starts', async () => {
    const first = await ensureCodexProxyServer()
    const second = await ensureCodexProxyServer()

    expect(first.baseUrl).toBe(second.baseUrl)
  })

  it('forwards upstream provider metadata and injects max_output_tokens', async () => {
    let capturedRequest:
      | {
        method: string | undefined
        url: string | undefined
        headers: Record<string, string | string[] | undefined>
        body: Record<string, unknown>
      }
      | undefined

    const upstream = createServer(async (req, res) => {
      const bodyText = await readRequestBody(req)
      capturedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(bodyText) as Record<string, unknown>
      }
      await new Promise(resolve => setTimeout(resolve, 25))
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({ ok: true }))
    })
    upstreamServers.push(upstream)

    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => {
        upstream.off('error', reject)
        resolve()
      })
    })

    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') {
      throw new Error('Failed to resolve upstream address')
    }

    const proxy = await ensureCodexProxyServer()
    const response = await fetch(`${proxy.baseUrl}/responses?stream=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
          queryParams: {
            'api-version': '2025-04-01-preview'
          },
          headers: {
            'X-Tenant': 'tenant-1'
          },
          maxOutputTokens: 8192
        })
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: 'Reply with pong.'
      })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(capturedRequest).toBeDefined()

    const upstreamUrl = new URL(capturedRequest!.url ?? '/', 'http://127.0.0.1')
    expect(capturedRequest).toMatchObject({
      method: 'POST',
      body: {
        model: 'gpt-5.4',
        input: 'Reply with pong.',
        max_output_tokens: 8192
      }
    })
    expect(upstreamUrl.pathname).toBe('/v1/responses')
    expect(upstreamUrl.searchParams.get('stream')).toBe('true')
    expect(upstreamUrl.searchParams.get('api-version')).toBe('2025-04-01-preview')
    expect(capturedRequest?.headers.authorization).toBe('Bearer test-key')
    expect(capturedRequest?.headers['x-tenant']).toBe('tenant-1')
    expect(capturedRequest?.headers['x-oneworks-proxy-meta']).toBeUndefined()
  })

  it('uses the adapter HTTP proxy for routed upstream requests', async () => {
    let proxyConnectCount = 0
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify({ proxied: true }))
    })
    upstreamServers.push(upstream)
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => resolve())
    })
    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Missing upstream address')

    const networkProxy = createServer()
    networkProxy.on('connect', (req, downstream, head) => {
      proxyConnectCount += 1
      const target = new URL(`http://${req.url ?? ''}`)
      const upstreamSocket = connect(Number(target.port), target.hostname, () => {
        downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstreamSocket.write(head)
        upstreamSocket.pipe(downstream)
        downstream.pipe(upstreamSocket)
      })
    })
    upstreamServers.push(networkProxy)
    await new Promise<void>((resolve, reject) => {
      networkProxy.once('error', reject)
      networkProxy.listen(0, '127.0.0.1', () => resolve())
    })
    const networkProxyAddress = networkProxy.address()
    if (networkProxyAddress == null || typeof networkProxyAddress === 'string') {
      throw new Error('Missing network proxy address')
    }

    const localProxy = await ensureCodexProxyServer()
    const response = await fetch(`${localProxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
          network: {
            httpProxy: `http://127.0.0.1:${networkProxyAddress.port}`,
            noProxy: 'example.invalid'
          }
        })
      },
      body: JSON.stringify({ model: 'gpt-5.4', input: 'ping' })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ proxied: true })
    expect(proxyConnectCount).toBe(1)
  })

  it('bounds cached upstream dispatchers across rotating network profiles', async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    upstreamServers.push(upstream)
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => resolve())
    })
    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Missing upstream address')
    const localProxy = await ensureCodexProxyServer()

    const responses = await Promise.all(Array.from({ length: 40 }, async (_, index) =>
      fetch(
        `${localProxy.baseUrl}/responses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
              upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
              network: { noProxy: `profile-${index}.example.test` }
            })
          },
          body: JSON.stringify({ model: 'gpt-5.4', input: 'ping' })
        }
      )))

    expect(responses.every(response => response.status === 200)).toBe(true)
    expect(getCodexProxyDispatcherCountForTests()).toBeLessThanOrEqual(32)
  })

  it('replays JSON request bodies across upstream 308 redirects', async () => {
    let capturedBody: string | undefined

    const target = createServer(async (req, res) => {
      capturedBody = await readRequestBody(req)
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({ ok: true }))
    })
    upstreamServers.push(target)

    await new Promise<void>((resolve, reject) => {
      target.once('error', reject)
      target.listen(0, '127.0.0.1', () => {
        target.off('error', reject)
        resolve()
      })
    })

    const targetAddress = target.address()
    if (targetAddress == null || typeof targetAddress === 'string') {
      throw new Error('Failed to resolve redirect target address')
    }

    const redirector = createServer((req, res) => {
      res.writeHead(308, {
        location: `http://127.0.0.1:${targetAddress.port}${req.url ?? '/responses'}`
      })
      res.end()
    })
    upstreamServers.push(redirector)

    await new Promise<void>((resolve, reject) => {
      redirector.once('error', reject)
      redirector.listen(0, '127.0.0.1', () => {
        redirector.off('error', reject)
        resolve()
      })
    })

    const redirectAddress = redirector.address()
    if (redirectAddress == null || typeof redirectAddress === 'string') {
      throw new Error('Failed to resolve redirector address')
    }

    const proxy = await ensureCodexProxyServer()
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${redirectAddress.port}`,
          maxOutputTokens: 8192
        })
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: 'Reply with pong.'
      })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(capturedBody).toBe(JSON.stringify({
      model: 'gpt-5.4',
      input: 'Reply with pong.',
      max_output_tokens: 8192
    }))
  })

  it('strips encrypted reasoning payloads before forwarding to upstream providers', async () => {
    let capturedBody: Record<string, unknown> | undefined

    const upstream = createServer(async (req, res) => {
      capturedBody = JSON.parse(await readRequestBody(req)) as Record<string, unknown>
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({ ok: true }))
    })
    upstreamServers.push(upstream)

    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => {
        upstream.off('error', reject)
        resolve()
      })
    })

    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') {
      throw new Error('Failed to resolve upstream address')
    }

    const proxy = await ensureCodexProxyServer()
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
          maxOutputTokens: 8192
        })
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'continue' }]
          },
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [],
            encrypted_content: 'gAAA'
          }
        ],
        include: ['reasoning.encrypted_content', 'file_search_call.results']
      })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(capturedBody).toEqual({
      model: 'gpt-5.5',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'continue' }]
        }
      ],
      include: ['file_search_call.results'],
      max_output_tokens: 8192
    })
  })

  it('handles Codex model list probes locally instead of forwarding to responses-only upstreams', async () => {
    let upstreamHits = 0
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-model-cache-'))
    tempDirs.push(codexHome)
    await writeFile(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({
        models: [{
          slug: 'gpt-5.4',
          display_name: 'GPT-5.4',
          description: 'Cached model metadata',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            {
              effort: 'low',
              description: 'low'
            },
            {
              effort: 'medium',
              description: 'medium'
            },
            {
              effort: 'high',
              description: 'high'
            },
            {
              effort: 'xhigh',
              description: 'xhigh'
            }
          ],
          shell_type: 'shell_command',
          visibility: 'list',
          supported_in_api: true,
          priority: 4,
          additional_speed_tiers: ['fast'],
          service_tiers: [],
          availability_nux: null,
          upgrade: null,
          base_instructions: 'base instructions',
          supports_reasoning_summaries: true,
          default_reasoning_summary: 'none',
          support_verbosity: true,
          default_verbosity: 'low',
          apply_patch_tool_type: 'freeform',
          web_search_tool_type: 'text',
          truncation_policy: {
            mode: 'tokens',
            limit: 10000
          },
          supports_parallel_tool_calls: true,
          supports_image_detail_original: false,
          context_window: 272000,
          max_context_window: 272000,
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          input_modalities: ['text', 'image'],
          supports_search_tool: true
        }]
      })
    )

    const upstream = createServer((_req, res) => {
      upstreamHits += 1
      res.writeHead(404, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })
    upstreamServers.push(upstream)

    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => {
        upstream.off('error', reject)
        resolve()
      })
    })

    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') {
      throw new Error('Failed to resolve upstream address')
    }

    const proxy = await ensureCodexProxyServer()
    const previousCodexHome = process.env.CODEX_HOME
    let response: Response
    try {
      process.env.CODEX_HOME = codexHome
      response = await fetch(`${proxy.baseUrl}/models?client_version=0.130.0`, {
        method: 'GET',
        headers: {
          [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
            upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/api/modelhub/online`,
            upstreamProtocol: 'openai-chat-completions',
            diagnostics: {
              requestedModel: 'modelhub,gpt-5.4',
              resolvedModel: 'gpt-5.4',
              wireApi: 'responses'
            }
          })
        }
      })
    } finally {
      if (previousCodexHome == null) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = previousCodexHome
      }
    }

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      models: [{
        slug: 'gpt-5.4',
        display_name: 'GPT-5.4',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          {
            effort: 'low'
          },
          {
            effort: 'medium'
          },
          {
            effort: 'high'
          },
          {
            effort: 'xhigh'
          }
        ],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 4,
        base_instructions: 'base instructions',
        supports_reasoning_summaries: true,
        support_verbosity: true,
        apply_patch_tool_type: 'freeform',
        truncation_policy: {
          mode: 'tokens',
          limit: 10000
        },
        supports_parallel_tool_calls: true,
        context_window: 272000,
        experimental_supported_tools: [],
        input_modalities: ['text', 'image']
      }]
    })
    expect(upstreamHits).toBe(0)
  })

  it('converts Responses requests and replies across Chat, Anthropic, and Gemini upstreams', async () => {
    const captured: Array<{
      body: Record<string, unknown>
      headers: IncomingMessage['headers']
      url: string
    }> = []
    const upstream = createServer(async (req, res) => {
      captured.push({
        body: JSON.parse(await readRequestBody(req)) as Record<string, unknown>,
        headers: req.headers,
        url: req.url ?? ''
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url?.includes('/chat/completions')) {
        res.end(JSON.stringify({
          choices: [{ message: { content: 'chat reply' } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        }))
      } else if (req.url?.includes('/messages')) {
        res.end(JSON.stringify({
          content: [{ type: 'text', text: 'anthropic reply' }],
          usage: { input_tokens: 4, output_tokens: 5 }
        }))
      } else {
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 7, totalTokenCount: 13 }
        }))
      }
    })
    upstreamServers.push(upstream)
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', resolve)
    })
    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Missing upstream address')
    const localProxy = await ensureCodexProxyServer()
    const protocols = [
      { protocol: 'openai-chat-completions', model: 'chat-model' },
      { protocol: 'anthropic-messages', model: 'claude-model' },
      { protocol: 'gemini-generate-content', model: 'gemini-model' }
    ] as const

    const responses = []
    for (const entry of protocols) {
      const response = await fetch(`${localProxy.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
            upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
            upstreamProtocol: entry.protocol
          })
        },
        body: JSON.stringify({ model: entry.model, input: 'hello', stream: false })
      })
      expect(response.status).toBe(200)
      responses.push(await response.json() as Record<string, unknown>)
    }

    expect(captured.map(request => request.url)).toEqual([
      '/v1/chat/completions',
      '/v1/messages',
      '/v1/models/gemini-model:generateContent'
    ])
    expect(captured[0]).toMatchObject({
      body: { model: 'chat-model', messages: [{ role: 'user', content: 'hello' }], stream: false },
      headers: { authorization: 'Bearer test-key' }
    })
    expect(captured[1]).toMatchObject({
      body: { model: 'claude-model', messages: [{ role: 'user' }], stream: false },
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'test-key' }
    })
    expect(captured[1].headers.authorization).toBeUndefined()
    expect(captured[2]).toMatchObject({
      body: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
      headers: { 'x-goog-api-key': 'test-key' }
    })
    expect(captured[2].headers.authorization).toBeUndefined()
    expect(responses).toMatchObject([
      { status: 'completed', output: [{ content: [{ text: 'chat reply' }] }], usage: { total_tokens: 5 } },
      { status: 'completed', output: [{ content: [{ text: 'anthropic reply' }] }], usage: { total_tokens: 9 } },
      { status: 'completed', output: [{ content: [{ text: 'gemini reply' }] }], usage: { total_tokens: 13 } }
    ])
  })

  it('preserves One Works Anthropic reasoning carriers through the real proxy request path', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const upstream = createServer(async (req, res) => {
      capturedBody = JSON.parse(await readRequestBody(req)) as Record<string, unknown>
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        content: [{ type: 'text', text: 'continued' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 1 }
      }))
    })
    upstreamServers.push(upstream)
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', resolve)
    })
    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Missing upstream address')

    const localProxy = await ensureCodexProxyServer()
    const carrier = `owmp:v1:${
      JSON.stringify({
        provider: 'anthropic',
        signature: 'signed-thinking',
        text: 'private reasoning'
      })
    }`
    const response = await fetch(`${localProxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
          upstreamProtocol: 'anthropic-messages'
        })
      },
      body: JSON.stringify({
        model: 'claude-model',
        max_output_tokens: 4096,
        reasoning: { effort: 'medium', summary: 'none' },
        include: ['reasoning.encrypted_content'],
        tools: [{ type: 'function', name: 'run', parameters: { type: 'object' } }],
        input: [
          { type: 'reasoning', encrypted_content: carrier },
          { type: 'function_call', call_id: 'call_1', name: 'run', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'ok' }
        ]
      })
    })

    expect(response.status).toBe(200)
    expect(capturedBody).toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private reasoning', signature: 'signed-thinking' },
            { type: 'tool_use', id: 'call_1', name: 'run' }
          ]
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1' }] }
      ]
    })
  })

  it('rejects unsupported conversion semantics and oversized request bodies before forwarding', async () => {
    let upstreamHits = 0
    const upstream = createServer((_req, res) => {
      upstreamHits += 1
      res.end('{}')
    })
    upstreamServers.push(upstream)
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', resolve)
    })
    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Missing upstream address')
    const proxy = await ensureCodexProxyServer()
    const meta = encodeCodexProxyMeta({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
      upstreamProtocol: 'openai-chat-completions'
    })

    const unsupported = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CODEX_PROXY_META_HEADER_NAME]: meta },
      body: JSON.stringify({ input: [], tools: [{ type: 'computer_use_preview' }] })
    })
    expect(unsupported.status).toBe(422)
    await expect(unsupported.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining('non-function Responses tool') }
    })

    const oversized = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CODEX_PROXY_META_HEADER_NAME]: meta },
      body: JSON.stringify({ input: 'x'.repeat(8 * 1024 * 1024) })
    })
    expect(oversized.status).toBe(413)
    expect(upstreamHits).toBe(0)
  })

  it('returns a JSON error instead of crashing for invalid upstream URLs', async () => {
    const proxy = await ensureCodexProxyServer()
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: String.raw`http://127.0.0.1:\${MISSING_PORT}/responses`
        })
      },
      body: JSON.stringify({
        model: 'codex-hooks',
        input: 'Reply with pong.'
      })
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'Invalid proxy metadata: upstreamBaseUrl must be a valid URL'
      }
    })
  })

  it('writes proxy logs to the adapter-codex scoped log file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-codex-proxy-log-'))
    tempDirs.push(cwd)
    const env = {
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(cwd, '.oneworks-projects')
    }

    const upstream = createServer(async (_req, res) => {
      await new Promise(resolve => setTimeout(resolve, 25))
      res.writeHead(500, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({
        error: {
          message: 'upstream failed'
        }
      }))
    })
    upstreamServers.push(upstream)

    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => {
        upstream.off('error', reject)
        resolve()
      })
    })

    const upstreamAddress = upstream.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') {
      throw new Error('Failed to resolve upstream address')
    }

    const proxy = await ensureCodexProxyServer()
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
        [CODEX_PROXY_META_HEADER_NAME]: encodeCodexProxyMeta({
          upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}?api_key=base-secret`,
          maxOutputTokens: 8192,
          queryParams: {
            'api-version': '2025-04-01-preview',
            api_key: 'query-secret'
          },
          headers: {
            'X-Tenant': 'tenant-1'
          },
          logContext: {
            cwd,
            ctxId: 'ctx-1',
            env,
            sessionId: 'session-1'
          },
          diagnostics: {
            routedServiceKey: 'azure',
            requestedModel: 'azure,gpt-5.4',
            resolvedModel: 'gpt-5.4',
            requestedEffort: 'max',
            effectiveEffort: 'max',
            runtime: 'server',
            sessionType: 'create'
          }
        })
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Reply with pong.' }]
          },
          {
            type: 'reasoning',
            encrypted_content: 'log-secret'
          }
        ],
        include: ['reasoning.encrypted_content']
      })
    })

    expect(response.status).toBe(500)
    await new Promise(resolve => setTimeout(resolve, 25))

    const logPath = resolveProjectHomePath(cwd, env, 'logs', 'ctx-1', 'session-1', 'adapter-codex', 'proxy.log.md')
    const logContent = await readFile(logPath, 'utf8')
    expect(logContent).toContain('[codex proxy] request received')
    expect(logContent).toContain('[codex proxy] forwarding request')
    expect(logContent).toContain('[codex proxy] upstream returned error status')
    expect(logContent).toContain('requestedModel: "azure,gpt-5.4"')
    expect(logContent).toContain('effectiveEffort: max')
    expect(logContent).toContain('authorization: "[REDACTED]"')
    expect(logContent).toContain('inputItems: 2')
    expect(logContent).toContain('strippedEncryptedReasoningItems: 1')
    expect(logContent).not.toContain('log-secret')
    expect(logContent).not.toContain('base-secret')
    expect(logContent).not.toContain('query-secret')
    expect(logContent).toContain('api-version: 2025-04-01-preview')
    expect(logContent).toContain('api_key: "[REDACTED]"')
    expect(logContent).toContain('injectedMaxOutputTokens: 8192')
    expect(logContent).not.toContain('Reply with pong.')
  })
})
