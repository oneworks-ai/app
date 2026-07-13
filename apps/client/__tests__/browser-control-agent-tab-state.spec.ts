import { describe, expect, it } from 'vitest'

import {
  applyBrowserControlAgentTabState,
  getBrowserControlAgentCursorDataUrl,
  pruneBrowserControlAgentTabStates,
  resolveBrowserControlAgentCommandOwner,
  resolveBrowserControlTabIcon,
  updateBrowserControlAgentSafetyTimer
} from '#~/components/chat/interaction-panel/browser-control-agent-tab-state'
import type { BrowserControlAgentTabStates } from '#~/components/chat/interaction-panel/browser-control-agent-tab-state'

const request = (
  pageId: string,
  panelPageId: string,
  state: Parameters<typeof applyBrowserControlAgentTabState>[1]['command'] & {
    type: 'set_agent_action_state'
  }
) => ({
  command: state,
  pageId,
  panelPageId,
  requestId: `request-${pageId}-${panelPageId}`
})

describe('browser control Agent tab favicon state', () => {
  it('binds state to page and panel identity and ignores stale settle/restore commands', () => {
    let states: BrowserControlAgentTabStates = {}
    const first = request('page_1', 'panel-a', {
      type: 'set_agent_action_state',
      state: { action: 'click', color: '#625BF6', operation_id: 'operation-a', phase: 'moving' }
    })
    states = applyBrowserControlAgentTabState(states, first).states
    const second = request('page_1', 'panel-a', {
      type: 'set_agent_action_state',
      state: { action: 'type', color: '#625BF6', operation_id: 'operation-b', phase: 'moving' }
    })
    states = applyBrowserControlAgentTabState(states, second).states

    const staleSettle = applyBrowserControlAgentTabState(
      states,
      request('page_1', 'panel-a', {
        type: 'set_agent_action_state',
        state: {
          action: 'click',
          color: '#625BF6',
          operation_id: 'operation-a',
          outcome: 'succeeded',
          phase: 'settle'
        }
      })
    )
    expect(staleSettle.applied).toBe(false)
    expect(staleSettle.states['panel-a']?.operation_id).toBe('operation-b')

    const staleRestore = applyBrowserControlAgentTabState(
      staleSettle.states,
      request('page_0', 'panel-a', {
        type: 'set_agent_action_state',
        state: { operation_id: 'operation-b', phase: 'idle' }
      })
    )
    expect(staleRestore.applied).toBe(false)
    expect(staleRestore.states['panel-a']).toBeDefined()

    const restored = applyBrowserControlAgentTabState(
      staleRestore.states,
      request('page_1', 'panel-a', {
        type: 'set_agent_action_state',
        state: { operation_id: 'operation-b', phase: 'idle' }
      })
    )
    expect(restored.applied).toBe(true)
    expect(restored.states).toEqual({})
  })

  it('keeps each concurrent tab isolated', () => {
    let states: BrowserControlAgentTabStates = {}
    for (
      const [pageId, panelPageId, operationId] of [
        ['page_1', 'panel-a', 'operation-a'],
        ['page_2', 'panel-b', 'operation-b']
      ]
    ) {
      states = applyBrowserControlAgentTabState(
        states,
        request(pageId, panelPageId, {
          type: 'set_agent_action_state',
          state: { action: 'scroll', color: '#0EA5E9', operation_id: operationId, phase: 'acting' }
        })
      ).states
    }
    states = applyBrowserControlAgentTabState(
      states,
      request('page_1', 'panel-a', {
        type: 'set_agent_action_state',
        state: { operation_id: 'operation-a', phase: 'idle' }
      })
    ).states

    expect(states['panel-a']).toBeUndefined()
    expect(states['panel-b']).toMatchObject({ browserPageId: 'page_2', operation_id: 'operation-b' })
    expect(pruneBrowserControlAgentTabStates(states, new Set())).toEqual({})
  })

  it('temporarily overrides the icon slot and restores the latest untouched site favicon', () => {
    const movingStates = applyBrowserControlAgentTabState(
      {},
      request('page_1', 'panel-a', {
        type: 'set_agent_action_state',
        state: { action: 'click', color: '#625BF6', operation_id: 'operation-a', phase: 'moving' }
      })
    ).states
    const moving = movingStates['panel-a']
    expect(resolveBrowserControlTabIcon({
      agentState: moving,
      faviconUrl: 'https://site.test/original.ico',
      hasCustomIcon: false
    })).toMatchObject({ kind: 'agent' })

    const restoredStates = applyBrowserControlAgentTabState(
      movingStates,
      request('page_1', 'panel-a', {
        type: 'set_agent_action_state',
        state: { operation_id: 'operation-a', phase: 'idle' }
      })
    ).states
    expect(resolveBrowserControlTabIcon({
      agentState: restoredStates['panel-a'],
      faviconUrl: 'https://site.test/dynamic-latest.ico',
      hasCustomIcon: false
    })).toEqual({ kind: 'favicon', url: 'https://site.test/dynamic-latest.ico' })
    expect(resolveBrowserControlTabIcon({ hasCustomIcon: false })).toEqual({ kind: 'symbol' })
    expect(getBrowserControlAgentCursorDataUrl('#625BF6')).toContain('data:image/svg+xml,')
  })

  it('does not let a stale lease clear or replace the successor safety timer', () => {
    const callbacks = new Map<number, () => void>()
    const cleared: number[] = []
    const expired: string[] = []
    let nextTimer = 0
    const timers = new Map()
    const setTimer = (callback: () => void) => {
      const timer = ++nextTimer
      callbacks.set(timer, callback)
      return timer
    }
    const successor = request('page_1', 'panel-a', {
      type: 'set_agent_action_state',
      state: { action: 'type', color: '#625BF6', operation_id: 'operation-new', phase: 'moving' }
    })
    expect(updateBrowserControlAgentSafetyTimer({
      applied: true,
      clearTimer: timer => cleared.push(timer),
      onExpire: entry => expired.push(entry.operationId),
      request: successor,
      setTimer,
      timeoutMs: 8_000,
      timers
    })).toBe(true)

    const staleIdle = request('page_1', 'panel-a', {
      type: 'set_agent_action_state',
      state: { operation_id: 'operation-old', phase: 'idle' }
    })
    expect(updateBrowserControlAgentSafetyTimer({
      applied: false,
      clearTimer: timer => cleared.push(timer),
      onExpire: entry => expired.push(entry.operationId),
      request: staleIdle,
      setTimer,
      timeoutMs: 8_000,
      timers
    })).toBe(false)
    expect(cleared).toEqual([])
    expect(timers.get('panel-a')).toMatchObject({ operationId: 'operation-new', timer: 1 })

    const next = request('page_1', 'panel-a', {
      type: 'set_agent_action_state',
      state: { action: 'scroll', color: '#625BF6', operation_id: 'operation-latest', phase: 'acting' }
    })
    updateBrowserControlAgentSafetyTimer({
      applied: true,
      clearTimer: timer => cleared.push(timer),
      onExpire: entry => expired.push(entry.operationId),
      request: next,
      setTimer,
      timeoutMs: 8_000,
      timers
    })
    callbacks.get(1)?.()
    expect(expired).toEqual([])
    callbacks.get(2)?.()
    expect(expired).toEqual(['operation-latest'])
    expect(cleared).toEqual([1])
  })

  it('ignores commands owned by another dock before evaluating session mismatch', () => {
    const command = request('page_1', 'panel-right', {
      type: 'set_agent_action_state',
      state: { action: 'click', color: '#625BF6', operation_id: 'operation-a', phase: 'moving' }
    })
    expect(resolveBrowserControlAgentCommandOwner({
      pageIds: new Set(['panel-bottom']),
      request: { ...command, sessionId: 'other-session' },
      sessionId: 'current-session'
    })).toBe('ignore')
    expect(resolveBrowserControlAgentCommandOwner({
      pageIds: new Set(['panel-right']),
      request: { ...command, sessionId: 'other-session' },
      sessionId: 'current-session'
    })).toBe('session-mismatch')
  })
})
