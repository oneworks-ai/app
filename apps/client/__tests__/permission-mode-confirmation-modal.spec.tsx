/* eslint-disable max-lines -- real Ant confirmation focus lifecycle coverage stays with its mounted harness. */

import { readFileSync } from 'node:fs'

import { Button, ConfigProvider, Modal } from 'antd'
import type { App } from 'antd'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PermissionModeOption } from '#~/hooks/chat/permission-mode'
import { createDraftPermissionModeLifecycle } from '#~/hooks/chat/permission-mode-acknowledgement'
import { usePermissionModeSelectionGuard } from '#~/hooks/chat/use-permission-mode-selection-guard'

import {
  MemoryStorage,
  dispatchReactHostEvent,
  findReactHostElement,
  installReactMountedTestHost
} from './react-mounted-test-host'
import type { ReactHostElement } from './react-mounted-test-host'

type ConfirmModal = ReturnType<typeof App.useApp>['modal']['confirm']

const nativeClearTimeout = globalThis.clearTimeout
const nativeSetTimeout = globalThis.setTimeout

const permissionOptions: PermissionModeOption[] = [{
  description: 'Run without asking for confirmation.',
  label: 'Bypass permissions',
  value: 'bypassPermissions'
}] as const

const useConfirmationFakeTimerQueue = () => {
  const fakeClearTimeout = globalThis.clearTimeout
  const fakeSetTimeout = globalThis.setTimeout
  const selectivelyFakeClearTimeout = (timeout: ReturnType<typeof globalThis.setTimeout>) => {
    fakeClearTimeout(timeout)
    nativeClearTimeout(timeout)
  }
  const selectivelyFakeSetTimeout = (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 160) return fakeSetTimeout(callback, delay, ...args)
    return nativeSetTimeout(callback, delay, ...args)
  }
  vi.stubGlobal('clearTimeout', selectivelyFakeClearTimeout)
  vi.stubGlobal('setTimeout', selectivelyFakeSetTimeout)
}

function PermissionConfirmationHarness({
  cancelDisabled = false,
  keepModalMountedDuringClose = false
}: {
  cancelDisabled?: boolean
  keepModalMountedDuringClose?: boolean
}) {
  const editorRef = React.useRef<HTMLTextAreaElement>(null)
  const lifecycle = React.useRef(createDraftPermissionModeLifecycle()).current
  const [scopeId, setScopeId] = React.useState('permission-confirmation-a11y')
  const [modalConfig, setModalConfig] = React.useState<Parameters<ConfirmModal>[0]>()
  const [modalOpen, setModalOpen] = React.useState(false)
  const closeModal = React.useCallback(() => {
    const closing = modalConfig
    setModalOpen(false)
    if (!keepModalMountedDuringClose) {
      closing?.afterClose?.()
      setModalConfig(undefined)
    }
  }, [keepModalMountedDuringClose, modalConfig])
  const confirmModal = React.useCallback<ConfirmModal>((config) => {
    setModalConfig(config)
    setModalOpen(true)
    return {
      destroy: closeModal,
      then: <T,>(resolve: (confirmed: boolean) => T, reject: VoidFunction) =>
        Promise.resolve(false).then(resolve, (error) => {
          reject()
          throw error
        }),
      update: () => undefined
    }
  }, [closeModal])
  const requestPermissionMode = usePermissionModeSelectionGuard({
    acknowledgementScope: { kind: 'ephemeral', lifecycle },
    confirmModal,
    onSelect: () => ({ accepted: true, completion: Promise.resolve(false) }),
    permissionModeOptions: permissionOptions,
    scopeId,
    t: (key) => key
  })

  return (
    <>
      <textarea ref={editorRef} data-testid='permission-confirmation-editor' />
      <button
        type='button'
        data-testid='permission-confirmation-open'
        onClick={() =>
          requestPermissionMode('bypassPermissions', {
            onAfterConfirmationClose: () => editorRef.current?.focus()
          })}
      >
        Open confirmation
      </button>
      <button
        type='button'
        data-testid='permission-confirmation-change-scope'
        onClick={() => setScopeId('permission-confirmation-next-scope')}
      >
        Change scope
      </button>
      {modalConfig != null && (
        <ConfigProvider
          theme={{
            token: {
              colorBgElevated: '#ffffff',
              colorText: '#1f2328',
              colorTextSecondary: '#57606a'
            }
          }}
        >
          <Modal
            open={modalOpen}
            getContainer={false}
            className={modalConfig.className}
            footer={modalConfig.footer}
            modalRender={modalConfig.modalRender}
            cancelButtonProps={{
              ...modalConfig.cancelButtonProps,
              autoFocus: modalConfig.autoFocusButton === 'cancel'
            }}
            cancelText={modalConfig.cancelText}
            okButtonProps={{
              ...modalConfig.okButtonProps,
              autoFocus: modalConfig.autoFocusButton === 'ok'
            }}
            okText={modalConfig.okText}
            okType={modalConfig.okType}
            title={modalConfig.title}
            onCancel={(event) => {
              modalConfig.onCancel?.(event)
              closeModal()
            }}
            onOk={() => modalConfig.onOk?.()}
          >
            {modalConfig.content}
            {cancelDisabled && <Button data-testid='disabled-ant-cancel' disabled>common.cancel</Button>}
          </Modal>
        </ConfigProvider>
      )}
    </>
  )
}

function ReopenPermissionConfirmationHarness() {
  const editorRef = React.useRef<HTMLTextAreaElement>(null)
  const lifecycle = React.useRef(createDraftPermissionModeLifecycle()).current
  const confirmationId = React.useRef(0)
  const [entries, setEntries] = React.useState<
    Array<{
      config: Parameters<ConfirmModal>[0]
      id: number
      open: boolean
    }>
  >([])
  const confirmModal = React.useCallback<ConfirmModal>((config) => {
    const id = ++confirmationId.current
    setEntries(current => [...current, { config, id, open: true }])
    return {
      destroy: () => {
        setEntries(current =>
          current.map(entry =>
            entry.id === id
              ? { ...entry, open: false }
              : entry
          )
        )
      },
      then: <T,>(resolve: (confirmed: boolean) => T, reject: VoidFunction) =>
        Promise.resolve(false).then(resolve, error => {
          reject()
          throw error
        }),
      update: () => undefined
    }
  }, [])
  const requestPermissionMode = usePermissionModeSelectionGuard({
    acknowledgementScope: { kind: 'ephemeral', lifecycle },
    confirmModal,
    onSelect: () => ({ accepted: true, completion: Promise.resolve(false) }),
    permissionModeOptions: permissionOptions,
    scopeId: 'permission-confirmation-reopen',
    t: key => key
  })
  const openConfirmation = () =>
    requestPermissionMode('bypassPermissions', {
      onAfterConfirmationClose: () => editorRef.current?.focus()
    })

  return (
    <>
      <textarea ref={editorRef} data-testid='reopen-editor' />
      <button type='button' data-testid='reopen-open-a' onClick={openConfirmation}>Open A</button>
      <button type='button' data-testid='reopen-open-b' onClick={openConfirmation}>Open B</button>
      {entries.map(entry => (
        <div key={entry.id} data-testid={`reopen-entry-${entry.id}`}>
          <ConfigProvider
            theme={{
              token: {
                colorBgElevated: '#ffffff',
                colorText: '#1f2328',
                colorTextSecondary: '#57606a'
              }
            }}
          >
            <Modal
              open={entry.open}
              getContainer={false}
              className={entry.config.className}
              footer={entry.config.footer}
              modalRender={entry.config.modalRender}
              cancelButtonProps={{
                ...entry.config.cancelButtonProps,
                autoFocus: entry.config.autoFocusButton === 'cancel'
              }}
              cancelText={entry.config.cancelText}
              okButtonProps={{
                ...entry.config.okButtonProps,
                autoFocus: entry.config.autoFocusButton === 'ok'
              }}
              okText={entry.config.okText}
              okType={entry.config.okType}
              title={entry.config.title}
              onCancel={(event) => entry.config.onCancel?.(event)}
              onOk={() => entry.config.onOk?.()}
            >
              {entry.config.content}
            </Modal>
          </ConfigProvider>
          <button
            type='button'
            data-testid={`reopen-finish-exit-${entry.id}`}
            onClick={() => entry.config.afterClose?.()}
          >
            Finish exit {entry.id}
          </button>
        </div>
      ))}
    </>
  )
}

const findByTestId = (root: ReactHostElement, testId: string) =>
  findReactHostElement(root, element => element.getAttribute('data-testid') === testId)

const findButton = (root: ReactHostElement, text: string) =>
  findReactHostElement(root, element => element.tagName === 'BUTTON' && element.textContent === text)

const findFocusTrapEndpoints = (modal: ReactHostElement | undefined) => {
  const endpoints = modal?.children.filter(
    element => element.tagName === 'DIV' && element.getAttribute('tabindex') === '0'
  ) ?? []
  return { end: endpoints.at(-1), start: endpoints[0] }
}

const mount = async ({
  cancelDisabled = false,
  deferAnimationFrames = false,
  keepModalMountedDuringClose = false
}: {
  cancelDisabled?: boolean
  deferAnimationFrames?: boolean
  keepModalMountedDuringClose?: boolean
} = {}) => {
  const host = installReactMountedTestHost({ deferAnimationFrames })
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: new MemoryStorage()
  })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () =>
    root.render(
      <PermissionConfirmationHarness
        cancelDisabled={cancelDisabled}
        keepModalMountedDuringClose={keepModalMountedDuringClose}
      />
    )
  )
  return {
    act,
    container: host.container,
    document: host.document,
    flushAnimationFrames: host.flushAnimationFrames,
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
}

const mountReopen = async () => {
  const host = installReactMountedTestHost()
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: new MemoryStorage()
  })
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(host.container as unknown as Element)
  await act(async () => root.render(<ReopenPermissionConfirmationHarness />))
  return {
    act,
    container: host.container,
    document: host.document,
    unmount: async () => {
      await act(async () => root.unmount())
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('permission mode confirmation modal', () => {
  it('uses the paired product surface/text tokens for default and neo-workshop themes', () => {
    const styles = readFileSync(
      new URL(
        '../src/components/chat/sender/@components/permission-mode-control/PermissionModeControl.scss',
        import.meta.url
      ),
      'utf8'
    )
    const guardSource = readFileSync(
      new URL('../src/hooks/chat/use-permission-mode-selection-guard.tsx', import.meta.url),
      'utf8'
    )
    const neoWorkshopStyles = readFileSync(
      new URL('../../../packages/plugins/neo-workshop-theme/client/src/theme.css', import.meta.url),
      'utf8'
    )
    const defaultThemeStyles = readFileSync(
      new URL('../../../packages/route-layout/src/design-tokens.css', import.meta.url),
      'utf8'
    )
    const channel = (color: string) => Number.parseInt(color, 16) / 255
    const luminance = (hex: string) => {
      const channels = hex.match(/[\da-f]{2}/gi)?.map(channel)
      if (channels == null || channels.length !== 3) throw new Error(`Invalid color: ${hex}`)
      return channels
        .map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((result, value, index) => result + value * [0.2126, 0.7152, 0.0722][index]!, 0)
    }
    const contrast = (foreground: string, background: string) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      return (lighter + .05) / (darker + .05)
    }

    expect(styles).toContain('.sender-permission-confirm-modal')
    expect(styles).toContain('--sender-permission-confirm-surface: var(--bg-color);')
    expect(styles).toContain('--sender-permission-confirm-text: var(--text-color);')
    expect(styles).toContain('background: var(--sender-permission-confirm-surface) !important;')
    expect(styles).toContain('color: var(--sender-permission-confirm-text) !important;')
    expect(styles).toContain('--sender-permission-confirm-impact-text: var(--sub-text-color);')
    expect(styles).not.toContain('opacity: .72;')
    expect(styles).not.toContain('.ant-modal-confirm-btns .ant-btn:not(.ant-btn-primary)')
    expect(styles).not.toContain('sender-permission-confirmation__secondary-action')
    expect(guardSource).toContain('components: {')
    expect(guardSource).toContain("defaultBg: 'var(--sender-permission-confirm-surface)'")
    expect(guardSource).toContain("defaultColor: 'var(--sender-permission-confirm-text)'")
    expect(guardSource).not.toContain('defaultHoverColor')
    expect(guardSource).not.toContain('defaultActiveColor')
    expect(defaultThemeStyles).toContain('--bg-color: #ffffff;')
    expect(defaultThemeStyles).toContain('--text-color: #000000;')
    expect(defaultThemeStyles).toContain('--sub-text-color: #1b1b1b;')
    expect(defaultThemeStyles).toContain('--bg-color: #141414;')
    expect(defaultThemeStyles).toContain('--text-color: #ffffff;')
    expect(defaultThemeStyles).toContain('--sub-text-color: #8c8c8c;')
    expect(neoWorkshopStyles).toContain(
      "html[data-oneworks-theme-pack='neo-workshop'][data-oneworks-theme-pack-overrides~='palette'].dark"
    )
    expect(neoWorkshopStyles).toContain('--bg-color: #171411;')
    expect(neoWorkshopStyles).toContain('--text-color: #fff7e5;')
    expect(neoWorkshopStyles).toContain('--sub-text-color: #c5b9a5;')

    for (
      const theme of [
        { body: '#000000', cancel: '#000000', impact: '#1b1b1b', surface: '#ffffff' },
        { body: '#ffffff', cancel: '#ffffff', impact: '#8c8c8c', surface: '#141414' },
        { body: '#141111', cancel: '#141111', impact: '#5f5548', surface: '#fff8e7' },
        { body: '#fff7e5', cancel: '#fff7e5', impact: '#c5b9a5', surface: '#171411' }
      ]
    ) {
      expect(contrast(theme.cancel, theme.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.impact, theme.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.body, theme.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses Ant dialog surface ownership and fully cycles its real action buttons before restoring focus', async () => {
    const mounted = await mount()
    const editor = findByTestId(mounted.container, 'permission-confirmation-editor')
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    editor?.focus()
    await mounted.act(async () => opener?.click())

    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const cancel = findButton(mounted.container, 'common.cancel')
    const confirm = findButton(mounted.container, 'chat.permissionModes.confirmation.confirm')
    expect(modal?.getAttribute('class')).toContain('ant-modal')
    expect(modal?.textContent).toContain('Bypass permissions')
    expect(cancel).toBeDefined()
    expect(confirm).toBeDefined()
    expect(cancel?.getAttribute('class')).toContain('ant-btn-default')
    expect(confirm?.getAttribute('class')).toContain('ant-btn-dangerous')
    expect(mounted.document.activeElement).toBe(cancel)
    if (confirm == null) throw new Error('Expected confirmation action')

    const assertTabMovesFocus = async (
      source: ReactHostElement | undefined,
      target: ReactHostElement | undefined,
      shiftKey = false
    ) => {
      source?.focus()
      await mounted.act(async () => {
        if (source != null) dispatchReactHostEvent(source, 'keydown', { key: 'Tab', shiftKey })
      })
      expect(mounted.document.activeElement).toBe(target)
    }
    await assertTabMovesFocus(cancel, confirm)
    await assertTabMovesFocus(confirm, cancel)
    await assertTabMovesFocus(confirm, cancel, true)
    await assertTabMovesFocus(cancel, confirm, true)
    expect(dispatchReactHostEvent(confirm, 'keydown', { key: 'Enter' })).toBe(true)

    const wrapper = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('ant-modal-wrap') === true
    )
    await mounted.act(async () => {
      if (wrapper != null) dispatchReactHostEvent(wrapper, 'keydown', { key: 'Escape', keyCode: 27 })
    })
    expect(mounted.document.activeElement).toBe(editor)
    await mounted.unmount()
  })

  it('preserves Ant button states and leaves future footer shapes to the dialog focus trap', async () => {
    const mounted = await mount()
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    await mounted.act(async () => opener?.click())

    const cancel = findButton(mounted.container, 'common.cancel')
    const confirm = findButton(mounted.container, 'chat.permissionModes.confirmation.confirm')
    const actions = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirmation__actions') === true
    )
    if (cancel == null || confirm == null || actions == null) throw new Error('Expected modal actions')

    const thirdButton = mounted.document.createElement('button')
    actions.appendChild(thirdButton)
    cancel.focus()
    expect(dispatchReactHostEvent(cancel, 'keydown', { key: 'Tab' })).toBe(true)
    expect(mounted.document.activeElement).toBe(cancel)
    actions.removeChild(thirdButton)

    const futureInput = mounted.document.createElement('input')
    actions.appendChild(futureInput)
    cancel.focus()
    expect(dispatchReactHostEvent(cancel, 'keydown', { key: 'Tab' })).toBe(true)
    expect(mounted.document.activeElement).toBe(cancel)
    actions.removeChild(futureInput)
    await mounted.unmount()

    const disabledMounted = await mount({ cancelDisabled: true })
    const disabledOpener = findByTestId(disabledMounted.container, 'permission-confirmation-open')
    await disabledMounted.act(async () => disabledOpener?.click())
    const disabledAntCancel = findByTestId(disabledMounted.container, 'disabled-ant-cancel')
    expect([disabledAntCancel?.disabled, disabledAntCancel?.hasAttribute('disabled')]).toContain(true)

    const disabledActions = findReactHostElement(
      disabledMounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirmation__actions') === true
    )
    const disabledCancel = disabledActions == null
      ? undefined
      : findButton(disabledActions, 'common.cancel')
    const disabledConfirm = disabledActions == null
      ? undefined
      : findButton(disabledActions, 'chat.permissionModes.confirmation.confirm')
    if (disabledCancel == null) throw new Error('Expected cancellation action')
    disabledCancel.disabled = true
    disabledCancel.setAttribute('disabled', '')
    disabledConfirm?.focus()
    if (disabledConfirm == null) throw new Error('Expected enabled confirmation action')
    expect(dispatchReactHostEvent(disabledConfirm, 'keydown', { key: 'Tab' })).toBe(true)
    expect(disabledMounted.document.activeElement).toBe(disabledConfirm)
    await disabledMounted.unmount()
  })

  it('normalizes compact overlay trap focus after open and guards its first Tab', async () => {
    const mounted = await mount({ deferAnimationFrames: true })
    const editor = findByTestId(mounted.container, 'permission-confirmation-editor')
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    editor?.focus()
    await mounted.act(async () => opener?.click())

    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const cancel = findButton(mounted.container, 'common.cancel')
    const { start: sentinel } = findFocusTrapEndpoints(modal)
    if (cancel == null || sentinel == null) throw new Error('Expected mounted Ant focus trap and cancel action')

    // This models the compact overlay's final focus restoration landing on the
    // already-open modal trap after Ant has applied autoFocusButton.
    sentinel.focus()
    await mounted.act(async () => {
      mounted.flushAnimationFrames()
      mounted.flushAnimationFrames()
    })
    expect(mounted.document.activeElement).toBe(cancel)
    await mounted.unmount()

    const pendingMounted = await mount({ deferAnimationFrames: true })
    const pendingOpener = findByTestId(pendingMounted.container, 'permission-confirmation-open')
    await pendingMounted.act(async () => pendingOpener?.click())
    const pendingModal = findReactHostElement(
      pendingMounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const pendingCancel = findButton(pendingMounted.container, 'common.cancel')
    const { start: pendingSentinel } = findFocusTrapEndpoints(pendingModal)
    if (pendingCancel == null || pendingSentinel == null) throw new Error('Expected pending Ant focus trap')
    pendingSentinel.focus()
    expect(dispatchReactHostEvent(pendingSentinel, 'keydown', { key: 'Tab' })).toBe(false)
    expect(pendingMounted.document.activeElement).toBe(pendingCancel)
    await pendingMounted.unmount()
    pendingMounted.flushAnimationFrames()
    expect(pendingMounted.document.activeElement).toBe(pendingCancel)

    const scopeMounted = await mount({ deferAnimationFrames: true })
    const scopeOpener = findByTestId(scopeMounted.container, 'permission-confirmation-open')
    await scopeMounted.act(async () => scopeOpener?.click())
    const scopeModal = findReactHostElement(
      scopeMounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const scopeCancel = findButton(scopeMounted.container, 'common.cancel')
    const { start: scopeSentinel } = findFocusTrapEndpoints(scopeModal)
    const scopeChange = findByTestId(scopeMounted.container, 'permission-confirmation-change-scope')
    if (scopeCancel == null || scopeSentinel == null) throw new Error('Expected scope-bound focus trap')
    scopeSentinel.focus()
    await scopeMounted.act(async () => scopeChange?.click())
    scopeMounted.flushAnimationFrames()
    scopeMounted.flushAnimationFrames()
    expect(scopeMounted.document.activeElement).not.toBe(scopeCancel)
    await scopeMounted.unmount()
  })

  it('redirects only a bounded late compact-overlay sentinel focus', async () => {
    const mounted = await mount({ deferAnimationFrames: true })
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    await mounted.act(async () => opener?.click())
    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const content = modal == null
      ? undefined
      : findReactHostElement(
        modal,
        element => element.getAttribute('class')?.includes('ant-modal-content') === true
      )
    const cancel = findButton(mounted.container, 'common.cancel')
    const confirm = findButton(mounted.container, 'chat.permissionModes.confirmation.confirm')
    const { start: sentinel } = findFocusTrapEndpoints(modal)
    if (content == null || cancel == null || confirm == null || sentinel == null) {
      throw new Error('Expected mounted compact confirmation focus controls')
    }

    await mounted.act(async () => {
      mounted.flushAnimationFrames()
      mounted.flushAnimationFrames()
    })
    expect(mounted.document.activeElement).toBe(cancel)

    // Drawer cleanup can run after the original post-open rAF pair.
    sentinel.focus()
    expect(dispatchReactHostEvent(sentinel, 'focusin')).toBe(true)
    expect(mounted.document.activeElement).toBe(cancel)

    // A real later footer move disarms the bounded correction window.
    cancel.focus()
    expect(dispatchReactHostEvent(cancel, 'keydown', { key: 'Tab' })).toBe(false)
    expect(mounted.document.activeElement).toBe(confirm)
    expect(dispatchReactHostEvent(confirm, 'focusin')).toBe(true)
    sentinel.focus()
    expect(dispatchReactHostEvent(sentinel, 'focusin')).toBe(true)
    expect(mounted.document.activeElement).toBe(sentinel)

    const rolelessTabIndex = mounted.document.createElement('div')
    rolelessTabIndex.setAttribute('tabindex', '0')
    content.appendChild(rolelessTabIndex)
    rolelessTabIndex.focus()
    expect(dispatchReactHostEvent(rolelessTabIndex, 'focusin')).toBe(true)
    expect(mounted.document.activeElement).toBe(rolelessTabIndex)
    await mounted.unmount()
  })

  it('consumes the compact overlay focus window once and disarms it for user focus or timeout', async () => {
    useConfirmationFakeTimerQueue()
    const mounted = await mount({ deferAnimationFrames: true })
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    await mounted.act(async () => opener?.click())
    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const cancel = findButton(mounted.container, 'common.cancel')
    const { start: sentinel } = findFocusTrapEndpoints(modal)
    if (cancel == null || sentinel == null) throw new Error('Expected compact confirmation controls')

    // Advance the actual fake-timer queue through the compact Drawer cleanup
    // interval, rather than invoking the confirmation timeout callback.
    await mounted.act(async () => vi.advanceTimersByTimeAsync(75))
    // Drawer cleanup at ~75ms: first exact sentinel correction wins.
    sentinel.focus()
    expect(dispatchReactHostEvent(sentinel, 'focusin')).toBe(true)
    expect(mounted.document.activeElement).toBe(cancel)
    // The same endpoint is no longer stolen after the one-shot is consumed.
    sentinel.focus()
    expect(dispatchReactHostEvent(sentinel, 'focusin')).toBe(true)
    expect(mounted.document.activeElement).toBe(sentinel)
    await mounted.unmount()

    const userFocusMounted = await mount({ deferAnimationFrames: true })
    const userFocusOpener = findByTestId(userFocusMounted.container, 'permission-confirmation-open')
    await userFocusMounted.act(async () => userFocusOpener?.click())
    const userFocusModal = findReactHostElement(
      userFocusMounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const userFocusContent = userFocusModal == null
      ? undefined
      : findReactHostElement(
        userFocusModal,
        element => element.getAttribute('class')?.includes('ant-modal-content') === true
      )
    const { start: userFocusSentinel } = findFocusTrapEndpoints(userFocusModal)
    if (userFocusContent == null || userFocusSentinel == null) throw new Error('Expected user-focus modal')
    const rolelessTabIndex = userFocusMounted.document.createElement('div')
    rolelessTabIndex.setAttribute('tabindex', '0')
    userFocusContent.appendChild(rolelessTabIndex)
    rolelessTabIndex.focus()
    expect(dispatchReactHostEvent(rolelessTabIndex, 'focusin')).toBe(true)
    userFocusSentinel.focus()
    expect(dispatchReactHostEvent(userFocusSentinel, 'focusin')).toBe(true)
    expect(userFocusMounted.document.activeElement).toBe(userFocusSentinel)
    userFocusMounted.flushAnimationFrames()
    userFocusMounted.flushAnimationFrames()
    expect(userFocusMounted.document.activeElement).toBe(userFocusSentinel)
    await userFocusMounted.unmount()

    const timeoutMounted = await mount({ deferAnimationFrames: true })
    const timeoutOpener = findByTestId(timeoutMounted.container, 'permission-confirmation-open')
    await timeoutMounted.act(async () => timeoutOpener?.click())
    const timeoutModal = findReactHostElement(
      timeoutMounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const { start: timeoutSentinel } = findFocusTrapEndpoints(timeoutModal)
    if (timeoutSentinel == null) throw new Error('Expected timeout modal')
    await timeoutMounted.act(async () => vi.advanceTimersByTimeAsync(161))
    timeoutMounted.flushAnimationFrames()
    timeoutMounted.flushAnimationFrames()
    timeoutSentinel.focus()
    expect(dispatchReactHostEvent(timeoutSentinel, 'focusin')).toBe(true)
    expect(timeoutMounted.document.activeElement).toBe(timeoutSentinel)
    await timeoutMounted.unmount()
  })

  it('only redirects real Ant trap endpoints and preserves other tabindex controls', async () => {
    for (
      const direction of [
        { endpoint: 'start', expected: 'common.cancel', shiftKey: false },
        { endpoint: 'start', expected: 'chat.permissionModes.confirmation.confirm', shiftKey: true },
        { endpoint: 'end', expected: 'common.cancel', shiftKey: false },
        { endpoint: 'end', expected: 'chat.permissionModes.confirmation.confirm', shiftKey: true }
      ] as const
    ) {
      const mounted = await mount({ deferAnimationFrames: true })
      const opener = findByTestId(mounted.container, 'permission-confirmation-open')
      await mounted.act(async () => opener?.click())
      const modal = findReactHostElement(
        mounted.container,
        element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
      )
      const endpoints = findFocusTrapEndpoints(modal)
      const endpoint = endpoints[direction.endpoint]
      const expected = findButton(mounted.container, direction.expected)
      if (endpoint == null || expected == null) throw new Error('Expected Ant focus endpoints and actions')
      endpoint.focus()
      expect(dispatchReactHostEvent(endpoint, 'keydown', { key: 'Tab', shiftKey: direction.shiftKey })).toBe(false)
      expect(mounted.document.activeElement).toBe(expected)
      await mounted.unmount()
    }

    const mounted = await mount({ deferAnimationFrames: true })
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    await mounted.act(async () => opener?.click())
    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const content = modal == null
      ? undefined
      : findReactHostElement(
        modal,
        element => element.getAttribute('class')?.includes('ant-modal-content') === true
      )
    const cancel = findButton(mounted.container, 'common.cancel')
    if (content == null || cancel == null) throw new Error('Expected modal content and cancellation action')
    const rolelessTabIndex = mounted.document.createElement('div')
    rolelessTabIndex.setAttribute('tabindex', '0')
    content.appendChild(rolelessTabIndex)
    rolelessTabIndex.focus()
    await mounted.act(async () => {
      mounted.flushAnimationFrames()
      mounted.flushAnimationFrames()
    })
    expect(mounted.document.activeElement).toBe(rolelessTabIndex)
    expect(dispatchReactHostEvent(rolelessTabIndex, 'keydown', { key: 'Tab' })).toBe(true)
    expect(mounted.document.activeElement).not.toBe(cancel)
    await mounted.unmount()
  })

  it('synchronously deactivates the exact focus lifecycle before close or transition work', async () => {
    for (const trigger of ['cancel', 'ok', 'escape', 'scope'] as const) {
      const mounted = await mount({
        deferAnimationFrames: true,
        keepModalMountedDuringClose: true
      })
      const opener = findByTestId(mounted.container, 'permission-confirmation-open')
      await mounted.act(async () => opener?.click())
      const modal = findReactHostElement(
        mounted.container,
        element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
      )
      const { start } = findFocusTrapEndpoints(modal)
      const cancel = findButton(mounted.container, 'common.cancel')
      const confirm = findButton(mounted.container, 'chat.permissionModes.confirmation.confirm')
      const wrapper = findReactHostElement(
        mounted.container,
        element => element.getAttribute('class')?.includes('ant-modal-wrap') === true
      )
      const scopeChange = findByTestId(mounted.container, 'permission-confirmation-change-scope')
      if (start == null || cancel == null || confirm == null || wrapper == null) {
        throw new Error('Expected mounted Ant confirmation lifecycle')
      }

      // rAF1 has already run and rAF2 remains pending, matching the compact
      // overlay close window where stale focus used to land late.
      mounted.flushAnimationFrames()
      start.focus()
      await mounted.act(async () => {
        if (trigger === 'cancel') cancel.click()
        if (trigger === 'ok') confirm.click()
        if (trigger === 'escape') dispatchReactHostEvent(wrapper, 'keydown', { key: 'Escape', keyCode: 27 })
        if (trigger === 'scope') scopeChange?.click()
      })
      expect(dispatchReactHostEvent(start, 'keydown', { key: 'Tab' }), trigger).toBe(true)
      mounted.flushAnimationFrames()
      expect(mounted.document.activeElement).not.toBe(cancel)
      await mounted.unmount()
    }

    const mounted = await mount({ deferAnimationFrames: true })
    const opener = findByTestId(mounted.container, 'permission-confirmation-open')
    await mounted.act(async () => opener?.click())
    const modal = findReactHostElement(
      mounted.container,
      element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
    )
    const { start } = findFocusTrapEndpoints(modal)
    const cancel = findButton(mounted.container, 'common.cancel')
    if (start == null || cancel == null) throw new Error('Expected mounted unmount focus lifecycle')
    mounted.flushAnimationFrames()
    start.focus()
    await mounted.unmount()
    mounted.flushAnimationFrames()
    expect(mounted.document.activeElement).not.toBe(cancel)
  })

  it('does not let a delayed older afterClose steal focus from a reopened confirmation', async () => {
    const mounted = await mountReopen()
    const editor = findByTestId(mounted.container, 'reopen-editor')
    const openA = findByTestId(mounted.container, 'reopen-open-a')
    const openB = findByTestId(mounted.container, 'reopen-open-b')
    editor?.focus()
    await mounted.act(async () => openA?.click())

    const entryA = findByTestId(mounted.container, 'reopen-entry-1')
    const cancelA = entryA == null ? undefined : findButton(entryA, 'common.cancel')
    if (cancelA == null) throw new Error('Expected confirmation A')
    await mounted.act(async () => cancelA.click())
    await mounted.act(async () => openB?.click())

    const entryB = findByTestId(mounted.container, 'reopen-entry-2')
    const cancelB = entryB == null ? undefined : findButton(entryB, 'common.cancel')
    const modalB = entryB == null
      ? undefined
      : findReactHostElement(
        entryB,
        element => element.getAttribute('class')?.includes('sender-permission-confirm-modal') === true
      )
    const { start: sentinelB } = findFocusTrapEndpoints(modalB)
    const finishA = findByTestId(mounted.container, 'reopen-finish-exit-1')
    if (cancelB == null || sentinelB == null) throw new Error('Expected confirmation B')
    cancelB.focus()
    await mounted.act(async () => finishA?.click())
    expect(mounted.document.activeElement).toBe(cancelB)

    // The old close must not clear or deactivate B: B's scoped sentinel still
    // captures Tab and routes it through the live confirmation boundary.
    sentinelB.focus()
    expect(dispatchReactHostEvent(sentinelB, 'keydown', { key: 'Tab' })).toBe(false)
    expect(mounted.document.activeElement).toBe(cancelB)

    await mounted.act(async () => cancelB.click())
    const finishB = findByTestId(mounted.container, 'reopen-finish-exit-2')
    await mounted.act(async () => finishB?.click())
    expect(mounted.document.activeElement).toBe(editor)
    await mounted.unmount()
  })
})
