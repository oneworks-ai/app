/* eslint-disable max-lines -- Keep the dependency-free mounted DOM harness local to this regression spec. */

import type { Root } from 'react-dom/client'

import type * as React from 'react'
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '@oneworks/core'

const mocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutate: vi.fn(),
  sessions: [] as Session[]
}))

vi.mock('antd', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
    danger?: boolean
    icon?: React.ReactNode
    loading?: boolean
    size?: string
    type?: string
  }

  const Button = ({
    children,
    danger: _danger,
    disabled,
    icon,
    loading,
    size: _size,
    type: _type,
    ...props
  }: ButtonProps) => (
    <button {...props} type='button' disabled={disabled === true || loading === true}>
      {icon}
      {children}
    </button>
  )

  const Checkbox = ({
    checked,
    disabled,
    onChange
  }: {
    checked?: boolean
    disabled?: boolean
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  }) => (
    <input
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  )

  const Input = ({
    className,
    onChange,
    placeholder,
    value
  }: {
    className?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    value?: string
  }) => (
    <input
      className={className}
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
  )

  const ListItem = ({
    children,
    className,
    onClick
  }: React.PropsWithChildren<{
    className?: string
    onClick?: React.MouseEventHandler<HTMLDivElement>
  }>) => (
    <div className={className} onClick={onClick}>{children}</div>
  )

  const List = Object.assign(
    <T,>({
      dataSource,
      renderItem
    }: {
      dataSource: T[]
      renderItem: (item: T) => React.ReactNode
    }) => <div>{dataSource.map((item, index) => <React.Fragment key={index}>{renderItem(item)}</React.Fragment>)}</div>,
    { Item: ListItem }
  )

  const Popconfirm = ({
    cancelText = 'common.cancel',
    children,
    disabled,
    okButtonProps,
    okText = 'common.confirm',
    onCancel,
    onConfirm,
    onOpenChange,
    open,
    title
  }: React.PropsWithChildren<{
    cancelText?: string
    disabled?: boolean
    okButtonProps?: { loading?: boolean }
    okText?: string
    onCancel?: () => void
    onConfirm?: (event?: React.MouseEvent<HTMLElement>) => void
    onOpenChange?: (open: boolean) => void
    open?: boolean
    title: React.ReactNode
  }>) => {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const isOpen = open ?? internalOpen
    const setOpen = (nextOpen: boolean) => {
      if (open == null) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    }
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler<HTMLElement>
    }>
    const trigger = React.cloneElement(child, {
      onClick: (event) => {
        child.props.onClick?.(event)
        if (disabled !== true && !event.defaultPrevented) {
          setOpen(true)
        }
      }
    })

    return (
      <>
        {trigger}
        {isOpen && (
          <div role='dialog'>
            <span>{title}</span>
            <button
              type='button'
              aria-label={cancelText}
              onClick={() => {
                onCancel?.()
                setOpen(false)
              }}
            >
              {cancelText}
            </button>
            <button
              type='button'
              aria-label={okText}
              disabled={okButtonProps?.loading === true}
              onClick={(event) => {
                onConfirm?.(event)
                setOpen(false)
              }}
            >
              {okText}
            </button>
          </div>
        )}
      </>
    )
  }

  const Tooltip = ({
    children,
    onClick,
    title
  }: React.PropsWithChildren<{
    onClick?: React.MouseEventHandler<HTMLElement>
    title?: React.ReactNode
  }>) => {
    const child = React.Children.only(children) as React.ReactElement<{
      'aria-label'?: string
      onClick?: React.MouseEventHandler<HTMLElement>
    }>
    return React.cloneElement(child, {
      'aria-label': child.props['aria-label'] ?? String(title ?? ''),
      onClick: (event) => {
        child.props.onClick?.(event)
        onClick?.(event)
      }
    })
  }

  return {
    App: {
      useApp: () => ({
        message: {
          error: mocks.messageError,
          success: mocks.messageSuccess
        }
      })
    },
    Button,
    Checkbox,
    Empty: Object.assign(
      ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
      { PRESENTED_IMAGE_SIMPLE: 'simple' }
    ),
    Input,
    List,
    Popconfirm,
    Space: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
      <div className={className}>{children}</div>
    ),
    Tag: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
      <span className={className}>{children}</span>
    ),
    Tooltip
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('swr', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: () => {
      const [data, setData] = React.useState<{ sessions: Session[] }>(() => ({
        sessions: mocks.sessions
      }))
      const mutate = async (
        updater?: ((current: { sessions: Session[] }) => { sessions: Session[] }) | { sessions: Session[] }
      ) => {
        mocks.mutate(updater)
        if (typeof updater === 'function') {
          setData(current => updater(current))
        } else if (updater != null) {
          setData(updater)
        }
        return data
      }

      return { data, mutate }
    }
  }
})

vi.mock('#~/api', () => ({
  deleteSession: mocks.deleteSession,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  listSessions: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: ({ title }: { title: React.ReactNode }) => <header>{title}</header>
}))

vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children, className, header }: React.PropsWithChildren<{
    className?: string
    header?: React.ReactNode
  }>) => (
    <main className={className}>
      {header}
      {children}
    </main>
  )
}))

vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({
    isCompactView: false,
    openRouteSidebar: vi.fn()
  })
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({ headerActions: [] })
}))

class TestEvent {
  bubbles = true
  cancelBubble = false
  cancelable = true
  currentTarget: TestElement | null = null
  defaultPrevented = false
  target: TestElement | null = null
  type: string

  constructor(type: string) {
    this.type = type
  }

  preventDefault() {
    this.defaultPrevented = true
  }

  stopPropagation() {
    this.cancelBubble = true
  }
}

class TestNode {
  childNodes: TestNode[] = []
  listeners = new Map<string, Set<(event: TestEvent) => void>>()
  nodeType: number
  ownerDocument: TestDocument
  parentNode: TestNode | null = null

  constructor(nodeType: number, ownerDocument: TestDocument) {
    this.nodeType = nodeType
    this.ownerDocument = ownerDocument
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null
  }

  get lastChild(): TestNode | null {
    return this.childNodes.at(-1) ?? null
  }

  get nextSibling(): TestNode | null {
    if (this.parentNode == null) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  get textContent(): string {
    return this.childNodes.map(child => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes = value === '' ? [] : [this.ownerDocument.createTextNode(value)]
    this.childNodes.forEach(child => {
      child.parentNode = this
    })
  }

  appendChild<T extends TestNode>(child: T): T {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore<T extends TestNode>(child: T, before: TestNode | null): T {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    const index = before == null ? -1 : this.childNodes.indexOf(before)
    if (index === -1) {
      this.childNodes.push(child)
    } else {
      this.childNodes.splice(index, 0, child)
    }
    return child
  }

  removeChild<T extends TestNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index !== -1) {
      this.childNodes.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  addEventListener(type: string, listener: (event: TestEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }
}

class TestText extends TestNode {
  nodeValue: string

  constructor(value: string, ownerDocument: TestDocument) {
    super(3, ownerDocument)
    this.nodeValue = value
  }

  override get textContent() {
    return this.nodeValue
  }

  override set textContent(value: string) {
    this.nodeValue = value
  }
}

class TestElement extends TestNode {
  attributes = new Map<string, string>()
  checked = false
  disabled = false
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  nodeName: string
  style: Record<string, unknown> & {
    removeProperty: (name: string) => void
    setProperty: (name: string, value: unknown) => void
  }
  tagName: string
  type = ''
  value = ''

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, ownerDocument)
    this.tagName = tagName.toUpperCase()
    this.nodeName = this.tagName
    const style = Object.assign(Object.create(null) as Record<string, unknown>, {
      removeProperty: (name: string) => {
        delete style[name]
      },
      setProperty: (name: string, value: unknown) => {
        style[name] = value
      }
    })
    this.style = style
  }

  get className() {
    return this.getAttribute('class') ?? ''
  }

  set className(value: string) {
    this.setAttribute('class', value)
  }

  click() {
    if (this.disabled) return
    this.focus()
    if (this.tagName === 'INPUT' && this.type === 'checkbox') {
      this.checked = !this.checked
    }
    this.dispatchEvent(new TestEvent('click'))
  }

  dispatchEvent(event: TestEvent) {
    event.target ??= this
    event.currentTarget = this
    this.listeners.get(event.type)?.forEach(listener => listener(event))
    let parent = this.parentNode
    while (!event.cancelBubble && parent != null) {
      event.currentTarget = parent instanceof TestElement ? parent : null
      parent.listeners.get(event.type)?.forEach(listener => listener(event))
      if (event.cancelBubble) break
      parent = parent.parentNode
    }
    return !event.defaultPrevented
  }

  focus() {
    this.ownerDocument.activeElement = this
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value))
  }
}

class TestDocument extends TestNode {
  activeElement: TestElement | null = null
  body: TestElement
  defaultView: Record<string, unknown> = {}
  documentElement: TestElement

  constructor() {
    super(9, undefined as unknown as TestDocument)
    this.ownerDocument = this
    this.documentElement = this.createElement('html')
    this.body = this.createElement('body')
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
  }

  createElement(tagName: string) {
    return new TestElement(tagName, this)
  }

  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName)
  }

  createTextNode(value: string) {
    return new TestText(value, this)
  }
}

const testDocument = new TestDocument()
const testWindow = {
  document: testDocument,
  Event: TestEvent,
  HTMLElement: TestElement,
  HTMLIFrameElement: class {},
  Node: TestNode,
  addEventListener: () => undefined,
  getComputedStyle: () => ({}),
  getSelection: () => null,
  removeEventListener: () => undefined
}
testDocument.defaultView = testWindow

let ArchiveView: typeof import('#~/components/ArchiveView').ArchiveView
let createRoot: typeof import('react-dom/client').createRoot
let container: TestElement
let root: Root

const makeSession = (id: string, title: string): Session => ({
  id,
  createdAt: 1,
  isArchived: true,
  status: 'completed',
  title
} as Session)

const descendants = (node: TestNode): TestElement[] => {
  const elements = node instanceof TestElement ? [node] : []
  return [...elements, ...node.childNodes.flatMap(descendants)]
}

const findElement = (predicate: (element: TestElement) => boolean) => {
  const element = descendants(container).find(predicate)
  if (element == null) {
    throw new Error(`Expected element not found. Rendered text: ${container.textContent}`)
  }
  return element
}

const findButton = (ariaLabel: string, within: TestNode = container) => {
  const button = descendants(within).find(element =>
    element.tagName === 'BUTTON' && element.getAttribute('aria-label') === ariaLabel
  )
  if (button == null) {
    throw new Error(`Expected button "${ariaLabel}" not found. Rendered text: ${container.textContent}`)
  }
  return button
}

const findSessionRow = (title: string) =>
  findElement(element =>
    element.className.split(' ').includes('archive-view__item') && element.textContent.includes(title)
  )

const click = async (element: TestElement) => {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testDocument },
    Event: { configurable: true, value: TestEvent },
    HTMLElement: { configurable: true, value: TestElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    Node: { configurable: true, value: TestNode },
    navigator: { configurable: true, value: { userAgent: 'node.js' } },
    window: { configurable: true, value: testWindow }
  })
  ;({ createRoot } = await import('react-dom/client'))
  ;({ ArchiveView } = await import('#~/components/ArchiveView'))
})

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.sessions = [
    makeSession('session-alpha', 'Alpha archive'),
    makeSession('session-beta', 'Beta archive')
  ]
  container = testDocument.createElement('div')
  testDocument.body.appendChild(container)
  root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(<ArchiveView />)
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  testDocument.body.removeChild(container)
})

describe('archive view delete interactions', () => {
  it('opens a labeled single-session confirmation and cancel preserves the row', async () => {
    const alphaRow = findSessionRow('Alpha archive')
    const deleteButton = findButton('common.delete', alphaRow)

    await click(deleteButton)

    expect(deleteButton.ownerDocument.activeElement).toBe(deleteButton)
    expect(findElement(element => element.getAttribute('role') === 'dialog').textContent)
      .toContain('common.deleteSessionConfirm')
    expect(findSessionRow('Alpha archive').className).toContain('archive-view__item--confirming')

    await click(findButton('common.cancel'))

    expect(descendants(container).some(element => element.getAttribute('role') === 'dialog')).toBe(false)
    expect(findSessionRow('Alpha archive')).toBeDefined()
    expect(mocks.deleteSession).not.toHaveBeenCalled()
  })

  it('confirms exactly one delete, guards duplicate pending clicks, and updates the mounted UI', async () => {
    const pendingDelete = deferred<void>()
    mocks.deleteSession.mockReturnValueOnce(pendingDelete.promise)

    await click(findButton('common.delete', findSessionRow('Alpha archive')))
    const confirmButton = findButton('common.confirm')
    await click(confirmButton)
    await click(confirmButton)

    expect(mocks.deleteSession).toHaveBeenCalledTimes(1)
    expect(mocks.deleteSession).toHaveBeenCalledWith('session-alpha')
    expect(findSessionRow('Alpha archive')).toBeDefined()

    pendingDelete.resolve()
    await flush()

    expect(descendants(container).some(element => element.textContent.includes('Alpha archive'))).toBe(false)
    expect(findSessionRow('Beta archive')).toBeDefined()
    expect(mocks.messageSuccess).toHaveBeenCalledWith('common.deleteSuccess')
  })

  it('keeps a failed delete open and retryable', async () => {
    mocks.deleteSession
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined)

    await click(findButton('common.delete', findSessionRow('Alpha archive')))
    await click(findButton('common.confirm'))
    await flush()

    expect(findSessionRow('Alpha archive')).toBeDefined()
    expect(findElement(element => element.getAttribute('role') === 'dialog')).toBeDefined()
    expect(mocks.messageError).toHaveBeenCalledWith('common.deleteFailed')

    await click(findButton('common.confirm'))
    await flush()

    expect(mocks.deleteSession).toHaveBeenCalledTimes(2)
    expect(descendants(container).some(element => element.textContent.includes('Alpha archive'))).toBe(false)
  })

  it('keeps batch deletion working for the selected archived sessions', async () => {
    mocks.deleteSession.mockResolvedValue(undefined)

    await click(findButton('common.batchMode'))
    await click(findSessionRow('Alpha archive'))
    await click(findSessionRow('Beta archive'))
    await click(findButton('common.batchDelete'))
    await click(findButton('common.confirm'))
    await flush()

    expect(mocks.deleteSession.mock.calls).toEqual([
      ['session-alpha'],
      ['session-beta']
    ])
    expect(descendants(container).some(element => element.textContent.includes('Alpha archive'))).toBe(false)
    expect(descendants(container).some(element => element.textContent.includes('Beta archive'))).toBe(false)
    expect(mocks.messageSuccess).toHaveBeenCalledWith('common.batchDeleteSuccess')
  })
})
