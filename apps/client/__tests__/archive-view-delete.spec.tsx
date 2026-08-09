// @vitest-environment happy-dom

import { createInstance } from 'i18next'
import type { i18n as I18nInstance } from 'i18next'
import { act, useState } from 'react'
import type { PropsWithChildren, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Session } from '@oneworks/core'

import { ArchiveView } from '#~/components/ArchiveView'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const testState = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutateCalls: [] as unknown[],
  sessions: [] as Session[],
  updateSession: vi.fn()
}))

vi.mock('antd', async importOriginal => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({
        message: { error: testState.messageError, success: testState.messageSuccess }
      })
    }
  }
})

vi.mock('swr', () => ({
  default: () => {
    const [data, setData] = useState<{ sessions: Session[] }>(() => ({ sessions: testState.sessions }))
    const mutate = async (updater?: unknown) => {
      testState.mutateCalls.push(updater)
      if (typeof updater === 'function') {
        setData(current => updater(current))
      } else if (updater != null) {
        setData(updater as { sessions: Session[] })
      }
      return data
    }
    return { data, mutate }
  }
}))

vi.mock('#~/api', () => ({
  deleteSession: testState.deleteSession,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  listSessions: vi.fn(),
  updateSession: testState.updateSession
}))

vi.mock('#~/components/layout/RouteContainerHeader', () => ({
  RouteContainerHeader: ({ title }: { title: ReactNode }) => <header>{title}</header>
}))

vi.mock('#~/components/layout/RouteContainerLayout', () => ({
  RouteContainerLayout: ({ children, header }: PropsWithChildren<{ header?: ReactNode }>) => (
    <main>{header}{children}</main>
  )
}))

vi.mock('#~/components/layout/use-route-container-sidebar-opener', () => ({
  useRouteContainerSidebarOpener: () => ({ isCompactView: false, openRouteSidebar: vi.fn() })
}))

vi.mock('#~/plugins/route-plugin-chrome', () => ({
  useRoutePluginChrome: () => ({ headerActions: [] })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root
let i18n: I18nInstance

const createI18n = async () => {
  const instance = createInstance()
  await instance
    .use(initReactI18next)
    .init({
      lng: 'en',
      resources: {
        en: { translation: en },
        zh: { translation: zh }
      }
    })
  return instance
}

const session = (id: string, title: string): Session => ({
  createdAt: 1,
  id,
  isArchived: true,
  status: 'completed',
  title
} as Session)

const row = (title: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.archive-view__item'))
    .find(element => element.textContent?.includes(title))

const button = (label: string, scope: ParentNode = container) =>
  scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const popup = () =>
  document.querySelector<HTMLElement>(
    '.ant-popconfirm:not(.ant-popover-hidden):not(.ant-zoom-big-leave-active)'
  )

const confirmButton = () => popup()?.querySelector<HTMLButtonElement>('.ant-btn-primary')

const cancelButton = () => popup()?.querySelector<HTMLButtonElement>('.ant-btn:not(.ant-btn-primary)')

const click = async (element: HTMLElement | null | undefined) => {
  expect(element).toBeTruthy()
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

const activateWithKeyboard = async (element: HTMLElement | null | undefined, key: ' ' | 'Enter') => {
  expect(element).toBeTruthy()
  let synthesizedClickCount = 0
  await act(async () => {
    const keyDown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
    element?.dispatchEvent(keyDown)
    if (!keyDown.defaultPrevented && key === 'Enter') {
      element?.click()
      synthesizedClickCount += 1
    }
    element?.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key }))
    if (!keyDown.defaultPrevented && key === ' ') {
      element?.click()
      synthesizedClickCount += 1
    }
    await Promise.resolve()
  })
  return synthesizedClickCount
}

const repeatKeyboardKeyDown = async (element: HTMLElement | null | undefined, key: ' ' | 'Enter') => {
  expect(element).toBeTruthy()
  await act(async () => {
    element?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        repeat: true
      })
    )
    await Promise.resolve()
  })
}

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => globalThis.setTimeout(resolve, 0))
  })
}

const setSearchQuery = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="Search title or ID..."]')
  expect(input).toBeTruthy()
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (input != null && valueSetter != null) valueSetter.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    input?.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('archive view delete interactions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    testState.mutateCalls = []
    testState.sessions = [session('alpha', 'Alpha archive'), session('beta', 'Beta archive')]
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    i18n = await createI18n()
    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <ArchiveView />
        </I18nextProvider>
      )
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.querySelectorAll('.ant-popover, .ant-popover-hidden').forEach(element => element.remove())
  })

  it('uses the native Enter and Space event sequence without duplicate confirmation activation', async () => {
    const deleteButton = button('Delete', row('Alpha archive'))
    deleteButton?.focus()
    expect(await activateWithKeyboard(deleteButton, 'Enter')).toBe(0)
    await flush()

    expect(popup()?.textContent).toContain('Are you sure you want to delete this session?')
    await click(cancelButton())
    await flush()
    deleteButton?.focus()
    expect(await activateWithKeyboard(deleteButton, ' ')).toBe(0)
    await flush()
    expect(popup()?.textContent).toContain('Are you sure you want to delete this session?')
  })

  it('activates every archive action from Enter without native click duplication', async () => {
    testState.updateSession.mockResolvedValue(undefined)
    const batchModeButton = button('Batch Mode')
    batchModeButton?.focus()
    expect(await activateWithKeyboard(batchModeButton, 'Enter')).toBe(0)
    await flush()
    expect(button('Cancel Batch Mode')).toBeTruthy()

    const cancelBatchButton = button('Cancel Batch Mode')
    cancelBatchButton?.focus()
    expect(await activateWithKeyboard(cancelBatchButton, 'Enter')).toBe(0)
    await flush()
    expect(button('Batch Mode')).toBeTruthy()

    const restoreButton = button('Restore', row('Alpha archive'))
    restoreButton?.focus()
    expect(await activateWithKeyboard(restoreButton, 'Enter')).toBe(0)
    await flush()
    expect(testState.updateSession).toHaveBeenCalledWith('alpha', { isArchived: false })
    expect(testState.messageSuccess).toHaveBeenCalledWith('Restored successfully')

    await click(button('Batch Mode'))
    await click(row('Alpha archive'))
    const batchRestoreButton = button('Batch Restore')
    batchRestoreButton?.focus()
    expect(await activateWithKeyboard(batchRestoreButton, 'Enter')).toBe(0)
    await flush()
    expect(testState.updateSession).toHaveBeenCalledTimes(2)

    await click(button('Batch Mode'))
    await click(row('Alpha archive'))
    const batchDeleteButton = button('Batch Delete')
    batchDeleteButton?.focus()
    expect(await activateWithKeyboard(batchDeleteButton, 'Enter')).toBe(0)
    await flush()
    expect(document.querySelectorAll('.ant-popconfirm:not(.ant-popover-hidden)')).toHaveLength(1)
    await click(cancelButton())
  })

  it('keeps keyboard batch delete confirmation idempotent across discrete and repeated activation', async () => {
    testState.updateSession.mockResolvedValue(undefined)
    const restoreButton = button('Restore', row('Alpha archive'))
    expect(await activateWithKeyboard(restoreButton, 'Enter')).toBe(0)
    await repeatKeyboardKeyDown(restoreButton, 'Enter')
    await flush()
    expect(testState.updateSession).toHaveBeenCalledTimes(1)

    await click(button('Batch Mode'))
    await click(row('Alpha archive'))
    const batchDeleteButton = button('Batch Delete')
    expect(await activateWithKeyboard(batchDeleteButton, 'Enter')).toBe(0)
    expect(await activateWithKeyboard(batchDeleteButton, 'Enter')).toBe(0)
    await repeatKeyboardKeyDown(batchDeleteButton, 'Enter')
    await flush()
    expect(document.querySelectorAll('.ant-popconfirm:not(.ant-popover-hidden)')).toHaveLength(1)
    await click(cancelButton())
    await flush()
    expect(await activateWithKeyboard(batchDeleteButton, ' ')).toBe(0)
    expect(await activateWithKeyboard(batchDeleteButton, ' ')).toBe(0)
    await flush()
    expect(document.querySelectorAll('.ant-popconfirm:not(.ant-popover-hidden)')).toHaveLength(1)
    await click(cancelButton())
  })

  it('uses localized role and name contracts for every archive control', async () => {
    const expectButton = (label: string, scope?: ParentNode) => {
      const action = button(label, scope)
      expect(action?.tagName).toBe('BUTTON')
      expect(action?.getAttribute('aria-label')).toBe(label)
    }
    const expectCheckbox = (label: string, scope: ParentNode = container) => {
      const input = scope.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`)
      expect(input?.tagName).toBe('INPUT')
      expect(input?.type).toBe('checkbox')
    }

    expectButton('Batch Mode')
    expectButton('Restore', row('Alpha archive'))
    expectButton('Delete', row('Alpha archive'))
    await click(button('Batch Mode'))
    expectCheckbox('Select all')
    expectCheckbox('Select Alpha archive', row('Alpha archive'))
    expectButton('Cancel Batch Mode')
    expectButton('Batch Restore')
    expectButton('Batch Delete')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expectCheckbox('全选')
    expectCheckbox('选择 Alpha archive', row('Alpha archive'))
    expectButton('取消批量操作')
    expectButton('批量还原')
    expectButton('批量删除')
    await click(button('取消批量操作'))
    expectButton('还原', row('Alpha archive'))
    expectButton('删除', row('Alpha archive'))
  })

  it('clears a keyboard-opened confirmation when mode or filtering hides its row', async () => {
    const deleteButton = button('Delete', row('Alpha archive'))
    deleteButton?.focus()
    expect(await activateWithKeyboard(deleteButton, 'Enter')).toBe(0)
    await flush()
    expect(popup()).toBeTruthy()

    const batchModeButton = button('Batch Mode')
    batchModeButton?.focus()
    expect(await activateWithKeyboard(batchModeButton, 'Enter')).toBe(0)
    await flush()
    expect(popup()).toBeNull()
    await click(button('Cancel Batch Mode'))
    await flush()
    expect(popup()).toBeNull()

    const reopenedDeleteButton = button('Delete', row('Alpha archive'))
    reopenedDeleteButton?.focus()
    expect(await activateWithKeyboard(reopenedDeleteButton, ' ')).toBe(0)
    await flush()
    expect(popup()).toBeTruthy()
    await setSearchQuery('Beta')
    await flush()
    expect(row('Alpha archive')).toBeUndefined()
    expect(popup()).toBeNull()
    await setSearchQuery('')
    await flush()
    expect(button('Delete', row('Alpha archive'))).toBeTruthy()
    expect(popup()).toBeNull()
  })

  it('cancels without mutation, deduplicates pending confirmation, and applies cache updates to mounted UI', async () => {
    const pending = deferred<void>()
    testState.deleteSession.mockReturnValueOnce(pending.promise)
    await click(button('Delete', row('Alpha archive')))
    await flush()
    await click(cancelButton())
    await flush()
    expect(testState.deleteSession).not.toHaveBeenCalled()

    await click(button('Delete', row('Alpha archive')))
    await flush()
    const confirm = confirmButton()
    await act(async () => {
      confirm?.click()
      confirm?.click()
      await Promise.resolve()
    })

    expect(testState.deleteSession).toHaveBeenCalledTimes(1)
    pending.resolve()
    await flush()

    expect(row('Alpha archive')).toBeUndefined()
    expect(row('Beta archive')).toBeTruthy()
    expect(testState.mutateCalls).toEqual([expect.any(Function), undefined])
    expect(testState.messageSuccess).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('Deleted successfully')
  })

  it('keeps a failed single delete open and retryable', async () => {
    testState.deleteSession.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined)
    await click(button('Delete', row('Alpha archive')))
    await flush()
    await click(confirmButton())
    await flush()

    expect(row('Alpha archive')).toBeTruthy()
    expect(popup()).toBeTruthy()
    expect(testState.messageError).toHaveBeenCalledWith('Failed to delete')

    await click(confirmButton())
    await flush()

    expect(testState.deleteSession).toHaveBeenCalledTimes(2)
    expect(row('Alpha archive')).toBeUndefined()
  })

  it('removes every row, clears selection, exits batch mode, and reports one all-success notice', async () => {
    testState.deleteSession.mockResolvedValue(undefined)
    await click(button('Batch Mode'))
    await click(row('Alpha archive'))
    await click(row('Beta archive'))
    await click(button('Batch Delete'))
    await flush()
    await click(confirmButton())
    await flush()

    expect(testState.deleteSession.mock.calls).toEqual([['alpha'], ['beta']])
    expect(row('Alpha archive')).toBeUndefined()
    expect(row('Beta archive')).toBeUndefined()
    expect(container.querySelector('.archive-view__item--selected')).toBeNull()
    expect(button('Batch Mode')).toBeTruthy()
    expect(testState.messageSuccess).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('Batch deleted successfully')
  })

  it('preserves batch delete partial-success retry selection', async () => {
    testState.deleteSession.mockImplementation(async (id: string) => {
      if (id === 'beta') throw new Error('failed')
    })
    await click(button('Batch Mode'))
    await click(row('Alpha archive'))
    await click(row('Beta archive'))
    await click(button('Batch Delete'))
    await flush()
    await click(confirmButton())
    await flush()

    expect(row('Alpha archive')).toBeUndefined()
    expect(row('Beta archive')?.className).toContain('archive-view__item--selected')
    expect(button('Batch Mode')).toBeNull()
    expect(button('Cancel Batch Mode')).toBeTruthy()
    expect(button('Batch Restore')).toBeTruthy()
    expect(button('Batch Delete')).toBeTruthy()
    expect(container.querySelector('input[aria-label="Deselect all"]')).toBeTruthy()
    expect(container.querySelector('input[aria-label="Select Beta archive"]')).toBeTruthy()
    expect(testState.messageError).toHaveBeenCalledWith('Failed to delete some sessions')
  })
})
