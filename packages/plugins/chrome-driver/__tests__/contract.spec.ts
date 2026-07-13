import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const manifest = require('../plugin.json') as {
  displayName: string
  plugin: { contributions: Record<string, unknown> & { settingsPages?: Array<Record<string, unknown>> } }
}
const contract = require('../bin/chrome-driver-contract.cjs') as {
  tools: Array<{ name: string; inputSchema: Record<string, unknown> }>
}
const driver = require('../bin/chrome-driver.cjs') as {
  enqueueResources: <T>(targets: string[], task: () => Promise<T>) => Promise<T>
  enqueueWorkflow: <T>(target: string, task: () => Promise<T>) => Promise<T>
  riskFor: (module: string, action: string, args?: Record<string, unknown>) => number
  targetKey: (module: string, args: Record<string, unknown>) => string
}
const { minimumRiskFor } = await import('../server/src/bridge.js')
const createWorkflowController = require('../../browser-driver/bin/browser-driver-workflows.cjs') as (
  operation: (op: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  options: Record<string, unknown>
) => {
  executeWorkflow: (args: Record<string, unknown>) => Promise<{ structuredContent: Record<string, any> }>
  getWorkflowSteps: (args: Record<string, unknown>) => { structuredContent: Record<string, any> }
  resumeWorkflow: (args: Record<string, unknown>) => Promise<{ structuredContent: Record<string, any> }>
}

describe('external browser MCP contract', () => {
  it('injects its control view into Settings instead of the main navigation', () => {
    const contributions = manifest.plugin.contributions
    expect(manifest.displayName).toBe('External Browser')
    expect(contributions.navItems).toBeUndefined()
    expect(contributions.routes).toBeUndefined()
    expect(contributions.settingsPages).toEqual([
      expect.objectContaining({
        clientView: 'control',
        id: 'external-browser',
        title: 'External Browser',
        titleI18n: { en: 'External Browser', 'zh-Hans': '外部浏览器' }
      })
    ])
  })

  it('covers browser modules and exposes raw access only through explicit gated actions', () => {
    const names = contract.tools.map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'chrome_capabilities',
      'chrome_windows',
      'chrome_tabs',
      'chrome_tab_groups',
      'chrome_sessions',
      'chrome_history',
      'chrome_bookmarks',
      'chrome_downloads',
      'chrome_reading_list',
      'chrome_extensions',
      'chrome_devices',
      'chrome_frames',
      'chrome_page',
      'chrome_debug',
      'chrome_cookies',
      'chrome_site_settings',
      'chrome_browsing_data',
      'chrome_proxy',
      'chrome_privacy',
      'chrome_raw',
      'chrome_audit',
      'execute_chrome_workflow',
      'execute_chrome_workflows',
      'get_chrome_workflow_steps',
      'resume_chrome_workflow'
    ]))
    expect(names.filter(name => /raw/iu.test(name))).toEqual(['chrome_raw'])
    const cookieTool = contract.tools.find(tool => tool.name === 'chrome_cookies')
    interface SchemaVariant {
      properties: { action: { const: string }; value?: unknown }
    }
    const metadataVariant = (cookieTool?.inputSchema as { oneOf: SchemaVariant[] }).oneOf
      .find(variant => variant.properties.action.const === 'list_metadata')
    expect(metadataVariant).toBeDefined()
    expect(metadataVariant?.properties).not.toHaveProperty('value')
    const valueVariant = (cookieTool?.inputSchema as { oneOf: SchemaVariant[] }).oneOf
      .find(variant => variant.properties.action.const === 'list_with_values')
    expect(valueVariant).toBeDefined()
    expect((valueVariant as unknown as { required: string[] }).required).toContain('url')

    const rawTool = contract.tools.find(tool => tool.name === 'chrome_raw')
    const rawActions = (rawTool?.inputSchema as { oneOf: SchemaVariant[] }).oneOf
      .map(variant => variant.properties.action.const)
    expect(rawActions).toEqual(['evaluate', 'cdp_command'])
  })

  it('uses stable explicit target identities and escalates destructive risk', () => {
    expect(driver.targetKey('page', { tab_id: 7, frame_id: 4, document_id: 'doc-9' }))
      .toBe('tab:7')
    expect(driver.targetKey('tabs', { tab_ids: [9, 2] })).toBe('tabs:2,9')
    expect(driver.riskFor('tabs', 'update')).toBe(2)
    expect(driver.riskFor('tabs', 'close')).toBe(3)
    expect(driver.riskFor('page', 'print_to_pdf')).toBe(3)
    expect(driver.riskFor('downloads', 'start', { conflict_action: 'overwrite' })).toBe(3)
    expect(driver.riskFor('history', 'remove_url')).toBe(3)
    expect(driver.riskFor('history', 'clear_all')).toBe(4)
    expect(driver.riskFor('cookies', 'list_metadata')).toBe(3)
    expect(driver.riskFor('cookies', 'list_with_values')).toBe(4)
    expect(driver.riskFor('page', 'snapshot_sensitive')).toBe(4)
    expect(driver.riskFor('page', 'type_sensitive')).toBe(4)
    expect(driver.riskFor('raw', 'evaluate')).toBe(4)
    expect(driver.riskFor('management', 'uninstall')).toBe(4)
  })

  it('keeps MCP and bridge risk floors aligned for sensitive actions', () => {
    for (
      const [module, action] of [
        ['tabs', 'close'],
        ['windows', 'close'],
        ['readingList', 'remove'],
        ['page', 'save_mhtml'],
        ['page', 'print_to_pdf'],
        ['page', 'snapshot_sensitive'],
        ['history', 'remove_url'],
        ['cookies', 'set'],
        ['cookies', 'list_with_values'],
        ['raw', 'cdp_command'],
        ['management', 'set_enabled']
      ]
    ) expect(driver.riskFor(module, action)).toBe(minimumRiskFor(`${module}.${action}`))
  })

  it('serializes complete workflows for one tab while allowing different tabs to overlap', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = driver.enqueueWorkflow('tab:1', async () => {
      order.push('a1')
      await new Promise<void>(resolve => {
        releaseFirst = resolve
      })
      order.push('a2')
    })
    const second = driver.enqueueWorkflow('tab:1', async () => {
      order.push('b1')
      order.push('b2')
    })
    const other = driver.enqueueWorkflow('tab:2', async () => {
      order.push('c1')
      order.push('c2')
    })
    await vi.waitFor(() => expect(order).toContain('c2'))
    expect(order).not.toContain('b1')
    releaseFirst?.()
    await Promise.all([first, second, other])
    expect(order.indexOf('a2')).toBeLessThan(order.indexOf('b1'))
  })

  it('prevents direct operations and overlapping tab sets from interleaving a tab workflow', async () => {
    const order: string[] = []
    let release: (() => void) | undefined
    const workflow = driver.enqueueWorkflow('tab:2', async () => {
      order.push('workflow-start')
      await new Promise<void>(resolve => {
        release = resolve
      })
      order.push('workflow-end')
    })
    const direct = driver.enqueueResources(['tab:2'], async () => {
      order.push('direct')
    })
    const overlapping = driver.enqueueResources(['tab:1', 'tab:2'], async () => {
      order.push('overlap')
    })
    const independent = driver.enqueueResources(['tab:3'], async () => {
      order.push('independent')
    })
    await vi.waitFor(() => expect(order).toContain('independent'))
    expect(order).not.toContain('direct')
    expect(order).not.toContain('overlap')
    release?.()
    await Promise.all([workflow, direct, overlapping, independent])
    expect(order.indexOf('workflow-end')).toBeLessThan(order.indexOf('direct'))
    expect(order.indexOf('workflow-end')).toBeLessThan(order.indexOf('overlap'))
  })
})

describe('shared progressive workflow controller', () => {
  it('handles continue checkpoints locally without sending an unsupported browser operation', async () => {
    const operation = vi.fn(async (op: string) => ({ op }))
    const controller = createWorkflowController(operation, {
      operationNames: ['checkpoint', 'wait'],
      targetId: () => 'tab:1'
    })
    const result = await controller.executeWorkflow({
      tab_id: 1,
      steps: [
        { node_id: 'continue', op: 'checkpoint', checkpoint: 'continue' },
        { node_id: 'after', op: 'wait' }
      ]
    })

    expect(result.structuredContent).toMatchObject({ status: 'completed', outcome: 'succeeded' })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledWith('wait', expect.any(Object))
  })

  it('pauses without consuming a failed confirmation step and resumes it', async () => {
    let confirmed = false
    const controller = createWorkflowController(async (op: string) => {
      if (op === 'click' && !confirmed) {
        confirmed = true
        throw Object.assign(new Error('Confirm'), { code: 'CONFIRMATION_REQUIRED' })
      }
      return { op }
    }, { operationNames: ['click'], targetId: () => 'tab:1' })
    const first = await controller.executeWorkflow({ tab_id: 1, steps: [{ node_id: 'click', op: 'click', ref: 'r1' }] })
    expect(first.structuredContent).toMatchObject({ status: 'paused', outcome: 'paused' })
    const runId = first.structuredContent.run_id
    const paused = controller.getWorkflowSteps({ run_id: runId }).structuredContent
    expect(paused.steps).toHaveLength(1)
    const resumed = await controller.resumeWorkflow({ run_id: runId, action: 'continue' })
    expect(resumed.structuredContent).toMatchObject({ status: 'completed', outcome: 'succeeded' })
    expect(controller.getWorkflowSteps({ run_id: runId }).structuredContent.steps).toHaveLength(2)
  })

  it('does not skip the first post-checkpoint step when a consumed pause is skipped', async () => {
    const operation = vi.fn(async () => ({ ok: true }))
    const controller = createWorkflowController(operation, {
      operationNames: ['checkpoint', 'wait'],
      targetId: () => 'tab:1'
    })
    const paused = await controller.executeWorkflow({
      tab_id: 1,
      steps: [
        { node_id: 'gate', op: 'checkpoint', checkpoint: 'pause' },
        { node_id: 'after', op: 'wait' }
      ]
    })
    const resumed = await controller.resumeWorkflow({ run_id: paused.structuredContent.run_id, action: 'skip' })
    expect(resumed.structuredContent).toMatchObject({ status: 'completed', outcome: 'succeeded' })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('does not skip the first post-checkpoint step when a consumed confirm checkpoint is skipped', async () => {
    const operation = vi.fn(async () => ({ ok: true }))
    const controller = createWorkflowController(operation, {
      operationNames: ['checkpoint', 'wait'],
      targetId: () => 'tab:1'
    })
    const paused = await controller.executeWorkflow({
      tab_id: 1,
      steps: [
        { node_id: 'gate', op: 'checkpoint', checkpoint: 'confirm' },
        { node_id: 'after', op: 'wait' }
      ]
    })
    await controller.resumeWorkflow({ run_id: paused.structuredContent.run_id, action: 'skip' })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('returns a run id immediately for background workflows', async () => {
    let release: (() => void) | undefined
    const controller = createWorkflowController(async () => {
      await new Promise<void>(resolve => {
        release = resolve
      })
      return { ok: true }
    }, { operationNames: ['wait'], targetId: () => 'tab:2' })
    const result = await controller.executeWorkflow({
      background: true,
      tab_id: 2,
      steps: [{ node_id: 'wait', op: 'wait' }]
    })
    expect(result.structuredContent.status).toBe('running')
    expect(result.structuredContent.run_id).toMatch(/^run_/u)
    release?.()
  })
})
