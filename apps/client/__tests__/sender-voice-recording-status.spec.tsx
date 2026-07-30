import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SenderVoiceControl } from '#~/components/chat/sender/@components/sender-toolbar/SenderVoiceControl'
import { SenderVoiceRecordingBar } from '#~/components/chat/sender/@components/sender-toolbar/SenderVoiceRecordingBar'
import type {
  SenderVoiceInputController,
  SenderVoiceInputPhase
} from '#~/components/chat/sender/@types/sender-voice-input'

vi.mock('antd', () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.PropsWithChildren<{ icon?: React.ReactNode } & Record<string, unknown>>) => (
    <button {...props}>{icon}{children}</button>
  ),
  Dropdown: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Tooltip: ({
    children,
    title
  }: React.PropsWithChildren<{ title?: React.ReactNode }>) => (
    <div data-tooltip={typeof title === 'string' ? title : undefined}>{children}</div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const createController = (
  phase: SenderVoiceInputPhase,
  overrides: Partial<SenderVoiceInputController['state']> = {}
): SenderVoiceInputController => ({
  handlers: {
    cancelRecording: vi.fn(),
    cancelTranscription: vi.fn(),
    dismissNotice: vi.fn(),
    openConfig: vi.fn(),
    retryTranscription: vi.fn(),
    selectService: vi.fn(),
    setDefaultService: vi.fn(),
    setWaveformCapacity: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn()
  },
  state: {
    canRetry: false,
    canSendAfterTranscription: true,
    canStartRecording: true,
    elapsedSeconds: 0,
    enabled: true,
    errorCanOpenConfig: false,
    loadingServices: false,
    phase,
    services: [],
    setupOpen: false,
    unsupported: false,
    waveformLevels: [.2, .4],
    ...overrides
  }
})

class TestDomNode {
  readonly childNodes: TestDomNode[] = []
  parentNode: TestDomNode | null = null

  constructor(
    readonly nodeType: number,
    readonly ownerDocument: TestDomDocument | null
  ) {}

  get firstChild(): TestDomNode | null {
    return this.childNodes[0] ?? null
  }

  get lastChild(): TestDomNode | null {
    return this.childNodes.at(-1) ?? null
  }

  get textContent(): string {
    return this.childNodes.map(child => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes.splice(0)
    if (value !== '' && this.ownerDocument != null) {
      this.appendChild(this.ownerDocument.createTextNode(value))
    }
  }

  addEventListener() {}

  appendChild<T extends TestDomNode>(child: T): T {
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore<T extends TestDomNode>(child: T, before: TestDomNode | null): T {
    child.parentNode = this
    const index = before == null ? -1 : this.childNodes.indexOf(before)
    if (index < 0) {
      this.childNodes.push(child)
    } else {
      this.childNodes.splice(index, 0, child)
    }
    return child
  }

  removeChild<T extends TestDomNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) {
      this.childNodes.splice(index, 1)
    }
    child.parentNode = null
    return child
  }

  removeEventListener() {}
}

class TestDomText extends TestDomNode {
  constructor(
    readonly ownerDocument: TestDomDocument,
    public nodeValue: string
  ) {
    super(3, ownerDocument)
  }

  override get textContent() {
    return this.nodeValue
  }

  override set textContent(value: string) {
    this.nodeValue = value
  }
}

class TestDomElement extends TestDomNode {
  readonly attributes = new Map<string, string>()
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  readonly nodeName: string
  readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void }
  readonly tagName: string

  constructor(ownerDocument: TestDomDocument, tagName: string) {
    super(1, ownerDocument)
    this.nodeName = tagName.toUpperCase()
    this.tagName = this.nodeName
    const style = {} as TestDomElement['style']
    style.setProperty = (name, value) => {
      style[name] = value
    }
    this.style = style
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  getBoundingClientRect() {
    return {
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
  }
}

class TestDomDocument extends TestDomNode {
  activeElement!: TestDomElement
  body!: TestDomElement
  defaultView!: { HTMLIFrameElement: typeof TestHtmlIFrameElement; document: TestDomDocument }
  documentElement!: TestDomElement & { lang: string }

  constructor() {
    super(9, null)
  }

  createElement(tagName: string) {
    return new TestDomElement(this, tagName)
  }

  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName)
  }

  createTextNode(value: string) {
    return new TestDomText(this, value)
  }
}

class TestHtmlIFrameElement {}

const createTestDom = () => {
  const document = new TestDomDocument()
  const window = {
    HTMLIFrameElement: TestHtmlIFrameElement,
    document
  }
  document.defaultView = window
  document.documentElement = Object.assign(document.createElement('html'), { lang: 'en-US' })
  document.body = document.createElement('body')
  document.activeElement = document.body
  return {
    container: document.createElement('div'),
    document,
    window
  }
}

const findElement = (
  node: TestDomNode,
  predicate: (element: TestDomElement) => boolean
): TestDomElement | undefined => {
  if (node instanceof TestDomElement && predicate(node)) return node
  for (const child of node.childNodes) {
    const match = findElement(child, predicate)
    if (match != null) return match
  }
  return undefined
}

describe('sender voice recording status', () => {
  it('keeps an unsupported control actionable so a click can reveal recovery guidance', () => {
    const html = renderToStaticMarkup(
      <SenderVoiceControl
        voiceInput={createController('idle', {
          canStartRecording: false,
          unsupported: true
        })}
      />
    )

    expect(html).toContain('aria-label="chat.voiceInput.start"')
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).not.toContain(' disabled')
  })

  it('announces the microphone permission request and blocks duplicate starts', () => {
    const controller = createController('requesting')
    const controlHtml = renderToStaticMarkup(<SenderVoiceControl voiceInput={controller} />)
    const statusHtml = renderToStaticMarkup(<SenderVoiceRecordingBar voiceInput={controller} />)

    expect(controlHtml).toContain('aria-label="chat.voiceInput.requestingPermission"')
    expect(controlHtml).toContain('disabled=""')
    expect(controlHtml).toContain('progress_activity')
    expect(statusHtml).toContain('role="status"')
    expect(statusHtml).toContain('aria-live="polite"')
    expect(statusHtml).toContain('chat.voiceInput.requestingPermission')
    expect(statusHtml).toContain('aria-hidden="true">progress_activity')
  })

  it('updates visible recording time without changing the mounted live-region announcement', async () => {
    const testDom = createTestDom()
    vi.stubGlobal('document', testDom.document)
    vi.stubGlobal('window', testDom.window)
    vi.stubGlobal('navigator', { userAgent: 'vitest' })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {
          disconnect()
        }

        observe(node: Element) {
          observe(node)
        }
      }
    )
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(testDom.container as unknown as Element)
    const requestingController = createController('requesting')
    const recordingController = createController('recording', { elapsedSeconds: 7 })

    try {
      await React.act(async () => {
        root.render(
          <SenderVoiceRecordingBar
            voiceInput={requestingController}
          />
        )
      })

      const pendingIcon = findElement(
        testDom.container,
        element => element.getAttribute('class') === 'material-symbols-rounded sender-voice-recording__pending-icon'
      )
      expect(pendingIcon?.getAttribute('aria-hidden')).toBe('true')
      expect(observe).not.toHaveBeenCalled()

      await React.act(async () => {
        root.render(<SenderVoiceRecordingBar voiceInput={recordingController} />)
      })

      const liveRegion = findElement(testDom.container, element => element.getAttribute('role') === 'status')
      const timer = findElement(
        testDom.container,
        element => element.getAttribute('class') === 'sender-voice-recording__time'
      )
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
      expect(liveRegion?.getAttribute('aria-label')).toBe('chat.voiceInput.stop')
      expect(liveRegion?.textContent).toBe('')
      expect(timer?.textContent).toBe('0:07')
      expect(recordingController.handlers.setWaveformCapacity).toHaveBeenCalledWith(20)
      expect(observe).toHaveBeenCalledOnce()

      await React.act(async () => {
        root.render(
          <SenderVoiceRecordingBar
            voiceInput={createController('recording', { elapsedSeconds: 8 })}
          />
        )
      })

      expect(liveRegion?.getAttribute('aria-label')).toBe('chat.voiceInput.stop')
      expect(liveRegion?.textContent).toBe('')
      expect(timer?.textContent).toBe('0:08')
      expect(disconnect).toHaveBeenCalled()
    } finally {
      await React.act(async () => root.unmount())
      vi.unstubAllGlobals()
    }
  })
})
