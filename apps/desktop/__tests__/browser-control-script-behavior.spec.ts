/* eslint-disable no-new-func -- execute generated page scripts against isolated DOM fakes. */
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { createBrowserControlOperations } from '../src/main/browser-control-operations'
import { createElementActionScript, createScrollScript } from '../src/main/browser-control-scripts'

class FakeNode {
  dataset: Record<string, string> = {}
  id = ''
  innerHTML = ''
  removed = false
  shadowRoot: FakeNode | null = null
  style: Record<string, string> = {}
  readonly children: FakeNode[] = []
  readonly animations: Array<{ duration: number }> = []

  animate(_frames: unknown, options: { duration: number }) {
    this.animations.push(options)
    return { finished: Promise.resolve() }
  }

  appendChild(child: FakeNode) {
    this.children.push(child)
    return child
  }

  attachShadow() {
    this.shadowRoot = new FakeNode()
    return this.shadowRoot
  }

  focus() {}

  querySelector(selector: string) {
    if (selector === 'svg') return new FakeNode()
    return this.children.find(child => child.dataset.cursorGraphic != null) ?? null
  }

  remove() {
    this.removed = true
  }

  setAttribute(name: string) {
    if (name === 'data-oneworks-browser-driver-cursor-graphic') this.dataset.cursorGraphic = ''
  }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('browser control page scripts', () => {
  it('moves the cursor, anchors click feedback, and removes the ripple host', async () => {
    const created: FakeNode[] = []
    const root = new FakeNode()
    const target = new FakeNode() as FakeNode & {
      click: ReturnType<typeof vi.fn>
      getBoundingClientRect: () => { height: number; left: number; top: number; width: number }
      scrollIntoView: ReturnType<typeof vi.fn>
    }
    target.click = vi.fn()
    target.getBoundingClientRect = () => ({ height: 20, left: 190, top: 90, width: 40 })
    target.scrollIntoView = vi.fn()
    const document = {
      createElement: vi.fn(() => {
        const node = new FakeNode()
        created.push(node)
        return node
      }),
      documentElement: root,
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => target)
    }
    const window = { innerHeight: 600, innerWidth: 800 }
    const script = createElementActionScript(
      'click',
      's1e1',
      undefined,
      { color: '#D946EF', svg: '<svg></svg>' }
    )
    const run = new Function('document', 'window', `return (${script})`)

    await expect(run(document, window)).resolves.toEqual({ ok: true })
    await flushPromises()

    const cursorHost = root.children.find(child => child.id === '__oneworks_browser_driver_cursor')
    const rippleHost = created.find(node => node.style.position === 'fixed' && node.id === '')
    expect(cursorHost).toMatchObject({ dataset: { x: '210', y: '100' }, style: { opacity: '1' } })
    expect(cursorHost?.animations).toEqual([
      expect.objectContaining({ duration: 467, easing: 'cubic-bezier(.25,.1,.25,1)' })
    ])
    expect(target.click).toHaveBeenCalledOnce()
    expect(rippleHost).toMatchObject({ removed: true, style: { left: '188px', top: '78px' } })
    expect(rippleHost?.shadowRoot?.children[0]?.animations).toEqual([
      expect.objectContaining({ duration: 680 })
    ])
  })

  it('finishes smooth scrolling at the clamped target', async () => {
    let now = 0
    const window = {
      innerHeight: 600,
      innerWidth: 800,
      scrollX: 10,
      scrollY: 20,
      scrollTo: vi.fn(({ left, top }: { left: number; top: number }) => {
        window.scrollX = left
        window.scrollY = top
      })
    }
    const document = { documentElement: { scrollHeight: 1_400, scrollWidth: 1_200 } }
    const requestAnimationFrame = (callback: (timestamp: number) => void) => {
      now += 100
      callback(now)
      return now
    }
    const performance = { now: () => 0 }
    const script = createScrollScript(600, 1_000)
    const run = new Function(
      'document',
      'performance',
      'requestAnimationFrame',
      'window',
      `return (${script})`
    )

    await expect(run(document, performance, requestAnimationFrame, window)).resolves.toEqual({
      ok: true,
      x: 400,
      y: 800
    })
    expect(window.scrollTo).toHaveBeenCalledTimes(10)
    expect(window.scrollTo).toHaveBeenLastCalledWith({ behavior: 'instant', left: 400, top: 800 })
  })

  it('applies a short server-side settle after element actions', async () => {
    const delays: number[] = []
    let now = 0
    const webContents = Object.assign(new EventEmitter(), {
      id: 7,
      executeJavaScript: vi.fn()
        .mockResolvedValueOnce({ elements: [], snapshot_id: 's1' })
        .mockResolvedValue({ ok: true }),
      getTitle: vi.fn(() => 'Test page'),
      getURL: vi.fn(() => 'https://example.com/')
    })
    const page = {
      hostWebContentsId: 90,
      id: 'page_7',
      panelPageId: 'panel-a',
      registered_at: new Date(0).toISOString(),
      session_id: 'session-a',
      title: 'Test page',
      url: 'https://example.com/',
      webContents
    }
    const operations = createBrowserControlOperations({
      delay: async ms => {
        delays.push(ms)
        now += ms
      },
      getWorkspaceHostWebContents: () => [{ id: 90, isDestroyed: () => false } as never],
      now: () => now,
      pages: { resolvePage: vi.fn(() => page) } as never,
      sendPageCommand: vi.fn(async () => ({ applied: true }))
    })
    await operations.execute('/workspace', {
      op: 'snapshot',
      page_id: 'page_7',
      session_id: 'session-a'
    })

    await operations.execute('/workspace', {
      op: 'click',
      page_id: 'page_7',
      ref: 's1e1',
      session_id: 'session-a'
    })
    await operations.execute('/workspace', {
      op: 'type',
      page_id: 'page_7',
      ref: 's1e1',
      session_id: 'session-a',
      text: 'hello'
    })

    expect(delays).toEqual([280, 200, 40])
    await operations.dispose()
  })
})
