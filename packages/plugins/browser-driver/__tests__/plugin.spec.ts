import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__ = 'http://127.0.0.1:49091'
process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__ = 'test-token'
process.env.__ONEWORKS_PROJECT_SESSION_ID__ = 'session-browser'

const require = createRequire(import.meta.url)
const createWorkflowController = require('../bin/browser-driver-workflows.cjs') as (
  callOperation: (op: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
) => {
  executeWorkflow: (input: Record<string, unknown>) => Promise<{ structuredContent: Record<string, any> }>
  getWorkflowSteps: (input: Record<string, unknown>) => { structuredContent: Record<string, any> }
}
const driver = require('../bin/browser-driver.cjs') as {
  callTool: (name: string, args: Record<string, unknown>) => Promise<{
    content: Array<{ text: string }>
    structuredContent: Record<string, any>
  }>
  getQueuedPageCount: () => number
  tools: Array<{ name: string; inputSchema: Record<string, unknown> }>
  readBridgeCredentials: () => { bridgeToken?: string; bridgeUrl?: string }
}

const readJson = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))

const bridgeResponse = (body: unknown) =>
  ({
    ok: true,
    json: async () => body
  }) as Response

afterEach(async () => {
  await vi.waitFor(() => expect(driver.getQueuedPageCount()).toBe(0))
  vi.unstubAllGlobals()
})

describe('browser-driver plugin contract', () => {
  it('exposes semantic tools without raw JavaScript or CDP escape hatches', () => {
    const names = driver.tools.map(tool => tool.name)
    expect(names).toEqual([
      'in_app_browser_list_pages',
      'in_app_browser_open',
      'in_app_browser_show_page',
      'in_app_browser_close_page',
      'in_app_browser_duplicate_page',
      'in_app_browser_move_page',
      'in_app_browser_reload',
      'in_app_browser_stop_loading',
      'in_app_browser_navigate_history',
      'in_app_browser_get_navigation_state',
      'in_app_browser_get_navigation_entries',
      'in_app_browser_clear_navigation_history',
      'in_app_browser_get_page_view_state',
      'in_app_browser_list_device_presets',
      'in_app_browser_set_device_mode',
      'in_app_browser_set_embedded_devtools',
      'in_app_browser_set_page_zoom',
      'in_app_browser_snapshot',
      'in_app_browser_navigate',
      'in_app_browser_click',
      'in_app_browser_type',
      'in_app_browser_select',
      'in_app_browser_press_key',
      'in_app_browser_scroll',
      'in_app_browser_wait',
      'in_app_browser_screenshot',
      'execute_in_app_browser_workflow',
      'execute_in_app_browser_workflows',
      'get_in_app_browser_workflow_steps'
    ])
    expect(names.some(name => name.startsWith('browser_'))).toBe(false)
    expect(names.some(name => name.startsWith('execute_browser_'))).toBe(false)
    expect(names.some(name => /javascript|cdp|inspect_element/iu.test(name))).toBe(false)
  })

  it('automatically scopes broker calls to the current OneWorks session', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) =>
      bridgeResponse({
        ok: true,
        pages: [{ id: 'page_7', session_id: 'session-browser', title: 'Example', url: 'https://example.com/' }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await driver.callTool('in_app_browser_list_pages', {})

    expect(result.structuredContent.pages).toHaveLength(1)
    const request = fetchMock.mock.calls[0]
    expect(request?.[0].toString()).toBe('http://127.0.0.1:49091/v1/control')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      op: 'list_pages',
      session_id: 'session-browser'
    })
    expect(request?.[1]?.headers).toMatchObject({ authorization: 'Bearer test-token' })
  })

  it('defaults in_app_browser_open to the right panel and allows bottom placement', () => {
    const browserOpen = driver.tools.find(tool => tool.name === 'in_app_browser_open')
    expect(browserOpen?.inputSchema).toMatchObject({
      properties: {
        placement: { default: 'right', enum: ['right', 'bottom'] },
        open_mode: { default: 'reuse-or-create', enum: ['reuse-or-create', 'new-tab'] }
      }
    })
  })

  it('shows an existing page by explicit page id', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) =>
      bridgeResponse({
        ok: true,
        result: { ok: true, page: { id: 'page_7' } }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await driver.callTool('in_app_browser_show_page', { page_id: 'page_7' })

    expect(result.structuredContent).toMatchObject({ ok: true, page: { id: 'page_7' } })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      op: 'show_page',
      page_id: 'page_7',
      session_id: 'session-browser'
    })
  })

  it('requires explicit page ids for every page operation', () => {
    const implicitPageTools = new Set([
      'in_app_browser_list_pages',
      'in_app_browser_open',
      'execute_in_app_browser_workflows',
      'get_in_app_browser_workflow_steps'
    ])
    for (const tool of driver.tools) {
      if (implicitPageTools.has(tool.name)) continue
      expect(tool.inputSchema.required).toContain('page_id')
    }
  })

  it('accepts only workspace-bound loopback credential discovery', () => {
    const originalUrl = process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__
    const originalToken = process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    const originalWorkspace = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    const workspace = path.join(tmpdir(), 'browser-driver-credential-test')
    const key = createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 24)
    const credentialPath = path.join(tmpdir(), 'oneworks-browser-control', `${key}.json`)
    mkdirSync(path.dirname(credentialPath), { mode: 0o700, recursive: true })
    delete process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__
    delete process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    try {
      writeFileSync(
        credentialPath,
        JSON.stringify({
          baseUrl: 'https://example.com/',
          token: 'bad',
          workspaceFolder: workspace
        }),
        { mode: 0o600 }
      )
      expect(driver.readBridgeCredentials()).toEqual({})
      writeFileSync(
        credentialPath,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:49091',
          token: 'bad',
          workspaceFolder: '/other'
        }),
        { mode: 0o600 }
      )
      expect(driver.readBridgeCredentials()).toEqual({})
      writeFileSync(
        credentialPath,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:49091',
          token: 'good',
          workspaceFolder: workspace
        }),
        { mode: 0o600 }
      )
      expect(driver.readBridgeCredentials()).toEqual({
        bridgeToken: 'good',
        bridgeUrl: 'http://127.0.0.1:49091'
      })
    } finally {
      rmSync(credentialPath, { force: true })
      process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__ = originalUrl
      process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__ = originalToken
      if (originalWorkspace == null) delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      else process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalWorkspace
    }
  })

  it('returns inline summaries for short workflows and preserves step details by id', async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as Record<string, unknown>
      return bridgeResponse({ ok: true, result: { ok: true, op: input.op, page_id: 'page_7' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await driver.callTool('execute_in_app_browser_workflow', {
      page_id: 'page_7',
      workflow_id: 'short-flow',
      steps: [
        { node_id: 'first', op: 'scroll', y: 200 },
        { node_id: 'second', op: 'wait', duration_ms: 10 }
      ]
    })

    expect(result.structuredContent).toMatchObject({
      outcome: 'succeeded',
      status: 'completed',
      steps: { total: 2 }
    })
    expect(result.structuredContent.steps.results).toHaveLength(2)
    const details = await driver.callTool('get_in_app_browser_workflow_steps', {
      run_id: result.structuredContent.run_id,
      step_ids: [result.structuredContent.steps.ids[1]]
    })
    expect(details.structuredContent.steps).toMatchObject([{ node_id: 'second', status: 'completed' }])
  })

  it('validates every workflow node before starting any browser operation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(driver.callTool('execute_in_app_browser_workflow', {
      page_id: 'page_7',
      steps: [
        { node_id: 'duplicate', op: 'scroll', y: 20 },
        { node_id: 'duplicate', op: 'wait', duration_ms: 10 }
      ]
    })).rejects.toThrow('Duplicate workflow node_id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns only step ids for workflows longer than three steps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        bridgeResponse({
          ok: true,
          result: { ok: true, page_id: 'page_7' }
        })
      )
    )
    const result = await driver.callTool('execute_in_app_browser_workflow', {
      page_id: 'page_7',
      steps: Array.from({ length: 4 }, (_, index) => ({
        node_id: `wait-${index}`,
        op: 'wait',
        duration_ms: 0
      }))
    })
    expect(result.structuredContent.steps).toMatchObject({ total: 4 })
    expect(result.structuredContent.steps.results).toBeUndefined()
    expect(result.structuredContent.steps.ids).toHaveLength(4)
  })

  it('retains a completed run while other runs are still active', async () => {
    const releases: Array<() => void> = []
    const controller = createWorkflowController(async () => {
      await new Promise<void>(resolve => releases.push(resolve))
      return { ok: true }
    })
    const executions = Array.from({ length: 21 }, (_, index) =>
      controller.executeWorkflow({
        page_id: `page_${index}`,
        steps: [{ node_id: `wait-${index}`, op: 'wait', duration_ms: 0 }]
      }))
    await vi.waitFor(() => expect(releases).toHaveLength(21))

    releases[0]()
    const first = await executions[0]
    expect(controller.getWorkflowSteps({ run_id: first.structuredContent.run_id }).structuredContent.status)
      .toBe('completed')
    releases.slice(1).forEach(release => release())
    await Promise.all(executions.slice(1))
  })

  it('runs different pages concurrently and isolates a failed workflow', async () => {
    const releases = new Map<string, () => void>()
    const started: string[] = []
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as Record<string, unknown>
      const currentPage = String(input.page_id)
      started.push(currentPage)
      await new Promise<void>(resolve => releases.set(currentPage, resolve))
      return currentPage === 'page_2'
        ? bridgeResponse({ ok: false, error: { code: 'EXPECTED_FAILURE', message: 'Page two failed.' } })
        : bridgeResponse({ ok: true, result: { ok: true, page_id: currentPage } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const execution = driver.callTool('execute_in_app_browser_workflows', {
      workflows: [
        {
          page_id: 'page_1',
          workflow_id: 'first-page',
          steps: [{ node_id: 'wait-one', op: 'wait', duration_ms: 0 }]
        },
        {
          page_id: 'page_2',
          workflow_id: 'second-page',
          steps: [{ node_id: 'wait-two', op: 'wait', duration_ms: 0 }]
        }
      ]
    })

    await vi.waitFor(() => expect(started).toEqual(['page_1', 'page_2']))
    expect(driver.getQueuedPageCount()).toBe(2)
    releases.get('page_1')?.()
    releases.get('page_2')?.()
    const result = await execution

    expect(result.structuredContent).toMatchObject({
      outcome: 'partial',
      runs: [
        { outcome: 'succeeded', page_id: 'page_1', workflow_id: 'first-page' },
        { outcome: 'failed', page_id: 'page_2', workflow_id: 'second-page' }
      ],
      status: 'completed'
    })
    expect(result.structuredContent.runs[0].steps.results).toBeUndefined()
  })

  it('keeps operations for the same page strictly serial', async () => {
    let releaseFirst!: () => void
    let callCount = 0
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        callCount += 1
        if (callCount === 1) await firstGate
        const input = JSON.parse(String(init.body)) as Record<string, unknown>
        return bridgeResponse({ ok: true, result: { ok: true, page_id: input.page_id } })
      })
    )

    const first = driver.callTool('in_app_browser_wait', { duration_ms: 0, page_id: 'page_same' })
    const second = driver.callTool('in_app_browser_wait', { duration_ms: 0, page_id: 'page_same' })
    await vi.waitFor(() => expect(callCount).toBe(1))
    expect(driver.getQueuedPageCount()).toBe(1)

    releaseFirst()
    await Promise.all([first, second])
    expect(callCount).toBe(2)
  })

  it('validates every multi-page workflow before starting any page', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(driver.callTool('execute_in_app_browser_workflows', {
      workflows: [
        { page_id: 'page_1', steps: [{ node_id: 'valid', op: 'wait', duration_ms: 0 }] },
        { page_id: 'page_2', steps: [{ node_id: 'duplicate', op: 'wait' }, { node_id: 'duplicate', op: 'wait' }] }
      ]
    })).rejects.toThrow('Duplicate workflow node_id')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('declares the MCP and presentation assets in the plugin manifest', async () => {
    const manifest = await readJson('plugin.json')
    const mcp = await readJson('mcp/browser-driver.json')
    expect(manifest).toMatchObject({
      name: '@oneworks/plugin-browser-driver',
      assets: { mcp: 'mcp', skills: 'skills' }
    })
    expect(manifest.plugin.contributions.toolUsePresentations).toEqual(expect.arrayContaining([
      expect.objectContaining({ tools: ['execute_in_app_browser_workflow'] }),
      expect.objectContaining({ tools: ['execute_in_app_browser_workflows'] }),
      expect.objectContaining({ tools: ['in_app_browser_snapshot'] })
    ]))
    const presentedTools = manifest.plugin.contributions.toolUsePresentations
      .flatMap((presentation: { tools?: string[] }) => presentation.tools ?? [])
    expect(presentedTools).toEqual(expect.arrayContaining([
      'in_app_browser_close_page',
      'in_app_browser_get_navigation_entries',
      'in_app_browser_list_device_presets',
      'in_app_browser_set_device_mode',
      'in_app_browser_set_embedded_devtools',
      'in_app_browser_set_page_zoom'
    ]))
    expect(mcp).toMatchObject({
      command: '$' + '{ONEWORKS_NODE_EXECUTABLE}',
      args: ['$' + '{ONEWORKS_PLUGIN_ROOT}/bin/browser-driver.cjs'],
      default_tools_approval_mode: 'approve'
    })
  })

  it('declares workflow output objects as record details instead of string metadata', async () => {
    const manifest = await readJson('plugin.json')
    const presentations = manifest.plugin.contributions.toolUsePresentations
    for (const presentationId of ['in-app-browser-workflow', 'in-app-browser-step-results']) {
      const fieldPath = presentationId === 'in-app-browser-workflow'
        ? 'structuredContent.steps.results'
        : 'structuredContent.steps'
      const presentation = presentations.find((candidate: { id?: string }) => candidate.id === presentationId)
      const field = presentation?.result?.fields?.find((candidate: { path?: string }) => candidate.path === fieldPath)
      expect(field).toMatchObject({
        format: 'records',
        item: {
          detailPath: 'output',
          metaPath: 'step_id',
          subtitlePath: 'status',
          titlePath: 'node_id'
        }
      })
      expect(field?.item?.metaPath).not.toBe('output')
    }
  })
})
