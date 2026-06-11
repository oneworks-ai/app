/* eslint-disable max-lines -- proxy tests keep end-to-end request handling cases together. */
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { CODEX_PROXY_META_HEADER_NAME, encodeCodexProxyMeta, ensureCodexProxyServer } from '#~/runtime/proxy.js'

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
    expect(logContent).toContain('encrypted_content: "[REDACTED]"')
    expect(logContent).not.toContain('log-secret')
    expect(logContent).not.toContain('base-secret')
    expect(logContent).not.toContain('query-secret')
    expect(logContent).toContain('api-version: 2025-04-01-preview')
    expect(logContent).toContain('api_key: "[REDACTED]"')
    expect(logContent).toContain('max_output_tokens: 8192')
    expect(logContent).toContain('message: upstream failed')
  })
})
