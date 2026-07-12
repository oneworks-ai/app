import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const workflowRuntime = require('../bin/workflow-runtime.cjs') as {
  createWorkflowService: (options: {
    acquireResources?: (keys: string[], task: () => Promise<unknown>) => Promise<unknown>
    callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
    sleep?: (duration: number) => Promise<void>
  }) => {
    call: (name: string, input: Record<string, unknown>) => Promise<{
      content: Array<{ text: string; type: string }>
      isError?: boolean
      structuredContent: Record<string, any>
    }>
    getQueuedResourceCount: () => number
  }
}

const toolResult = (structuredContent: Record<string, unknown>) => ({ structuredContent })
const withAxConfig = (
  handler: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
) =>
async (name: string, args: Record<string, unknown>) =>
  name === 'get_config' ? toolResult({ capture_mode: 'ax' }) : await handler(name, args)

const sleepWorkflow = (bundleId: string, duration: number) => ({
  contexts: { app: { bundle_id: bundleId } },
  steps: [{ node_id: `sleep-${duration}`, op: 'sleep', duration_ms: duration }]
})

describe('cua workflow concurrency', () => {
  it('runs different apps concurrently and isolates workflow failure', async () => {
    const releases = new Map<number, () => void>()
    const started: number[] = []
    const service = workflowRuntime.createWorkflowService({
      callTool: withAxConfig(async () => {
        throw new Error('No native tool calls expected.')
      }),
      async sleep(duration) {
        started.push(duration)
        await new Promise<void>(resolve => releases.set(duration, resolve))
        if (duration === 2) throw new Error('Expected second-app failure.')
      }
    })

    const execution = service.call('execute_workflows', {
      workflows: [sleepWorkflow('com.example.bundle-31', 1), sleepWorkflow('com.example.bundle-91', 2)]
    })
    await vi.waitFor(() => expect(started).toEqual([1, 2]))
    expect(service.getQueuedResourceCount()).toBe(2)
    releases.get(1)?.()
    releases.get(2)?.()

    const response = await execution
    expect(response.structuredContent).toMatchObject({
      outcome: 'partial',
      runs: [{ outcome: 'succeeded' }, { outcome: 'failed' }],
      status: 'completed'
    })
    await vi.waitFor(() => expect(service.getQueuedResourceCount()).toBe(0))
  })

  it('serializes the same app across independent MCP services', async () => {
    let releaseFirst!: () => void
    const started: number[] = []
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const options = (first: boolean) => ({
      callTool: withAxConfig(async () => {
        throw new Error('No native tool calls expected.')
      }),
      async sleep(duration: number) {
        started.push(duration)
        if (first) await firstGate
      }
    })
    const firstService = workflowRuntime.createWorkflowService(options(true))
    const secondService = workflowRuntime.createWorkflowService(options(false))
    const bundleId = `com.example.cross-session-${process.pid}`

    const first = firstService.call('execute_workflow', sleepWorkflow(bundleId, 3))
    await vi.waitFor(() => expect(started).toEqual([3]))
    const second = secondService.call('execute_workflow', sleepWorkflow(bundleId, 4))
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(started).toEqual([3])

    releaseFirst()
    await Promise.all([first, second])
    expect(started).toEqual([3, 4])
  })

  it('fully prevalidates a batch before any workflow side effect', async () => {
    const callTool = vi.fn(async () => toolResult({ capture_mode: 'ax' }))
    const sleep = vi.fn(async () => undefined)
    const service = workflowRuntime.createWorkflowService({ callTool, sleep })
    const response = await service.call('execute_workflows', {
      workflows: [
        { steps: [{ node_id: 'valid', op: 'sleep', duration_ms: 0 }] },
        {
          contexts: { app: { bundle_id: 'com.example.invalid-target' } },
          steps: [{ context: 'app', node_id: 'empty-target', op: 'click', target: {} }]
        }
      ]
    })

    expect(response).toMatchObject({ isError: true, structuredContent: { code: 'INVALID_WORKFLOW' } })
    expect(callTool).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([
    { any_of: [] },
    { any_of: [{ id: '' }] }
  ])('rejects invalid target alternatives before any workflow side effect', async target => {
    const callTool = vi.fn(async () => toolResult({ capture_mode: 'ax' }))
    const sleep = vi.fn(async () => undefined)
    const service = workflowRuntime.createWorkflowService({ callTool, sleep })
    const response = await service.call('execute_workflows', {
      workflows: [
        { steps: [{ node_id: 'valid', op: 'sleep', duration_ms: 0 }] },
        {
          contexts: { app: { bundle_id: 'com.example.invalid-alternative' } },
          steps: [{ context: 'app', op: 'click', target }]
        }
      ]
    })

    expect(response).toMatchObject({ isError: true, structuredContent: { code: 'INVALID_WORKFLOW' } })
    expect(callTool).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('rejects an empty postcondition target before any workflow side effect', async () => {
    const callTool = vi.fn(async () => toolResult({ capture_mode: 'ax' }))
    const sleep = vi.fn(async () => undefined)
    const service = workflowRuntime.createWorkflowService({ callTool, sleep })
    const response = await service.call('execute_workflows', {
      workflows: [
        { steps: [{ node_id: 'valid', op: 'sleep', duration_ms: 0 }] },
        {
          contexts: { app: { bundle_id: 'com.example.invalid-postcondition' } },
          steps: [{
            context: 'app',
            op: 'click',
            postcondition: { target: {} },
            target: { id: 'Clear' }
          }]
        }
      ]
    })

    expect(response).toMatchObject({ isError: true, structuredContent: { code: 'INVALID_WORKFLOW' } })
    expect(callTool).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('preserves paused batch checkpoints for later resume', async () => {
    const service = workflowRuntime.createWorkflowService({
      callTool: withAxConfig(async () => {
        throw new Error('No native tool calls expected.')
      })
    })
    const response = await service.call('execute_workflows', {
      workflows: [{ steps: [{ kind: 'agent_decision', node_id: 'review', op: 'checkpoint' }] }]
    })

    expect(response.structuredContent).toMatchObject({
      outcome: 'paused',
      runs: [{ checkpoint_id: expect.stringMatching(/^checkpoint_/), outcome: 'paused', status: 'paused' }]
    })
  })

  it('never evicts paused runs that still need to resume', async () => {
    const service = workflowRuntime.createWorkflowService({
      callTool: withAxConfig(async () => {
        throw new Error('No native tool calls expected.')
      })
    })
    const paused = []
    for (let index = 0; index < 51; index += 1) {
      paused.push(
        await service.call('execute_workflow', {
          steps: [{ node_id: `pause-${index}`, op: 'checkpoint' }]
        })
      )
    }

    const first = paused[0].structuredContent
    const resumed = await service.call('resume_workflow', {
      checkpoint_id: first.checkpoint_id,
      decision: 'continue',
      run_id: first.run_id
    })
    expect(resumed.isError).not.toBe(true)
    expect(resumed.structuredContent).toMatchObject({ outcome: 'succeeded', status: 'completed' })
  })
})
