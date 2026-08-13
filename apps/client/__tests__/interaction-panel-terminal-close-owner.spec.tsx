// @vitest-environment happy-dom
import {
  capturePanelTabCloseFocus,
  focusPanelTabCloseTargetAfterReact
} from '#~/components/chat/interaction-panel/@components/terminal-tab-close/panel-tab-close-focus'
import { useTerminalTabCloseCoordinator } from '#~/components/chat/interaction-panel/@components/terminal-tab-close/use-terminal-tab-close-coordinator'
import { getTabsForCloseScope } from '#~/components/chat/interaction-panel/interaction-panel-tab-groups'
import {
  getPanelStateActiveTerminalId,
  getPanelStateTerminalPanes,
  isActiveTab
} from '#~/components/chat/interaction-panel/interaction-panel-tabs'
import { useInteractionPanelTabs } from '#~/components/chat/interaction-panel/use-interaction-panel-tabs'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import type { SessionPanelState, SessionPanelTab } from '@oneworks/core'
import { act, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('#~/plugins/plugin-slots', () => ({ usePluginSlot: () => [] }))
const modalLifecycle = vi.hoisted(() => ({
  holdAfterHidden: false,
  releaseAfterHidden: null as (() => void) | null
}))
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    Modal: (props: any) => (
      <actual.Modal
        {...props}
        afterOpenChange={(isOpen) => {
          if (!isOpen && modalLifecycle.holdAfterHidden) {
            modalLifecycle.releaseAfterHidden = () => props.afterOpenChange?.(false)
            return
          }
          props.afterOpenChange?.(isOpen)
        }}
        maskTransitionName=''
        transitionName=''
      />
    )
  }
})
const t =
  ((key: string, options?: { count?: number }) => options?.count == null ? key : `${key}:${options.count}`) as any
const bottomPanel = {
  handleCloseWorkspaceFileTabs: vi.fn(),
  handleOpenWorkspaceFile: vi.fn(),
  handleSelectBottomPanelView: vi.fn(),
  handleSelectWorkspaceFile: vi.fn()
} as any
interface OwnerHarnessValue {
  panelTabs: ReturnType<typeof useInteractionPanelTabs>
  replaceTabs: (tabs: SessionPanelTab[], activeTabId?: string) => void
  requestClose: (tabIds: string[]) => boolean
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
}
const messageApi = { destroy: vi.fn(), error: vi.fn() }
function OwnerHarness({
  initialRightTabs,
  initialTabs,
  onValue,
  ownerId
}: {
  initialRightTabs: SessionPanelTab[]
  initialTabs: SessionPanelTab[]
  onValue: (value: OwnerHarnessValue) => void
  ownerId: string
}) {
  const [panelState, setPanelState] = useState<SessionPanelState>({
    bottom: { activeTabId: initialTabs[0]?.id, tabs: initialTabs },
    right: { activeTabId: initialRightTabs[0]?.id, tabs: initialRightTabs }
  })
  const updateArea = useCallback((area: 'bottom' | 'right', updater: any) => {
    setPanelState(current => ({ ...current, [area]: updater(current[area]) }))
  }, [])
  const panelStateController = useMemo(() => ({ panelState, setPanelState, updateArea }), [panelState, updateArea])
  const terminalPanes = useInteractionTerminalPanes(ownerId, t, {
    activeTerminalId: getPanelStateActiveTerminalId(panelState),
    initialPanes: getPanelStateTerminalPanes(panelState)
  })
  const panelTabs = useInteractionPanelTabs({
    bottomPanel,
    canCreateSessionTab: false,
    language: 'en',
    panelStateController,
    terminalPanes,
    terminalSessionId: ownerId,
    t
  })
  const ownerRef = useRef<HTMLDivElement | null>(null)
  const coordinator = useTerminalTabCloseCoordinator({
    executeCloseRequest: panelTabs.executeCloseRequest,
    getOwnerRoot: () => ownerRef.current,
    isCloseRequestInvalidated: panelTabs.isCloseRequestInvalidated,
    message: messageApi,
    ownerGeneration: terminalPanes.generation,
    ownerId,
    resolveCloseRequest: request =>
      panelTabs.tabs.filter(tab => request.targets.some(target => target.tabId === tab.id)),
    t,
    terminalPanes
  })
  onValue({
    panelTabs,
    replaceTabs: (tabs, activeTabId) =>
      setPanelState(current => ({
        ...current,
        bottom: { tabs, ...(activeTabId == null ? {} : { activeTabId }) }
      })),
    requestClose: tabIds =>
      coordinator.requestClose(panelTabs.createCloseRequest(
        panelTabs.tabs.filter(tab => tabIds.includes(tab.id)),
        tabIds[0]
      )),
    terminalPanes
  })
  const activeTabId = panelTabs.activeTab == null
    ? undefined
    : panelTabs.tabs.find(tab => isActiveTab(tab, panelTabs.activeTab!))?.id
  return (
    <div ref={ownerRef} data-focus-owner={`${ownerId}:${terminalPanes.generation}`}>
      {panelTabs.tabs.map(tab => (
        <div key={tab.id} data-route-container-panel-dock-tab-key={tab.id}>
          <button type='button' role='tab' aria-selected={activeTabId === tab.id}>{tab.label}</button>
          <button type='button' className='route-container-panel-dock-tab__close' aria-label={`Close ${tab.label}`}>
            Close
          </button>
        </div>
      ))}
      <button type='button' className='route-container-panel-dock__create-action'>Add</button>
      {coordinator.feedback}
    </div>
  )
}
const terminalTab = (
  id: string,
  terminalId = id,
  title = id,
  runtime: Record<string, unknown> = {}
): SessionPanelTab => ({
  id,
  kind: 'terminal',
  shellKind: 'default',
  terminalId,
  title,
  ...runtime
} as SessionPanelTab)
const fileTab = (id: string): SessionPanelTab => ({ id, kind: 'file', path: `${id}.ts`, title: id })
const webTab = (id: string): SessionPanelTab => ({ id, kind: 'web', title: id, url: 'https://example.com' })
let container: HTMLDivElement
let root: Root
let value: OwnerHarnessValue
const currentTarget = (id: string) => ({ generation: value.terminalPanes.getTerminalGeneration(id)!, terminalId: id })
let nextAnimationFrameId = 0
let animationFrames = new Map<number, FrameRequestCallback>()
const flushAnimationFrames = async () => {
  while (animationFrames.size > 0) {
    const current = [...animationFrames.values()]
    animationFrames.clear()
    await act(async () => current.forEach(callback => callback(0)))
  }
}
const takeAnimationFrame = () => {
  const [frameId, callback] = animationFrames.entries().next().value!
  animationFrames.delete(frameId)
  return callback
}
const findConfirmButton = (count = 1) =>
  Array.from(document.querySelectorAll('button')).find(button =>
    button.textContent === `chat.interactionPanel.terminalCloseConfirmAction:${count}`
  )!
const findButtonByLabel = (label: string) =>
  Array.from(container.getElementsByTagName('button')).find(button => button.getAttribute('aria-label') === label)!
const renderOwner = async (props: {
  initialRightTabs?: SessionPanelTab[]
  initialTabs: SessionPanelTab[]
  ownerId?: string
}) => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <OwnerHarness
          initialRightTabs={props.initialRightTabs ?? []}
          initialTabs={props.initialTabs}
          ownerId={props.ownerId ?? 'terminal-session'}
          onValue={next => value = next}
        />
      </MemoryRouter>
    )
  })
}

describe('interaction panel terminal close owner', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.clearAllMocks()
    animationFrames = new Map()
    modalLifecycle.holdAfterHidden = false
    modalLifecycle.releaseAfterHidden = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      nextAnimationFrameId += 1
      animationFrames.set(nextAnimationFrameId, callback)
      return nextAnimationFrameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => animationFrames.delete(id))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })
  it('intersects frozen targets with current state after insertion, reversal, and anchor disappearance', async () => {
    await renderOwner({
      initialTabs: [terminalTab('dock-a', 'term-a'), fileTab('file-a'), webTab('web-a')]
    })
    const request = value.panelTabs.createCloseRequest(value.panelTabs.tabs, 'dock-a')
    await act(async () => value.replaceTabs([webTab('web-a'), fileTab('inserted'), fileTab('file-a')], 'web-a'))
    let result!: ReturnType<typeof value.panelTabs.executeCloseRequest>
    await act(async () => result = value.panelTabs.executeCloseRequest(request))
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['inserted'])
    expect(value.terminalPanes.panes.map(item => item.id)).toEqual([])
    expect(result.failedTabIds).toEqual([])
  })
  it.each([
    { expected: ['inserted'], scope: 'all' as const },
    { expected: ['inserted', 'dock-a', 'file-a'], scope: 'right' as const },
    { expected: ['inserted', 'dock-a'], scope: 'others' as const }
  ])('freezes $scope targets before insertion and reversal', async ({ expected, scope }) => {
    await renderOwner({
      initialTabs: [fileTab('file-a'), terminalTab('dock-a', 'term-a'), fileTab('file-b'), webTab('web-a')]
    })
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => true)
    const anchor = value.panelTabs.tabs.find(tab => tab.id === 'dock-a')!
    const request = value.panelTabs.createCloseRequest(
      getTabsForCloseScope(value.panelTabs.tabs, anchor, scope),
      anchor.id
    )
    await act(async () =>
      value.replaceTabs([
        webTab('web-a'),
        fileTab('inserted'),
        fileTab('file-b'),
        terminalTab('dock-a', 'term-a'),
        fileTab('file-a')
      ], 'dock-a')
    )
    await act(async () => value.panelTabs.executeCloseRequest(request))
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(expected)
  })
  it('preserves failed-survivor capabilities and feedback across a live membership echo', async () => {
    const survivor = () =>
      terminalTab('dock-a', 'term-a', 'term-a', {
        runCommand: { commandId: 'task-a', icon: 'terminal', script: 'echo a', title: 'Task A' }
      })
    await renderOwner({
      initialRightTabs: [terminalTab('drawer-c', 'term-c', 'right-c', { shellKind: 'bash' })],
      initialTabs: [survivor(), fileTab('file-a')]
    })
    const failTerminate = vi.fn(() => false)
    const passTerminate = vi.fn(() => true)
    let acceptRestart = false
    const restart = vi.fn(() => acceptRestart)
    vi.spyOn(window, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), failTerminate)
    value.terminalPanes.handleRestartChange(currentTarget('term-a'), restart)
    expect(value.terminalPanes.restartTerminal('term-a', 'resume')).toBe(false)
    await act(async () => value.terminalPanes.handleInfoChange(currentTarget('term-a'), { isExited: false } as any))
    await act(async () => value.terminalPanes.markInitialCommandSent(currentTarget('term-a')))
    const generation = value.terminalPanes.generation
    await act(async () =>
      value.replaceTabs([
        survivor(),
        fileTab('file-a'),
        terminalTab('dock-b', 'term-b')
      ], 'dock-b')
    )
    value.terminalPanes.handleTerminateChange(currentTarget('term-b'), passTerminate)
    await act(async () => value.requestClose(['dock-a', 'file-a', 'dock-b']))
    await act(async () =>
      value.replaceTabs([
        survivor(),
        webTab('inserted'),
        fileTab('file-a'),
        terminalTab('dock-b', 'term-b')
      ], 'dock-b')
    )
    await act(async () => findConfirmButton(2).click())
    await flushAnimationFrames()
    expect(failTerminate).toHaveBeenCalledTimes(1)
    expect(passTerminate).toHaveBeenCalledTimes(1)
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['dock-a', 'inserted'])
    expect(value.terminalPanes.panes.map(item => item.id)).toEqual(['term-a', 'term-c'])
    expect(value.panelTabs.activeTab).toEqual({ kind: 'terminal', id: 'dock-a' })
    expect(value.terminalPanes.generation).toBe(generation)
    expect(value.terminalPanes.infoById['term-a']?.isExited).toBe(false)
    expect(value.terminalPanes.runTaskRunningById['term-a']).toBe(true)
    const survivorGeneration = value.terminalPanes.getTerminalGeneration('term-a')!
    expect(value.terminalPanes.requiresCloseConfirmation({ generation: survivorGeneration, terminalId: 'term-a' }))
      .toBe(true)
    acceptRestart = true
    expect(value.terminalPanes.restartTerminal('term-a', 'direct')).toBe(true)
    value.terminalPanes.handleRestartChange(currentTarget('term-a'), restart)
    expect(restart).toHaveBeenLastCalledWith('resume', undefined)
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('chat.interactionPanel.terminalCloseFailed:1')
  })
  it('invalidates a frozen request when the same terminal id is recreated in a new generation', async () => {
    await renderOwner({ initialTabs: [terminalTab('dock-a', 'term-a', 'first')] })
    const request = value.panelTabs.createCloseRequest(value.panelTabs.tabs, 'dock-a')
    const terminate = vi.fn(() => true)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), terminate)
    await act(async () =>
      value.replaceTabs([
        terminalTab('dock-a', 'term-a', 'reused', { shellKind: 'bash' })
      ], 'dock-a')
    )
    await act(async () => value.panelTabs.executeCloseRequest(request))
    expect(terminate).not.toHaveBeenCalled()
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['dock-a'])
    expect(value.terminalPanes.panes.map(item => item.title)).toEqual(['reused'])
  })
  it('invalidates an open confirmation when the accepted process replacement advances generation', async () => {
    await renderOwner({ initialTabs: [terminalTab('dock-a', 'term-a')] })
    const target = currentTarget('term-a')
    const terminate = vi.fn(() => true)
    value.terminalPanes.handleTerminateChange(target, terminate)
    await act(async () => value.requestClose(['dock-a']))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => value.terminalPanes.handleProcessRestartAccepted(target))
    await flushAnimationFrames()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(terminate).not.toHaveBeenCalled()
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['dock-a'])
  })
  it('closes an exited terminal without confirmation or another terminate call', async () => {
    const runCommand = { commandId: 'task-a', icon: 'terminal', script: 'echo task', title: 'Task A' }
    await renderOwner({ initialTabs: [terminalTab('dock-a', 'term-a', 'term-a', { runCommand })] })
    const terminate = vi.fn(() => true)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), terminate)
    const terminalGeneration = value.terminalPanes.getTerminalGeneration('term-a')
    await act(async () => value.terminalPanes.handleInfoChange(currentTarget('term-a'), { isExited: true } as any))
    expect(value.terminalPanes.panes[0]).toEqual(expect.objectContaining({ id: 'term-a', runCommand }))
    expect([terminalGeneration, value.terminalPanes.getTerminalGeneration('term-a')])
      .toEqual([expect.any(Number), terminalGeneration])
    await act(async () => value.requestClose(['dock-a']))
    await flushAnimationFrames()
    expect([document.querySelector('[role="dialog"]'), terminate.mock.calls]).toEqual([null, []])
    expect([value.panelTabs.tabs, value.terminalPanes.panes]).toEqual([[], []])
  })
  it('shows one active confirmation, ignores duplicate requests and double confirm, then focuses the survivor', async () => {
    await renderOwner({
      initialTabs: [terminalTab('dock-a', 'term-a'), fileTab('file-a')]
    })
    const terminate = vi.fn(() => true)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), terminate)
    container.querySelector<HTMLElement>('[aria-label="Close term-a"]')?.focus()
    await act(async () => {
      expect(value.requestClose(['dock-a'])).toBe(true)
      expect(value.requestClose(['dock-a'])).toBe(false)
    })
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    const confirm = findConfirmButton()
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    await flushAnimationFrames()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['file-a'])
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close file-a"]'))
  })
  it('keeps a failed terminal selected, rearms identical alert text, and clears it on generation change', async () => {
    await renderOwner({ initialTabs: [terminalTab('dock-a', 'term-a')] })
    const terminate = vi.fn(() => false)
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), terminate)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => value.requestClose(['dock-a']))
      await act(async () => findConfirmButton().click())
      await flushAnimationFrames()
      expect(container.querySelector('[role="alert"]')?.textContent)
        .toBe('chat.interactionPanel.terminalCloseFailed:1')
    }
    expect(messageApi.error).toHaveBeenCalledTimes(2)
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['dock-a'])
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close dock-a"]'))
    messageApi.destroy.mockClear()
    await act(async () => value.requestClose(['dock-a']))
    await act(async () => findConfirmButton().click())
    const staleAnnouncementFrame = takeAnimationFrame()
    await renderOwner({
      initialTabs: [],
      ownerId: 'next-session'
    })
    await act(async () => staleAnnouncementFrame(0))
    await flushAnimationFrames()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('')
    expect(messageApi.destroy).toHaveBeenCalledWith('terminal-session:terminal-close-error')
  })
  it.each([
    { boundary: 'first', change: 'owner' },
    { boundary: 'second', change: 'owner' },
    { boundary: 'first', change: 'generation' },
    { boundary: 'second', change: 'generation' }
  ])('invalidates queued $boundary-frame focus after $change replacement', async ({ boundary, change }) => {
    await renderOwner({ initialTabs: [terminalTab('dock-a', 'term-a')] })
    await act(async () => value.requestClose(['dock-a']))
    let staleFocusFrame = takeAnimationFrame()
    if (boundary === 'second') {
      await act(async () => staleFocusFrame(0))
      staleFocusFrame = takeAnimationFrame()
    }
    const previousOwnerKey = container.querySelector<HTMLElement>('[data-focus-owner]')!.dataset.focusOwner
    if (change === 'generation') {
      await act(async () =>
        value.replaceTabs([terminalTab('dock-a', 'term-a', 'dock-a', { shellKind: 'bash' })], 'dock-a')
      )
    } else {
      await renderOwner({ initialTabs: [], ownerId: 'next-session' })
    }
    const replacementOwner = container.querySelector<HTMLElement>('[data-focus-owner]')!
    const replacementTarget = container.querySelector<HTMLElement>('.route-container-panel-dock__create-action')!
    expect(replacementOwner.dataset.focusOwner).not.toBe(previousOwnerKey)
    await act(async () => staleFocusFrame(0))
    await flushAnimationFrames()
    expect(document.activeElement).not.toBe(replacementTarget)
  })
  it('restores focus to the live selected fallback when Escape cancels after the invoker disappears', async () => {
    await renderOwner({
      initialTabs: [terminalTab('dock-a', 'term-a'), fileTab('file-a')]
    })
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => true)
    container.querySelector<HTMLElement>('[aria-label="Close term-a"]')?.focus()
    await act(async () => value.requestClose(['dock-a']))
    await act(async () => value.replaceTabs([fileTab('file-a')], 'file-a'))
    await act(async () => {
      const escape = new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })
      Object.defineProperty(escape, 'keyCode', { value: 27 })
      document.querySelector<HTMLElement>('.ant-modal-wrap')?.dispatchEvent(escape)
    })
    await flushAnimationFrames()
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['file-a'])
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Close file-a"]'))
  })
  it('focuses a connected fallback after a newline and control-character file label disappears', async () => {
    const unsafeId = 'file\n\u0001name'
    await renderOwner({ initialTabs: [fileTab(unsafeId), fileTab('fallback')] })
    findButtonByLabel(`Close ${unsafeId}`).focus()
    const owner = container.querySelector<HTMLElement>('[data-focus-owner]')!
    const intent = capturePanelTabCloseFocus(owner)
    await act(async () => value.replaceTabs([fileTab('fallback')], 'fallback'))
    focusPanelTabCloseTargetAfterReact({ getRoot: () => owner, intent })
    await flushAnimationFrames()
    const fallback = findButtonByLabel('Close fallback')
    expect(fallback.isConnected && document.activeElement === fallback).toBe(true)
  })
  it.each([
    { expectedFocusCount: 1, replaceOwner: false },
    { expectedFocusCount: 0, replaceOwner: true }
  ])('settles invalidation focus after actual Modal (replace owner $replaceOwner)', async ({
    expectedFocusCount,
    replaceOwner
  }) => {
    modalLifecycle.holdAfterHidden = true
    await renderOwner({
      initialTabs: [terminalTab('dock-a', 'term-a'), fileTab('file-a')]
    })
    value.terminalPanes.handleTerminateChange(currentTarget('term-a'), () => true)
    const close = findButtonByLabel('Close dock-a')
    const focus = vi.spyOn(close, 'focus')
    close.focus()
    focus.mockClear()
    await act(async () => value.requestClose(['dock-a', 'file-a']))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    findConfirmButton().focus()
    await act(async () =>
      value.replaceTabs([
        terminalTab('dock-a', 'term-a'),
        { id: 'file-a', kind: 'file', path: 'replacement.ts', title: 'file-a' }
      ], 'dock-a')
    )
    await flushAnimationFrames()
    expect(focus).not.toHaveBeenCalled()
    expect(value.requestClose(['dock-a'])).toBe(false)
    if (replaceOwner) {
      await renderOwner({ initialTabs: [], ownerId: 'next-session' })
    }
    expect(modalLifecycle.releaseAfterHidden).not.toBeNull()
    await act(async () => modalLifecycle.releaseAfterHidden?.())
    await flushAnimationFrames()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(value.panelTabs.tabs.map(tab => tab.id)).toEqual(['dock-a', 'file-a'])
    expect(focus).toHaveBeenCalledTimes(expectedFocusCount)
    if (!replaceOwner) expect(document.activeElement).toBe(close)
  })
})
