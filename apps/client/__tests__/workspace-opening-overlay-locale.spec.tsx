// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceOpeningOverlay } from '#~/components/workspace/WorkspaceOpeningOverlay'
import i18n from '#~/i18n'

vi.mock('@oneworks/icon/loader', () => ({
  mountOneWorksIconLoader: () => ({ dispose: vi.fn(), update: vi.fn() })
}))

function OverlayHarness() {
  const { t } = useTranslation()
  return <WorkspaceOpeningOverlay appearance='light' title={t('desktopStartupOverlay.title')} />
}

let container: HTMLDivElement
let root: Root

describe('workspace opening overlay locale lifecycle', () => {
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    await i18n.changeLanguage('zh')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'oneworksDesktop')
    await i18n.changeLanguage('en')
    vi.useRealTimers()
  })

  it('keeps one locale-aware live message stable while visual tips rotate', async () => {
    await act(async () => root.render(<OverlayHarness />))
    const overlay = document.querySelector<HTMLElement>('.workspace-opening-overlay')
    const liveRegion = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
    const visualTip = document.querySelector<HTMLElement>('.workspace-opening-overlay__tip')
    expect(overlay?.hasAttribute('aria-busy')).toBe(false)
    expect(liveRegion?.hasAttribute('aria-busy')).toBe(false)
    expect(liveRegion?.getAttribute('aria-atomic')).toBe('true')
    expect(visualTip?.getAttribute('aria-hidden')).toBe('true')
    expect(liveRegion?.textContent).toContain('项目正在就位')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(document.querySelector('[role="status"]')).toBe(liveRegion)
    expect(liveRegion?.textContent).toContain('Setting up your project')
    expect(liveRegion?.textContent).not.toContain('正在把项目上下文铺好。')
    expect(liveRegion?.textContent).not.toContain('项目正在就位')

    const liveMessage = liveRegion?.textContent
    const firstVisualTip = visualTip?.textContent
    await act(async () => {
      vi.advanceTimersByTime(3200)
    })
    expect(visualTip?.textContent).not.toBe(firstVisualTip)
    expect(liveRegion?.textContent).toBe(liveMessage)
  })

  it('reports the real loading surface after the preload overlay exits without exposing fake input', async () => {
    let finishReveal: (() => void) | undefined
    const revealWorkspaceStartupSurface = vi.fn(() =>
      new Promise<void>((resolve) => {
        finishReveal = resolve
      })
    )
    const markDesktopUiReady = vi.fn(async () => undefined)
    window.oneworksDesktop = { markDesktopUiReady, revealWorkspaceStartupSurface }

    await act(async () => root.render(<OverlayHarness />))

    expect(revealWorkspaceStartupSurface).toHaveBeenCalledOnce()
    expect(markDesktopUiReady).not.toHaveBeenCalled()
    expect(document.querySelector('.workspace-opening-overlay input')).toBeNull()
    expect(document.querySelector('.workspace-opening-overlay textarea')).toBeNull()
    expect(document.querySelector('.workspace-opening-overlay button')).toBeNull()

    await act(async () => finishReveal?.())

    expect(markDesktopUiReady).toHaveBeenCalledOnce()
  })
})
