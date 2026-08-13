// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  capturePanelTabCloseFocus,
  focusPanelTabCloseTargetAfterReact
} from '#~/components/chat/interaction-panel/@components/terminal-tab-close/panel-tab-close-focus'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import type {
  InteractionTerminalPanesController
} from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import type { TerminalPaneConfig } from '#~/components/chat/terminal/@utils/terminal-panes'

const t = ((key: string) => key) as any

function Harness({
  onController,
  panes
}: {
  onController: (controller: InteractionTerminalPanesController) => void
  panes: TerminalPaneConfig[]
}) {
  const controller = useInteractionTerminalPanes('session-a', t, { initialPanes: panes })
  onController(controller)
  return null
}

const pane = (shellKind: TerminalPaneConfig['shellKind'] = 'default'): TerminalPaneConfig => ({
  id: 'term-a',
  shellKind,
  title: 'Terminal A'
})

describe('interaction terminal lifecycle generation contract', () => {
  let container: HTMLDivElement
  let controller: InteractionTerminalPanesController
  let root: Root
  const render = async (panes: TerminalPaneConfig[]) => {
    await act(async () => root.render(<Harness panes={panes} onController={next => controller = next} />))
  }
  const target = () => ({
    generation: controller.getTerminalGeneration('term-a')!,
    terminalId: 'term-a'
  })

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps the replacement capability and info when stale same-id cleanup arrives', async () => {
    await render([pane()])
    const staleTarget = target()
    const staleTerminate = vi.fn(() => false)
    const disposeStaleTerminate = controller.handleTerminateChange(staleTarget, staleTerminate)
    const disposeStaleRestart = controller.handleRestartChange(staleTarget, () => true)
    await render([pane('bash')])
    const replacementTarget = target()
    const replacementTerminate = vi.fn(() => true)
    controller.handleTerminateChange(replacementTarget, replacementTerminate)
    controller.handleRestartChange(replacementTarget, () => true)
    await act(async () => controller.handleInfoChange(replacementTarget, { isExited: false } as any))
    disposeStaleRestart()
    disposeStaleTerminate()
    await act(async () => controller.handleInfoChange(staleTarget, { isExited: true } as any))
    expect(controller.infoById['term-a']?.isExited).toBe(false)
    expect(controller.closeTerminalTargets([replacementTarget]).closedTerminalIds).toEqual(['term-a'])
    expect([replacementTerminate.mock.calls.length, staleTerminate.mock.calls.length]).toEqual([1, 0])
  })

  it('invalidates the frozen target on accepted restart and changed ready pid', async () => {
    await render([pane()])
    const initialTarget = target()
    const terminate = vi.fn(() => true)
    controller.handleTerminateChange(initialTarget, terminate)
    controller.handleProcessReady(initialTarget, 100)
    await act(async () => controller.handleProcessRestartAccepted(initialTarget))
    const restartTarget = target()
    expect(controller.requiresCloseConfirmation(initialTarget)).toBe(false)
    expect(controller.closeTerminalTargets([initialTarget]).ignoredTerminalIds).toEqual(['term-a'])
    controller.handleProcessReady(initialTarget, 101)
    controller.handleProcessReady(restartTarget, 102)
    const changedPidTarget = target()
    expect(changedPidTarget.generation).toBeGreaterThan(restartTarget.generation)
    expect(controller.requiresCloseConfirmation(restartTarget)).toBe(false)
    expect(controller.closeTerminalTargets([changedPidTarget]).closedTerminalIds).toEqual(['term-a'])
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('skips a hidden closing owner and focuses the exact visible external toggle', () => {
    const family = document.createElement('div')
    family.className = 'route-container-layout'
    const owner = document.createElement('div')
    const local = document.createElement('button')
    const external = document.createElement('button')
    external.setAttribute('aria-label', 'Toggle bottom panel')
    local.className = 'route-container-panel-dock__create-action'
    owner.append(local)
    family.append(owner, external)
    document.body.append(family)
    const intent = capturePanelTabCloseFocus(owner, 'Toggle bottom panel')
    owner.style.opacity = '0'
    owner.style.pointerEvents = 'none'
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    focusPanelTabCloseTargetAfterReact({ getRoot: () => owner, intent })
    expect(document.activeElement).toBe(external)
    family.remove()
  })
})
