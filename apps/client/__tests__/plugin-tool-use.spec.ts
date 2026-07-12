import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildPluginToolPresentation,
  buildPluginToolResultPresentation,
  readToolUseValue
} from '#~/components/chat/tools/core/plugin-tool-presentation'
import { resolvePluginToolUsePresentation } from '#~/plugins/plugin-tool-use'
import type { RuntimeToolUsePresentation } from '#~/plugins/plugin-tool-use'

const scopedTool = (scopeToken: string, tool: string) => `adapter:codex:mcp:oneworks-${scopeToken}:${tool}`

const browserDriverManifest = JSON.parse(readFileSync(
  new URL('../../../packages/plugins/browser-driver/plugin.json', import.meta.url),
  'utf8'
)) as {
  plugin: { contributions: { toolUsePresentations: RuntimeToolUsePresentation[] } }
}

const readBrowserDriverPresentation = (id: string): RuntimeToolUsePresentation => {
  const contribution = browserDriverManifest.plugin.contributions.toolUsePresentations.find(item => item.id === id)
  if (contribution == null) throw new Error(`Missing Browser Driver tool presentation: ${id}`)
  return { ...contribution, pluginScope: 'browser/browser-driver' }
}

const presentation = (
  overrides: Partial<RuntimeToolUsePresentation> = {}
): RuntimeToolUsePresentation => ({
  id: 'click',
  pluginScope: 'cua/cua-driver',
  title: 'Click',
  tools: ['click'],
  ...overrides
})

describe('plugin tool-use presentation', () => {
  it('matches base tool names only within the contributing plugin scope', () => {
    const contribution = presentation({ pluginScope: 'cua' })

    expect(resolvePluginToolUsePresentation(
      scopedTool('Y3VhL2N1YS1kcml2ZXI', 'click'),
      [contribution]
    )).toBe(contribution)
    expect(resolvePluginToolUsePresentation(
      scopedTool('b3RoZXI', 'click'),
      [contribution]
    )).toBeUndefined()
  })

  it('allows explicit any-origin matches while preferring plugin-scoped matches', () => {
    const anyOrigin = presentation({ id: 'any-click', origin: 'any' })
    const ownOrigin = presentation()

    expect(resolvePluginToolUsePresentation(
      scopedTool('Y3VhL2N1YS1kcml2ZXI', 'click'),
      [anyOrigin, ownOrigin]
    )).toBe(ownOrigin)
    expect(resolvePluginToolUsePresentation('external:click', [anyOrigin])).toBe(anyOrigin)
  })

  it('uses safe dotted paths and rejects prototype traversal', () => {
    expect(readToolUseValue({ target: { index: 4 } }, 'target.index')).toBe(4)
    expect(readToolUseValue({ target: {} }, 'target.__proto__.polluted')).toBeUndefined()
  })

  it('builds declared fields and host-owned title, icon, and target presentation', () => {
    const view = buildPluginToolPresentation(
      'click',
      {
        pid: 42,
        target: { index: 4 },
        ignored: 'not rendered'
      },
      presentation({
        icon: 'touch_app',
        target: 'target.index',
        input: {
          mode: 'declared',
          fields: [{ path: 'pid', title: 'Process', format: 'inline' }]
        }
      })
    )

    expect(view).toMatchObject({
      fallbackTitle: 'Click',
      icon: 'touch_app',
      primary: '4',
      blockFields: [],
      inlineFields: [{ fallbackLabel: 'Process', format: 'inline', value: 42 }]
    })
  })

  it('does not inherit built-in title or success-result semantics for matching plugin tools', () => {
    const view = buildPluginToolPresentation(
      'read',
      { path: '/tmp/a' },
      presentation({
        title: 'Inspect app',
        tools: ['read']
      })
    )

    expect(view.titleKey).toBeUndefined()
    expect(view.fallbackTitle).toBe('Inspect app')
    expect(view.suppressSuccessResult).toBeUndefined()
  })

  it('builds compact record collections and declared result fields', () => {
    const contribution = presentation({
      input: {
        mode: 'declared',
        fields: [{
          path: 'steps',
          title: 'Steps',
          format: 'records',
          item: {
            titlePath: 'node_id',
            subtitlePath: 'op',
            metaPath: 'context'
          }
        }]
      },
      result: {
        mode: 'declared',
        fields: [
          { path: 'structuredContent.status', title: 'Status', format: 'inline' },
          { path: 'structuredContent.steps.ids', title: 'Step IDs', format: 'chips' },
          {
            path: 'structuredContent.items',
            title: 'Results',
            format: 'records',
            item: {
              titlePath: 'node_id',
              subtitlePath: 'step_id',
              statusPath: 'status',
              detailPath: 'output'
            }
          }
        ]
      }
    })

    const inputView = buildPluginToolPresentation('execute_workflow', {
      steps: [{ context: 'calculator', node_id: 'clear', op: 'click' }]
    }, contribution)
    expect(inputView.blockFields[0]).toMatchObject({
      fallbackLabel: 'Steps',
      format: 'records',
      records: [{ meta: 'calculator', subtitle: 'click', title: 'clear' }]
    })

    const resultView = buildPluginToolResultPresentation({
      structuredContent: {
        status: 'completed',
        steps: { ids: ['step_1'] },
        items: [{
          node_id: 'verify',
          output: { matched: true },
          status: 'completed',
          step_id: 'step_1'
        }]
      }
    }, contribution)
    expect(resultView).toMatchObject({
      mode: 'declared',
      inlineFields: [{ fallbackLabel: 'Status', value: 'completed' }],
      blockFields: [
        { fallbackLabel: 'Step IDs', format: 'chips', value: ['step_1'] },
        {
          fallbackLabel: 'Results',
          format: 'records',
          records: [{
            detail: { matched: true },
            status: 'completed',
            subtitle: 'step_1',
            title: 'verify'
          }]
        }
      ]
    })
  })

  it('renders Browser Driver workflow outputs from the actual plugin manifest without object coercion', () => {
    const workflow = buildPluginToolResultPresentation({
      structuredContent: {
        outcome: 'succeeded',
        run_id: 'run_1',
        status: 'completed',
        steps: {
          ids: ['step_1'],
          results: [{
            node_id: 'verify',
            output: { matched: true, value: 42 },
            status: 'completed',
            step_id: 'step_1'
          }],
          total: 1
        }
      }
    }, readBrowserDriverPresentation('in-app-browser-workflow'))
    const workflowSteps = workflow.blockFields.find(field => field.fallbackLabel === 'Step results')
    expect(workflowSteps?.records).toEqual([{
      detail: { matched: true, value: 42 },
      meta: 'step_1',
      status: undefined,
      subtitle: 'completed',
      title: 'verify'
    }])

    const stepResults = buildPluginToolResultPresentation({
      structuredContent: {
        steps: [{
          node_id: 'verify',
          output: { matched: true, value: 42 },
          status: 'completed',
          step_id: 'step_1'
        }]
      }
    }, readBrowserDriverPresentation('in-app-browser-step-results'))
    expect(stepResults.blockFields[0]?.records?.[0]).toMatchObject({
      detail: { matched: true, value: 42 },
      meta: 'step_1',
      subtitle: 'completed',
      title: 'verify'
    })
    expect(JSON.stringify({ stepResults, workflow })).not.toContain('[object Object]')
  })

  it('skips malformed runtime contributions instead of throwing during matching', () => {
    const malformed = {
      id: 'broken',
      pluginScope: 'cua',
      title: 'Broken',
      tools: null
    } as unknown as RuntimeToolUsePresentation

    expect(resolvePluginToolUsePresentation('click', [malformed])).toBeUndefined()
    expect(readToolUseValue({}, null as unknown as string)).toBeUndefined()
  })
})
