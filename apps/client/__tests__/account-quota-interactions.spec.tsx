// @vitest-environment happy-dom
/* eslint-disable max-lines -- mounted desktop/mobile overlay and stale-quota interactions share one DOM harness. */
import type { ReactElement, ReactNode, Ref } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import { AccountQuotaModal } from '#~/components/chat/sender/@components/account-select/AccountQuotaModal'
import { AccountSelectControl } from '#~/components/chat/sender/@components/account-select/AccountSelectControl'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'

const testState = vi.hoisted(() => ({
  compact: false,
  createOperationId: vi.fn(),
  detailError: undefined as unknown,
  detailMutate: vi.fn(),
  detailValidating: false,
  listMutate: vi.fn(),
  manageAccount: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  navigate: vi.fn(),
  quota: undefined as AdapterAccountQuotaInfo | undefined,
  renderEvents: [] as string[],
  desktopCloseCompletions: [] as Array<() => void>,
  mobileCloseCompletions: [] as Array<() => void>,
  modalCloseCompletions: [] as Array<() => void>
}))

vi.mock('antd', async () => {
  const { useEffect, useRef, useState } = await import('react')

  return {
    App: {
      useApp: () => ({
        message: {
          error: testState.messageError,
          info: testState.messageInfo,
          success: testState.messageSuccess,
          warning: testState.messageWarning
        }
      })
    },
    Button: ({
      'aria-label': ariaLabel,
      children,
      className,
      disabled,
      icon,
      onClick
    }: {
      'aria-label'?: string
      children?: ReactNode
      className?: string
      disabled?: boolean
      icon?: ReactNode
      onClick?: () => void
    }) => (
      <button
        type='button'
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        {children}
      </button>
    ),
    Drawer: ({
      afterOpenChange,
      children,
      open
    }: {
      afterOpenChange?: (open: boolean) => void
      children?: ReactNode
      open?: boolean
    }) => {
      const activeRef = useRef(true)
      const latestAfterOpenChangeRef = useRef(afterOpenChange)
      const previousOpenRef = useRef(open)
      latestAfterOpenChangeRef.current = afterOpenChange
      useEffect(() => () => {
        activeRef.current = false
      }, [])
      if (previousOpenRef.current && !open) {
        testState.mobileCloseCompletions.push(() => {
          if (activeRef.current) {
            latestAfterOpenChangeRef.current?.(false)
          }
        })
      }
      previousOpenRef.current = open
      testState.renderEvents.push(open ? 'mobile-drawer-open' : 'mobile-drawer-closed')
      return open ? <div data-testid='mobile-drawer'>{children}</div> : null
    },
    Modal: ({
      afterClose,
      children,
      onCancel,
      open,
      title
    }: {
      afterClose?: () => void
      children?: ReactNode
      onCancel?: () => void
      open?: boolean
      title?: ReactNode
    }) => {
      const previousOpenRef = useRef(open)
      const closingRef = useRef(false)
      const [, setCloseRevision] = useState(0)
      if (open) {
        closingRef.current = false
      } else if (previousOpenRef.current) {
        closingRef.current = true
        testState.modalCloseCompletions.push(() => {
          closingRef.current = false
          afterClose?.()
          setCloseRevision(revision => revision + 1)
        })
      }
      previousOpenRef.current = open
      if (open) testState.renderEvents.push('quota-modal-open')
      return open || closingRef.current
        ? (
          <div
            role='dialog'
            aria-label={typeof title === 'string' ? title : undefined}
            data-testid='quota-modal'
          >
            <button type='button' aria-label='close-modal' onClick={onCancel}>close</button>
            {children}
          </div>
        )
        : null
    },
    Popconfirm: ({
      children,
      disabled,
      onConfirm
    }: {
      children?: ReactNode
      disabled?: boolean
      onConfirm?: () => Promise<void> | void
    }) => {
      const [open, setOpen] = useState(false)

      return (
        <span>
          <span
            data-testid='popconfirm-trigger'
            onClick={() => {
              if (disabled !== true) setOpen(true)
            }}
          >
            {children}
          </span>
          {open && (
            <span data-testid='popconfirm-panel'>
              <button
                type='button'
                aria-label='cancel-reset-credit'
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                }}
              >
                cancel
              </button>
              <button
                type='button'
                aria-label='confirm-reset-credit'
                onClick={(event) => {
                  event.stopPropagation()
                  void Promise.resolve(onConfirm?.()).then(() => setOpen(false))
                }}
              >
                confirm
              </button>
            </span>
          )}
        </span>
      )
    },
    Spin: () => <span>loading</span>,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('#~/api', () => ({
  createAdapterAccountOperationId: testState.createOperationId,
  getAdapterAccountDetail: vi.fn(),
  getAdapterAccounts: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  manageAdapterAccount: testState.manageAccount
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', async () => {
  const { useRef } = await import('react')

  return {
    MobileAwareSelect: ({
      disabled,
      controlTrigger,
      onOpenChange,
      onPopupCloseComplete,
      open,
      optionRender,
      options,
      popupCloseKey
    }: {
      controlTrigger?: { ref?: Ref<HTMLButtonElement> }
      disabled?: boolean
      onOpenChange?: (open: boolean) => void
      onPopupCloseComplete?: (closeKey: number | string | undefined) => void
      open?: boolean
      optionRender?: (option: { data: unknown }) => ReactNode
      options?: unknown[]
      popupCloseKey?: number | string
    }) => {
      const previousOpenRef = useRef(open)
      if (previousOpenRef.current && !open) {
        const closeKey = popupCloseKey
        testState.desktopCloseCompletions.push(() => onPopupCloseComplete?.(closeKey))
      }
      previousOpenRef.current = open
      testState.renderEvents.push(open ? 'desktop-select-open' : 'desktop-select-closed')
      return (
        <div>
          <button
            ref={controlTrigger?.ref}
            type='button'
            data-testid='desktop-select-trigger'
            disabled={disabled}
            onClick={() => onOpenChange?.(!open)}
          >
            account
          </button>
          {open && (
            <div data-testid='desktop-select-popup'>
              {options?.map((option, index) => (
                <div key={index}>{optionRender?.({ data: option })}</div>
              ))}
            </div>
          )}
        </div>
      )
    }
  }
})

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: testState.compact,
    isTouchInteraction: false
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.accountQuota': 'Account quota',
      'chat.accountQuotaModal.available': '1 available',
      'chat.accountQuotaModal.refreshFailed': 'Could not refresh quota.',
      'chat.accountQuotaModal.refreshing': 'Refreshing quota.',
      'chat.accountQuotaModal.retryRefresh': 'Retry quota refresh',
      'chat.accountQuotaModal.stale': 'Quota eligibility is stale.',
      'chat.accountQuotaModal.title': 'Usage',
      'chat.accountQuotaModal.weekly': 'Usage limits',
      'chat.accountSelectPlaceholder': 'Account',
      'common.cancel': 'Cancel',
      'config.accounts.resetCredits.confirmAction': 'Use credit',
      'config.accounts.resetCredits.confirmDescription': 'Spend one credit.',
      'config.accounts.resetCredits.confirmTitle': 'Use reset credit?',
      'config.accounts.resetCredits.fullResetTitle': 'Full reset',
      'config.accounts.resetCredits.outcomes.reset': 'Reset credit used.',
      'config.accounts.resetCredits.refreshFailed': 'Refresh failed.',
      'config.accounts.resetCredits.title': 'Reset credits',
      'config.accounts.resetCredits.unavailable': 'Unavailable',
      'config.accounts.resetCredits.use': 'Use reset credit'
    }[key] ?? key)
  })
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => testState.navigate
}))

vi.mock('swr', () => ({
  default: (key: readonly string[] | null) => {
    if (Array.isArray(key) && key[0] === '/api/adapters/account-quota') {
      return {
        data: testState.quota == null
          ? undefined
          : {
            account: {
              key: key[2],
              title: String(key[2]),
              quota: testState.quota
            }
          },
        error: testState.detailError,
        isLoading: false,
        isValidating: testState.detailValidating,
        mutate: testState.detailMutate
      }
    }
    return {
      data: undefined,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn()
    }
  },
  useSWRConfig: () => ({ mutate: testState.listMutate })
}))

const accountOption: ChatAdapterAccountOption = {
  value: 'work',
  label: 'Work',
  quotaWindows: [
    {
      id: 'primary-usage',
      label: '5h',
      value: '48%',
      percent: 48,
      primary: true
    }
  ],
  quota: {
    metrics: [
      {
        id: 'primary-usage',
        label: '5h used',
        value: '48%',
        primary: true
      }
    ],
    rateLimitResetCredits: {
      availableCount: 1,
      canConsume: true,
      credits: [
        {
          id: 'credit-a',
          status: 'available',
          title: 'Full reset',
          expiresAt: 4102444800
        }
      ]
    }
  }
}

let container: HTMLDivElement
let root: Root

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      })
    )
  })
}

const flushNextTask = async () => {
  await act(async () => {
    await new Promise(resolve => globalThis.setTimeout(resolve, 0))
  })
}

const releaseOverlayClose = async (compact: boolean, index = 0) => {
  const completions = compact
    ? testState.mobileCloseCompletions
    : testState.desktopCloseCompletions
  const complete = completions.splice(index, 1)[0]
  expect(complete).toBeTypeOf('function')
  await act(async () => complete?.())
}

const renderAccountSelect = async () => {
  await act(async () => {
    root.render(
      <AccountSelectControl
        state={{
          isThinking: false,
          modelUnavailable: false,
          selectedAccount: 'work',
          selectedAdapter: 'codex',
          showAccountSelector: true
        }}
        data={{ accountOptions: [accountOption] }}
        handlers={{ onAccountChange: vi.fn() }}
      />
    )
  })
}

describe('account quota mounted interactions', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    testState.compact = false
    testState.createOperationId.mockReset()
    testState.createOperationId.mockReturnValue('operation-id')
    testState.detailError = undefined
    testState.detailMutate.mockReset()
    testState.detailMutate.mockResolvedValue(undefined)
    testState.detailValidating = false
    testState.listMutate.mockReset()
    testState.listMutate.mockResolvedValue(undefined)
    testState.manageAccount.mockReset()
    testState.messageError.mockReset()
    testState.messageInfo.mockReset()
    testState.messageSuccess.mockReset()
    testState.messageWarning.mockReset()
    testState.navigate.mockReset()
    testState.quota = accountOption.quota
    testState.renderEvents.length = 0
    testState.desktopCloseCompletions.length = 0
    testState.mobileCloseCompletions.length = 0
    testState.modalCloseCompletions.length = 0
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each([
    {
      compact: false,
      overlayTestId: 'desktop-select-popup',
      open: () => document.querySelector('[data-testid="desktop-select-trigger"]')
    },
    {
      compact: true,
      overlayTestId: 'mobile-drawer',
      open: () => document.querySelector('button[aria-label="Work"]')
    }
  ])('closes the account $overlayTestId before opening the lifted quota modal', async ({
    compact,
    open,
    overlayTestId
  }) => {
    testState.compact = compact
    await renderAccountSelect()
    await click(open())
    expect(document.querySelector(`[data-testid="${overlayTestId}"]`)).not.toBeNull()

    testState.renderEvents.length = 0
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(document.querySelector('[data-testid="quota-modal"]')).toBeNull()
    await releaseOverlayClose(compact)
    const modal = document.querySelector('[data-testid="quota-modal"]')
    const overlayClosedEvent = compact ? 'mobile-drawer-closed' : 'desktop-select-closed'
    const overlayClosedIndex = testState.renderEvents.indexOf(overlayClosedEvent)
    const modalOpenIndex = testState.renderEvents.indexOf('quota-modal-open')

    expect(overlayClosedIndex).toBeGreaterThanOrEqual(0)
    expect(modalOpenIndex).toBeGreaterThan(overlayClosedIndex)
    expect(modal).not.toBeNull()
    expect(document.querySelector(`[data-testid="${overlayTestId}"]`)).toBeNull()
    expect(modal?.closest(`[data-testid="${overlayTestId}"]`)).toBeNull()
  })

  it('cancels a stale desktop handoff when the selector reopens and rejects its close token', async () => {
    await renderAccountSelect()
    await click(document.querySelector('[data-testid="desktop-select-trigger"]'))
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(testState.desktopCloseCompletions).toHaveLength(1)

    await click(document.querySelector('[data-testid="desktop-select-trigger"]'))
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(testState.desktopCloseCompletions).toHaveLength(2)

    await releaseOverlayClose(false)
    expect(document.querySelector('[data-testid="quota-modal"]')).toBeNull()

    await releaseOverlayClose(false)
    expect(document.querySelector('[data-testid="quota-modal"]')).not.toBeNull()
  })

  it('rejects a stale mobile afterOpenChange token after a reopen and second close', async () => {
    testState.compact = true
    await renderAccountSelect()
    const trigger = document.querySelector('button[aria-label="Work"]')
    await click(trigger)
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(testState.mobileCloseCompletions).toHaveLength(1)

    await click(trigger)
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(testState.mobileCloseCompletions).toHaveLength(2)

    await releaseOverlayClose(true)
    expect(document.querySelector('[data-testid="quota-modal"]')).toBeNull()

    await releaseOverlayClose(true)
    expect(document.querySelector('[data-testid="quota-modal"]')).not.toBeNull()
  })

  it('uses mobile afterOpenChange(false), suppresses drawer focus reopen, and restores trigger focus after Modal close', async () => {
    testState.compact = true
    await renderAccountSelect()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Work"]')
    await click(trigger)
    await click(document.querySelector('button[aria-label="Account quota"]'))
    expect(testState.mobileCloseCompletions).toHaveLength(1)
    expect(document.querySelector('[data-testid="quota-modal"]')).toBeNull()

    await act(async () => {
      testState.mobileCloseCompletions.shift()?.()
      trigger?.focus()
    })
    expect(document.querySelector('[data-testid="mobile-drawer"]')).toBeNull()
    expect(document.querySelector('[data-testid="quota-modal"]')).not.toBeNull()

    await click(document.querySelector('button[aria-label="close-modal"]'))
    expect(document.querySelector('[data-testid="quota-modal"]')).not.toBeNull()
    expect(testState.modalCloseCompletions).toHaveLength(1)
    await act(async () => testState.modalCloseCompletions.shift()?.())

    expect(document.activeElement).toBe(trigger)
    expect(document.querySelector('[data-testid="mobile-drawer"]')).toBeNull()
    expect(document.querySelector('[data-testid="quota-modal"]')).toBeNull()
  })

  it('requires confirmation, invalidates cached account variants, and separates reset from refresh failure', async () => {
    testState.detailMutate.mockRejectedValueOnce(new Error('refresh failed'))
    testState.manageAccount.mockResolvedValue({
      outcome: 'reset',
      account: {
        key: 'work',
        title: 'Work',
        quota: accountOption.quota
      }
    })
    await act(async () => {
      root.render(
        <AccountQuotaModal
          adapter='codex'
          account='work'
          quota={accountOption.quota}
          trigger={<button type='button' aria-label='open-usage'>usage</button> as ReactElement}
        />
      )
    })

    await click(document.querySelector('button[aria-label="open-usage"]'))
    await click(document.querySelector('button[aria-label="Use reset credit"]'))
    expect(testState.manageAccount).not.toHaveBeenCalled()

    await click(document.querySelector('button[aria-label="cancel-reset-credit"]'))
    expect(document.querySelector('[data-testid="popconfirm-panel"]')).toBeNull()
    expect(testState.manageAccount).not.toHaveBeenCalled()

    await click(document.querySelector('button[aria-label="Use reset credit"]'))
    await click(document.querySelector('button[aria-label="confirm-reset-credit"]'))
    await flushNextTask()

    expect(testState.manageAccount).toHaveBeenCalledTimes(1)
    expect(testState.listMutate).toHaveBeenCalledOnce()
    const matchesCachedAccountVariant = testState.listMutate.mock.calls[0]?.[0] as (key: unknown) => boolean
    expect(matchesCachedAccountVariant(['/api/adapters/accounts', 'codex', 'gpt-5.6-sol'])).toBe(true)
    expect(matchesCachedAccountVariant(['/api/adapters/accounts', 'claude-code', 'claude-opus'])).toBe(false)
    expect(matchesCachedAccountVariant(['/api/adapters/accounts-quota', 'codex', 'gpt-5.6-sol'])).toBe(false)
    expect(testState.messageSuccess).toHaveBeenCalledWith('Reset credit used.')
    expect(testState.messageWarning).toHaveBeenCalledWith('Refresh failed.')
    expect(testState.messageError).not.toHaveBeenCalled()
  })

  it('keeps stale quota visible while disabling reset-credit consumption', async () => {
    testState.quota = undefined
    await act(async () => {
      root.render(
        <AccountQuotaModal
          adapter='codex'
          account='work'
          quota={accountOption.quota}
          trigger={<button type='button' aria-label='open-stale-usage'>usage</button> as ReactElement}
        />
      )
    })

    await click(document.querySelector('button[aria-label="open-stale-usage"]'))

    expect(document.body.textContent).toContain('Quota eligibility is stale.')
    expect(document.body.textContent).toContain('48%')
    expect(
      (document.querySelector('button[aria-label="Use reset credit"]') as HTMLButtonElement | null)?.disabled
    ).toBe(true)
    expect(document.querySelector('button[aria-label="Retry quota refresh"]')).not.toBeNull()
    expect(testState.manageAccount).not.toHaveBeenCalled()
  })

  it('shows refresh errors, keeps last-known quota, and retries without enabling consume', async () => {
    testState.detailError = new Error('refresh failed')
    testState.quota = undefined
    await act(async () => {
      root.render(
        <AccountQuotaModal
          adapter='codex'
          account='work'
          quota={accountOption.quota}
          trigger={<button type='button' aria-label='open-error-usage'>usage</button> as ReactElement}
        />
      )
    })

    await click(document.querySelector('button[aria-label="open-error-usage"]'))

    expect(document.body.textContent).toContain('Could not refresh quota.')
    expect(document.body.textContent).toContain('48%')
    expect(
      (document.querySelector('button[aria-label="Use reset credit"]') as HTMLButtonElement | null)?.disabled
    ).toBe(true)
    await click(document.querySelector('button[aria-label="Retry quota refresh"]'))
    expect(testState.detailMutate).toHaveBeenCalledTimes(1)
    expect(testState.manageAccount).not.toHaveBeenCalled()
  })

  it('adds a usable anonymous fallback when a detailed credit is terminal', async () => {
    testState.quota = {
      ...accountOption.quota,
      rateLimitResetCredits: {
        availableCount: 1,
        canConsume: true,
        credits: [
          {
            id: 'credit-redeemed',
            status: 'redeemed',
            title: 'Redeemed credit',
            expiresAt: 4102444800
          }
        ]
      }
    }
    await act(async () => {
      root.render(
        <AccountQuotaModal
          adapter='codex'
          account='work'
          quota={testState.quota}
          trigger={<button type='button' aria-label='open-partial-usage'>usage</button> as ReactElement}
        />
      )
    })

    await click(document.querySelector('button[aria-label="open-partial-usage"]'))
    const actions = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label="Use reset credit"]')
    )

    expect(document.body.textContent).toContain('Redeemed credit')
    expect(actions).toHaveLength(2)
    expect(actions[0]?.disabled).toBe(true)
    expect(actions[1]?.disabled).toBe(false)
  })
})
