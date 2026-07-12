import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__ = 'http://127.0.0.1:49091'
process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__ = 'test-token'
process.env.__ONEWORKS_PROJECT_SESSION_ID__ = 'session-browser'

const require = createRequire(import.meta.url)
const createWorkflowController = require('../bin/browser-driver-workflows.cjs') as (
  callOperation: (op: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
) => {
  executeWorkflow: (input: Record<string, unknown>) => Promise<{ structuredContent: Record<string, any> }>
}
const driver = require('../bin/browser-driver.cjs') as {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  getQueuedPageCount: () => number
  tools: Array<{ name: string; inputSchema: Record<string, any> }>
}

const bridgeResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

afterEach(async () => {
  await vi.waitFor(() => expect(driver.getQueuedPageCount()).toBe(0))
  vi.unstubAllGlobals()
})

describe('browser-driver page management', () => {
  it('forwards explicit placement and open mode without guessing an active tab', async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const input = JSON.parse(String(init.body)) as Record<string, unknown>
      return bridgeResponse({ ok: true, result: { ok: true, page: { id: 'page_new' }, request: input } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await driver.callTool('in_app_browser_open', {
      open_mode: 'new-tab',
      placement: 'bottom',
      url: 'https://example.com/'
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      op: 'open_page',
      open_mode: 'new-tab',
      placement: 'bottom',
      session_id: 'session-browser',
      url: 'https://example.com/'
    })
  })

  it('maps every page-management tool to its precise broker operation', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        const input = JSON.parse(String(init.body)) as Record<string, unknown>
        calls.push(input)
        return bridgeResponse({ ok: true, result: { ok: true, page_id: input.page_id } })
      })
    )
    const invocations: Array<[string, Record<string, unknown>, string]> = [
      ['in_app_browser_close_page', { page_id: 'page_7' }, 'close_page'],
      ['in_app_browser_duplicate_page', { page_id: 'page_7', placement: 'bottom' }, 'duplicate_page'],
      ['in_app_browser_move_page', { page_id: 'page_7', placement: 'right' }, 'move_page'],
      ['in_app_browser_reload', { page_id: 'page_7', ignore_cache: true }, 'reload'],
      ['in_app_browser_stop_loading', { page_id: 'page_7' }, 'stop_loading'],
      ['in_app_browser_navigate_history', { page_id: 'page_7', direction: 'back' }, 'navigate_history'],
      ['in_app_browser_get_navigation_state', { page_id: 'page_7' }, 'get_navigation_state'],
      ['in_app_browser_get_navigation_entries', { page_id: 'page_7', limit: 5 }, 'get_navigation_entries'],
      ['in_app_browser_clear_navigation_history', { page_id: 'page_7' }, 'clear_navigation_history'],
      ['in_app_browser_get_page_view_state', { page_id: 'page_7' }, 'get_page_view_state'],
      ['in_app_browser_list_device_presets', { page_id: 'page_7' }, 'list_device_presets'],
      ['in_app_browser_set_device_mode', { enabled: true, page_id: 'page_7' }, 'set_device_mode'],
      ['in_app_browser_set_embedded_devtools', { enabled: true, page_id: 'page_7' }, 'set_devtools'],
      ['in_app_browser_set_page_zoom', { factor: 1.25, page_id: 'page_7' }, 'set_zoom']
    ]

    for (const [tool, args] of invocations) await driver.callTool(tool, args)

    expect(calls.map(call => call.op)).toEqual(invocations.map(([, , operation]) => operation))
    expect(calls.every(call => call.session_id === 'session-browser')).toBe(true)
  })

  it('keeps history targeting unambiguous and view settings bounded', () => {
    const history = driver.tools.find(tool => tool.name === 'in_app_browser_navigate_history')
    expect(history?.inputSchema).toMatchObject({
      oneOf: [{ required: ['offset'] }, { required: ['index'] }, { required: ['direction'] }]
    })
    const device = driver.tools.find(tool => tool.name === 'in_app_browser_set_device_mode')
    expect(device?.inputSchema).toMatchObject({
      properties: {
        device_pixel_ratio: { maximum: 3, minimum: 1 },
        height: { maximum: 4096, minimum: 1 },
        width: { maximum: 4096, minimum: 1 }
      }
    })
    const pageZoom = driver.tools.find(tool => tool.name === 'in_app_browser_set_page_zoom')
    expect(pageZoom?.inputSchema).toMatchObject({ properties: { factor: { maximum: 5, minimum: 0.25 } } })
  })

  it('allows safe page controls in workflows but rejects lifecycle and large-result operations', async () => {
    const calls: string[] = []
    const controller = createWorkflowController(async (op: string) => {
      calls.push(op)
      return { ok: true }
    })
    await controller.executeWorkflow({
      page_id: 'page_7',
      steps: [
        { node_id: 'reload', op: 'reload', ignore_cache: true },
        { node_id: 'history', op: 'navigate_history', direction: 'back' },
        { node_id: 'state', op: 'get_navigation_state' },
        { node_id: 'view', op: 'get_page_view_state' },
        { node_id: 'device', op: 'set_device_mode', enabled: false },
        { node_id: 'devtools', op: 'set_devtools', enabled: false },
        { node_id: 'zoom', op: 'set_zoom', factor: 1 }
      ]
    })
    expect(calls).toEqual([
      'reload',
      'navigate_history',
      'get_navigation_state',
      'get_page_view_state',
      'set_device_mode',
      'set_devtools',
      'set_zoom'
    ])

    for (
      const op of [
        'close_page',
        'duplicate_page',
        'move_page',
        'clear_navigation_history',
        'get_navigation_entries'
      ]
    ) {
      await expect(controller.executeWorkflow({
        page_id: 'page_7',
        steps: [{ node_id: op, op }]
      })).rejects.toThrow('Unsupported browser workflow operation')
    }
  })

  it('requires exact workflow history and view-control arguments', async () => {
    const controller = createWorkflowController(async () => ({ ok: true }))
    await expect(controller.executeWorkflow({
      page_id: 'page_7',
      steps: [{ node_id: 'ambiguous', op: 'navigate_history', direction: 'back', offset: -1 }]
    })).rejects.toThrow('requires exactly one of index, offset, or direction')
    await expect(controller.executeWorkflow({
      page_id: 'page_7',
      steps: [{ node_id: 'device', op: 'set_device_mode' }]
    })).rejects.toThrow('requires enabled')
    await expect(controller.executeWorkflow({
      page_id: 'page_7',
      steps: [{ node_id: 'zoom', op: 'set_zoom' }]
    })).rejects.toThrow('requires factor')
  })
})
