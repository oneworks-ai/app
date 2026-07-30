/* eslint-disable max-lines -- shared mounted host also supports real Ant modal DOM contracts. */

type ReactHostEventListener = (event: ReactHostEvent) => void

class ReactHostEvent {
  bubbles: boolean
  cancelBubble = false
  cancelable: boolean
  currentTarget: ReactHostNode | null = null
  defaultPrevented = false
  eventPhase = 0
  isTrusted = false
  returnValue = true
  target: ReactHostNode | null = null
  timeStamp = Date.now()

  constructor(
    public type: string,
    init: {
      bubbles?: boolean
      cancelable?: boolean
      [key: string]: unknown
    } = {}
  ) {
    this.bubbles = init.bubbles ?? false
    this.cancelable = init.cancelable ?? false
    Object.assign(this, init)
  }

  preventDefault() {
    if (!this.cancelable) return
    this.defaultPrevented = true
    this.returnValue = false
  }

  stopPropagation() {
    this.cancelBubble = true
  }
}

class ReactHostNode {
  childNodes: ReactHostNode[] = []
  nodeValue: string | null = null
  ownerDocument: ReactHostDocument
  parentNode: ReactHostNode | null = null
  private listeners = new Map<string, {
    bubble: Set<ReactHostEventListener>
    capture: Set<ReactHostEventListener>
  }>()

  constructor(
    public nodeType: number,
    public nodeName: string,
    ownerDocument: ReactHostDocument
  ) {
    this.ownerDocument = ownerDocument
  }

  get firstChild() {
    return this.childNodes[0] ?? null
  }

  get children(): ReactHostElement[] {
    return this.childNodes.filter((node): node is ReactHostElement => node instanceof ReactHostElement)
  }

  get lastChild(): ReactHostNode | null {
    return this.childNodes.at(-1) ?? null
  }

  get nextSibling(): ReactHostNode | null {
    if (this.parentNode == null) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ''
    return this.childNodes.map(child => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes = []
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(value))
  }

  appendChild<T extends ReactHostNode>(child: T): T {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore<T extends ReactHostNode>(child: T, before: ReactHostNode | null): T {
    if (before == null) return this.appendChild(child)
    child.parentNode?.removeChild(child)
    const index = this.childNodes.indexOf(before)
    child.parentNode = this
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child)
    return child
  }

  removeChild<T extends ReactHostNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  contains(node: ReactHostNode | null): boolean {
    if (node == null) return false
    return node === this || this.childNodes.some(child => child.contains(node))
  }

  getRootNode(): ReactHostNode {
    return this.parentNode?.getRootNode() ?? this
  }

  addEventListener(
    type: string,
    listener: ReactHostEventListener,
    options?: boolean | { capture?: boolean }
  ) {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const listeners = this.listeners.get(type) ?? {
      bubble: new Set<ReactHostEventListener>(),
      capture: new Set<ReactHostEventListener>()
    }
    listeners[capture ? 'capture' : 'bubble'].add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(
    type: string,
    listener: ReactHostEventListener,
    options?: boolean | { capture?: boolean }
  ) {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    this.listeners.get(type)?.[capture ? 'capture' : 'bubble'].delete(listener)
  }

  dispatchEvent(event: ReactHostEvent) {
    event.target = this
    const path: ReactHostNode[] = [this]
    while (path.at(-1)?.parentNode != null) {
      path.push(path.at(-1)!.parentNode!)
    }
    const invoke = (node: ReactHostNode, capture: boolean, phase: number) => {
      event.currentTarget = node
      event.eventPhase = phase
      for (const listener of node.listeners.get(event.type)?.[capture ? 'capture' : 'bubble'] ?? []) {
        listener(event)
        if (event.cancelBubble) return
      }
    }

    for (const node of [...path].reverse()) {
      invoke(node, true, node === this ? 2 : 1)
      if (event.cancelBubble) return !event.defaultPrevented
    }
    for (const node of path) {
      invoke(node, false, node === this ? 2 : 3)
      if (event.cancelBubble || !event.bubbles) break
    }
    event.currentTarget = null
    event.eventPhase = 0
    return !event.defaultPrevented
  }
}

export class ReactHostElement extends ReactHostNode {
  attributes = new Map<string, string>()
  disabled = false
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  scrollHeight = 0
  private styleValues = new Map<string, string>()
  style = {
    getPropertyValue: (name: string) => this.styleValues.get(name) ?? '',
    setProperty: (name: string, value: string) => {
      this.styleValues.set(name, value)
    }
  }
  tagName: string

  constructor(tagName: string, ownerDocument: ReactHostDocument) {
    const normalizedTagName = tagName.toUpperCase()
    super(1, normalizedTagName, ownerDocument)
    this.tagName = normalizedTagName
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  getAttributeNames() {
    return [...this.attributes.keys()]
  }

  hasAttribute(name: string) {
    return this.attributes.has(name)
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  get dataset() {
    return Object.fromEntries(
      [...this.attributes.entries()]
        .filter(([name]) => name.startsWith('data-'))
        .map(([name, value]) => [
          name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
          value
        ])
    )
  }

  get isConnected() {
    return this.ownerDocument.contains(this)
  }

  getBoundingClientRect() {
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }
  }

  closest(selector: string): ReactHostElement | null {
    if (this.matches(selector)) return this
    return this.parentNode instanceof ReactHostElement
      ? this.parentNode.closest(selector)
      : null
  }

  querySelector<T extends ReactHostElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null
  }

  querySelectorAll<T extends ReactHostElement>(selector: string): T[] {
    const matches: T[] = []
    const visit = (node: ReactHostNode) => {
      if (node instanceof ReactHostElement && node.matches(selector)) {
        matches.push(node as T)
      }
      for (const child of node.childNodes) visit(child)
    }
    for (const child of this.childNodes) visit(child)
    return matches
  }

  matches(selector: string) {
    const enabledTagMatch = selector.match(/^([a-z]+):not\(:disabled\)$/i)
    if (enabledTagMatch != null) {
      return this.tagName === enabledTagMatch[1]!.toUpperCase() && !this.disabled
    }
    const attributeMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/)
    if (attributeMatch != null) {
      return this.getAttribute(attributeMatch[1]!) === attributeMatch[2]
    }
    if (/^[a-z]+$/i.test(selector)) return this.tagName === selector.toUpperCase()
    if (!selector.startsWith('.')) return false
    const classes = new Set((this.getAttribute('class') ?? '').split(/\s+/))
    return selector.slice(1).split('.').every(className => classes.has(className))
  }

  focus() {
    this.ownerDocument.activeElement = this
  }

  scrollTo() {}

  click() {
    if (this.disabled) return
    this.dispatchEvent(
      new ReactHostEvent('click', {
        bubbles: true,
        button: 0,
        cancelable: true
      })
    )
  }

  keyDown(key: string) {
    if (this.disabled) return
    this.dispatchEvent(
      new ReactHostEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
      })
    )
  }
}

export interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

export const createDeferred = <T>(): Deferred<T> => {
  let resolve: Deferred<T>['resolve'] = () => undefined
  let reject: Deferred<T>['reject'] = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

export class MemoryStorage {
  values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  clear() {
    this.values.clear()
  }
}

class ReactHostText extends ReactHostNode {
  constructor(value: string, ownerDocument: ReactHostDocument) {
    super(3, '#text', ownerDocument)
    this.nodeValue = value
  }
}

class ReactHostDocument extends ReactHostNode {
  activeElement: ReactHostElement | null = null
  body: ReactHostElement
  defaultView: Record<string, unknown>
  documentElement: ReactHostElement
  head: ReactHostElement

  constructor() {
    super(9, '#document', undefined as unknown as ReactHostDocument)
    this.ownerDocument = this
    this.documentElement = this.createElement('html')
    this.head = this.createElement('head')
    this.body = this.createElement('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
    this.defaultView = {}
  }

  createElement(tagName: string) {
    return new ReactHostElement(tagName, this)
  }

  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName)
  }

  createTextNode(value: string) {
    return new ReactHostText(value, this)
  }

  createComment(value: string) {
    const comment = new ReactHostNode(8, '#comment', this)
    comment.nodeValue = value
    return comment
  }

  querySelector<T extends ReactHostElement>(selector: string): T | null {
    return this.documentElement.querySelector<T>(selector)
  }

  querySelectorAll<T extends ReactHostElement>(selector: string): T[] {
    return this.documentElement.querySelectorAll<T>(selector)
  }
}

export const installReactMountedTestHost = ({
  deferAnimationFrames = false
}: {
  deferAnimationFrames?: boolean
} = {}) => {
  const document = new ReactHostDocument()
  const eventBoundary = document.createElement('div')
  const container = document.createElement('div')
  eventBoundary.appendChild(container)
  document.body.appendChild(eventBoundary)
  class ReactHostHtmlIFrameElement extends ReactHostElement {}
  class ReactHostShadowRoot extends ReactHostNode {}
  let animationFrameSequence = 0
  const animationFrames = new Map<number, () => void>()
  const requestAnimationFrame = (callback: () => void) => {
    const frame = ++animationFrameSequence
    if (deferAnimationFrames) animationFrames.set(frame, callback)
    else callback()
    return frame
  }
  const cancelAnimationFrame = (frame: number) => {
    animationFrames.delete(frame)
  }
  const getComputedStyle = () => ({
    content: '',
    getPropertyValue: () => ''
  })
  const window = {
    cancelAnimationFrame,
    clearTimeout,
    document,
    Element: ReactHostElement,
    Event: ReactHostEvent,
    HTMLElement: ReactHostElement,
    HTMLIFrameElement: ReactHostHtmlIFrameElement,
    innerHeight: 900,
    Node: ReactHostNode,
    Text: ReactHostText,
    addEventListener: () => undefined,
    getComputedStyle,
    removeEventListener: () => undefined,
    requestAnimationFrame,
    setTimeout
  }
  document.defaultView = window

  Object.assign(globalThis, {
    document,
    Element: ReactHostElement,
    Event: ReactHostEvent,
    getComputedStyle,
    HTMLElement: ReactHostElement,
    Node: ReactHostNode,
    Text: ReactHostText,
    ShadowRoot: ReactHostShadowRoot,
    window
  })

  return {
    container,
    document,
    eventBoundary,
    flushAnimationFrames: () => {
      const pendingFrames = [...animationFrames.values()]
      animationFrames.clear()
      pendingFrames.forEach(callback => callback())
    }
  }
}

export const findReactHostElement = (
  root: ReactHostNode,
  predicate: (element: ReactHostElement) => boolean
): ReactHostElement | undefined => {
  if (root instanceof ReactHostElement && predicate(root)) return root
  for (const child of root.childNodes) {
    const match = findReactHostElement(child, predicate)
    if (match != null) return match
  }
  return undefined
}

export const findReactHostElements = (
  root: ReactHostNode,
  predicate: (element: ReactHostElement) => boolean
): ReactHostElement[] => {
  const matches: ReactHostElement[] = []
  if (root instanceof ReactHostElement && predicate(root)) matches.push(root)
  for (const child of root.childNodes) {
    matches.push(...findReactHostElements(child, predicate))
  }
  return matches
}

// Capture a browser-like delegated event while a control is enabled, then
// deliver it after a React commit. This models a queued user event without
// reading React internals or calling a product callback directly.
export const queueReactHostEvent = (
  target: ReactHostElement,
  type: string,
  init: Record<string, unknown> = {}
) => {
  const event = new ReactHostEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init
  })
  return () => target.dispatchEvent(event)
}

export const dispatchReactHostEvent = (
  target: ReactHostElement,
  type: string,
  init: Record<string, unknown> = {}
) =>
  target.dispatchEvent(
    new ReactHostEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init
    })
  )

// Runs a synchronous state commit at an outer DOM capture boundary while the
// original enabled event continues through React's real delegated handler.
export const scheduleReactHostEventAtCapture = (
  boundary: ReactHostElement,
  target: ReactHostElement,
  type: string,
  onCapture: () => void,
  init: Record<string, unknown> = {}
) => {
  let captureCount = 0
  let bubbleCount = 0
  const intercept = (event: ReactHostEvent) => {
    if (event.target !== target) return
    captureCount += 1
    onCapture()
  }
  boundary.addEventListener(type, intercept, true)
  const observeBubble = (event: ReactHostEvent) => {
    if (event.target === target) bubbleCount += 1
  }
  boundary.addEventListener(type, observeBubble)
  return {
    dispatchWhileEnabled: () =>
      target.dispatchEvent(
        new ReactHostEvent(type, {
          bubbles: true,
          cancelable: true,
          ...init
        })
      ),
    getCaptureCount: () => captureCount,
    getBubbleCount: () => bubbleCount,
    dispose: () => {
      boundary.removeEventListener(type, intercept, true)
      boundary.removeEventListener(type, observeBubble)
    }
  }
}
