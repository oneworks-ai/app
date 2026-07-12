import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const workflowRuntime = require('../bin/workflow-runtime.cjs') as {
  createWorkflowService: (options: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
    createId?: (prefix: string) => string
    now?: () => number
    preparePointerAction?: (options: {
      cursorColor?: string
      cursorStart?: { x: number; y: number }
      cursorStartPending: boolean
      runId: string
    }) => Promise<void> | void
    sleep?: (duration: number) => Promise<void>
  }) => {
    call: (name: string, input: Record<string, unknown>) => Promise<{
      content: Array<{ text: string; type: string }>
      isError?: boolean
      structuredContent: Record<string, any>
    }>
  }
  parseTreeElements: (tree: string) => Array<Record<string, unknown>>
}

const toolResult = (structuredContent: Record<string, unknown>) => ({ structuredContent })

const withAxConfig = (
  handler: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
) => async (name: string, args: Record<string, unknown>) => {
  if (name === 'get_config') return toolResult({ capture_mode: 'ax' })
  return await handler(name, args)
}

const calculatorTree = (value: string) => `- AXApplication "Calculator"
  - [0] AXWindow "Calculator" id=main actions=[AXRaise]
    - [1] AXButton (Clear) id=Clear
    - [2] AXButton (4) id=Four
    - AXStaticText = "${value}"
`

const duplicatedCalculatorTree = `- [0] AXWindow "Calculator" id=main
  - [1] AXButton (Clear) id=Clear
- [100] AXWindow "Calculator" id=main
  - [101] AXButton (Clear) id=Clear
`

const duplicatedCalculatorElements = (secondX: number) => [
  { element_index: 1, frame: { h: 48, w: 48, x: 64, y: 166 } },
  { element_index: 101, frame: { h: 48, w: 48, x: secondX, y: 166 } }
]

const deterministicIds = () => {
  let value = 0
  return (prefix: string) => `${prefix}_${value += 1}`
}

describe('cua workflow runtime', () => {
  it('refreshes semantic targets and inlines three small step results', async () => {
    let display = '9'
    const calls: Array<{ args: Record<string, unknown>; name: string }> = []
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async (name, args) => {
        calls.push({ args, name })
        if (name === 'launch_app') {
          return toolResult({
            name: 'Calculator',
            pid: 42,
            windows: [
              { bounds: { height: 20, width: 66 }, is_on_screen: true, on_current_space: true, title: 'Window', window_id: 6 },
              { bounds: { height: 408, width: 230 }, is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }
            ]
          })
        }
        if (name === 'get_window_state') return toolResult({ tree_markdown: calculatorTree(display) })
        if (name === 'click') {
          if (args.element_index === 1) display = '0'
          if (args.element_index === 2) display = '4'
          return toolResult({ ok: true })
        }
        throw new Error(`Unexpected tool: ${name}`)
      })
    })

    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [
        { context: 'calculator', node_id: 'clear', op: 'click', target: { id: 'Clear' } },
        { context: 'calculator', node_id: 'four', op: 'click', target: { id: 'Four' } },
        { context: 'calculator', node_id: 'verify', op: 'assert', target: { role: 'AXStaticText', text: '4' } }
      ]
    })

    expect(response.structuredContent).toEqual(expect.objectContaining({
      outcome: 'succeeded',
      run_id: 'run_1',
      status: 'completed'
    }))
    expect(response.structuredContent.steps).toHaveLength(3)
    expect(response.structuredContent.steps[2]).toEqual(expect.objectContaining({
      node_id: 'verify',
      status: 'completed'
    }))
    expect(calls.filter(call => call.name === 'get_window_state')).toHaveLength(3)
    expect(calls.filter(call => call.name === 'get_window_state').every(call => call.args.window_id === 7)).toBe(true)
  })

  it('returns step ids for longer workflows and fetches selected details in bulk', async () => {
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async () => {
        throw new Error('No native tool calls expected.')
      })
    })
    const response = await service.call('execute_workflow', {
      steps: [
        { node_id: 'one', op: 'sleep', duration_ms: 0 },
        { node_id: 'two', op: 'sleep', duration_ms: 0 },
        { node_id: 'three', op: 'sleep', duration_ms: 0 },
        { node_id: 'four', op: 'sleep', duration_ms: 0 }
      ]
    })

    expect(response.structuredContent.steps).toEqual({
      ids: ['step_2', 'step_3', 'step_4', 'step_5'],
      total: 4
    })
    const details = await service.call('get_workflow_step_results', {
      run_id: 'run_1',
      select: ['node_id', 'status', 'output'],
      step_ids: ['step_3', 'step_5']
    })
    expect(details.structuredContent.items).toEqual([
      {
        node_id: 'two',
        output: { duration_ms: 0 },
        status: 'completed',
        step_id: 'step_3'
      },
      {
        node_id: 'four',
        output: { duration_ms: 0 },
        status: 'completed',
        step_id: 'step_5'
      }
    ])
  })

  it('exits successfully when a declared target is absent', async () => {
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async (name) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        return toolResult({ tree_markdown: calculatorTree('0') })
      })
    })
    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [{
        context: 'calculator',
        node_id: 'dismiss-optional-dialog',
        on_missing: 'exit_success',
        op: 'click',
        target: { id: 'MissingDialogButton' }
      }]
    })

    expect(response.structuredContent).toEqual(expect.objectContaining({
      outcome: 'skipped',
      status: 'completed'
    }))
    expect(response.structuredContent.exit).toEqual(expect.objectContaining({
      step_id: 'step_2'
    }))
  })

  it('waits for state and resumes from explicit checkpoints', async () => {
    let currentTime = 0
    let observations = 0
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      now: () => currentTime,
      async sleep(duration) {
        currentTime += duration
      },
      callTool: withAxConfig(async (name) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        observations += 1
        return toolResult({ tree_markdown: calculatorTree(observations >= 2 ? 'ready' : 'loading') })
      })
    })

    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [
        {
          context: 'calculator',
          node_id: 'wait-ready',
          op: 'wait_for',
          poll_ms: 100,
          target: { role: 'AXStaticText', text: 'ready' },
          timeout_ms: 1000
        },
        {
          kind: 'agent_decision',
          node_id: 'review',
          op: 'checkpoint',
          prompt: 'Continue?'
        },
        { node_id: 'finish', op: 'sleep', duration_ms: 0 }
      ]
    })
    expect(response.structuredContent).toEqual(expect.objectContaining({
      kind: 'agent_decision',
      status: 'paused'
    }))

    const resumed = await service.call('resume_workflow', {
      checkpoint_id: response.structuredContent.checkpoint_id,
      decision: 'continue',
      run_id: response.structuredContent.run_id
    })
    expect(resumed.structuredContent).toEqual(expect.objectContaining({
      outcome: 'succeeded',
      status: 'completed'
    }))
    expect(resumed.structuredContent.steps).toHaveLength(3)
  })

  it('keeps each paused workflow cursor configuration until its first pointer action', async () => {
    const prepared: Array<Record<string, unknown>> = []
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      preparePointerAction(options) {
        prepared.push(options)
      },
      callTool: withAxConfig(async (name) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        if (name === 'get_window_state') return toolResult({ tree_markdown: calculatorTree('0') })
        if (name === 'click') return toolResult({ ok: true })
        throw new Error(`Unexpected tool: ${name}`)
      })
    })
    const contexts = {
      calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' }
    }

    const pausedA = await service.call('execute_workflow', {
      contexts,
      cursor_color: '#625BF6',
      cursor_start: { x: 100, y: 100 },
      steps: [
        { node_id: 'pause-a', op: 'checkpoint', prompt: 'Continue A?' },
        { context: 'calculator', node_id: 'click-a', op: 'click', target: { id: 'Clear' } }
      ]
    })
    await service.call('execute_workflow', {
      contexts,
      cursor_color: '#F97316',
      cursor_start: { x: 900, y: 700 },
      steps: [
        { context: 'calculator', node_id: 'click-b', op: 'click', target: { id: 'Clear' } }
      ]
    })
    await service.call('resume_workflow', {
      checkpoint_id: pausedA.structuredContent.checkpoint_id,
      decision: 'continue',
      run_id: pausedA.structuredContent.run_id
    })

    expect(prepared.map(entry => ({
      cursorColor: entry.cursorColor,
      cursorStart: entry.cursorStart,
      cursorStartPending: entry.cursorStartPending
    }))).toEqual([
      { cursorColor: '#F97316', cursorStart: { x: 900, y: 700 }, cursorStartPending: true },
      { cursorColor: '#625BF6', cursorStart: { x: 100, y: 100 }, cursorStartPending: true }
    ])
  })

  it('parses non-actionable state text for assertions', () => {
    expect(workflowRuntime.parseTreeElements(calculatorTree('4+5'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'AXStaticText', value: '4+5' })
    ]))
  })

  it('resolves the first unique semantic target from ordered alternatives', async () => {
    let display = '9'
    const clicked: unknown[] = []
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async (name, args) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        if (name === 'get_window_state') return toolResult({ tree_markdown: calculatorTree(display) })
        if (name === 'click') {
          clicked.push(args.element_index)
          display = '0'
          return toolResult({ ok: true })
        }
        throw new Error(`Unexpected tool: ${name}`)
      })
    })

    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [{
        context: 'calculator',
        op: 'click',
        target: { any_of: [{ id: 'AllClear' }, { id: 'Clear' }] }
      }]
    })

    expect(response.structuredContent.status).toBe('completed')
    expect(clicked).toEqual([1])
  })

  it('deduplicates repeated AX roots that describe the same physical control', async () => {
    const clicked: unknown[] = []
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async (name, args) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        if (name === 'get_window_state') {
          return toolResult({
            elements: duplicatedCalculatorElements(64),
            tree_markdown: duplicatedCalculatorTree
          })
        }
        if (name === 'click') {
          clicked.push(args.element_index)
          return toolResult({ ok: true })
        }
        throw new Error(`Unexpected tool: ${name}`)
      })
    })

    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [{ context: 'calculator', op: 'click', target: { id: 'Clear' } }]
    })

    expect(response.structuredContent.status).toBe('completed')
    expect(clicked).toEqual([1])
  })

  it('keeps identically named controls at different positions ambiguous', async () => {
    let clickCount = 0
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      callTool: withAxConfig(async (name) => {
        if (name === 'launch_app') {
          return toolResult({
            pid: 42,
            windows: [{ is_on_screen: true, on_current_space: true, title: 'Calculator', window_id: 7 }]
          })
        }
        if (name === 'get_window_state') {
          return toolResult({
            elements: duplicatedCalculatorElements(164),
            tree_markdown: duplicatedCalculatorTree
          })
        }
        if (name === 'click') {
          clickCount += 1
          return toolResult({ ok: true })
        }
        throw new Error(`Unexpected tool: ${name}`)
      })
    })

    const response = await service.call('execute_workflow', {
      contexts: { calculator: { bundle_id: 'com.apple.calculator', window_title: 'Calculator' } },
      steps: [{ context: 'calculator', op: 'click', target: { id: 'Clear' } }]
    })

    expect(response.structuredContent).toEqual(expect.objectContaining({
      code: 'TARGET_NOT_FOUND',
      status: 'failed'
    }))
    expect(clickCount).toBe(0)
  })

  it('procedurally switches the upstream driver to AX capture once per MCP session', async () => {
    let captureMode = 'som'
    const calls: string[] = []
    const service = workflowRuntime.createWorkflowService({
      createId: deterministicIds(),
      async callTool(name, args) {
        calls.push(name)
        if (name === 'get_config') return toolResult({ capture_mode: captureMode })
        if (name === 'set_config') {
          expect(args).toEqual({ key: 'capture_mode', value: 'ax' })
          captureMode = 'ax'
          return toolResult({ capture_mode: captureMode })
        }
        throw new Error(`Unexpected tool: ${name}`)
      }
    })

    await service.call('execute_workflow', { steps: [{ op: 'sleep', duration_ms: 0 }] })
    await service.call('execute_workflow', { steps: [{ op: 'sleep', duration_ms: 0 }] })

    expect(calls).toEqual(['get_config', 'set_config'])
  })
})
