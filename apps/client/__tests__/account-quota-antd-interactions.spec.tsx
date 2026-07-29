// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountQuotaModal } from '#~/components/chat/sender/@components/account-select/AccountQuotaModal'
import { AccountSelectControl } from '#~/components/chat/sender/@components/account-select/AccountSelectControl'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'

const testState = vi.hoisted(() => ({
  detailMutate: vi.fn(),
  listMutate: vi.fn(),
  manageAccount: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn()
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: {
          error: testState.messageError,
          info: testState.messageInfo,
          success: testState.messageSuccess,
          warning: testState.messageWarning
        }
      })
    }
  }
})

vi.mock('#~/api', () => ({
  createAdapterAccountOperationId: () => 'operation-id',
  getAdapterAccountDetail: vi.fn(),
  getAdapterAccounts: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  manageAdapterAccount: testState.manageAccount
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.accountQuotaModal.available': '1 available',
      'chat.accountQuotaModal.title': 'Usage',
      'chat.accountQuotaModal.weekly': 'Usage limits',
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

vi.mock('swr', () => ({
  default: (key: readonly string[] | null) => ({
    data: Array.isArray(key)
      ? {
        account: {
          key: key[2],
          title: String(key[2]),
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
      }
      : undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: testState.detailMutate
  }),
  useSWRConfig: () => ({ mutate: testState.listMutate })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({
    isCompactLayout: false,
    isTouchInteraction: false
  })
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

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

const flushInteraction = async () => {
  await act(async () => {
    await new Promise(resolve => globalThis.setTimeout(resolve, 0))
  })
}

const finishMotion = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(new Event('transitionend', { bubbles: true }))
    element?.dispatchEvent(new Event('animationend', { bubbles: true }))
  })
  await flushInteraction()
}

describe('account quota Ant Design interactions', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    testState.detailMutate.mockReset()
    testState.detailMutate.mockRejectedValueOnce(new Error('refresh failed'))
    testState.listMutate.mockReset()
    testState.listMutate.mockResolvedValue(undefined)
    testState.manageAccount.mockReset()
    testState.manageAccount.mockResolvedValue({
      outcome: 'reset',
      account: {
        key: 'work',
        title: 'Work'
      }
    })
    testState.messageError.mockReset()
    testState.messageInfo.mockReset()
    testState.messageSuccess.mockReset()
    testState.messageWarning.mockReset()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.querySelectorAll('.ant-modal-root, .ant-popover, .ant-select-dropdown').forEach(node => node.remove())
  })

  it('reports desktop Select close only after the real popup has committed its hidden state', async () => {
    const closeStates: Array<{
      callbackRevision: number
      closeKey: number | string | undefined
      hidden: boolean
    }> = []
    const renderSelect = async (open: boolean, revision: number) => {
      await act(async () => {
        root.render(
          <MobileAwareSelect<string>
            open={open}
            value='work'
            options={[{ label: `Work ${revision}`, value: 'work' }]}
            popupCloseKey={42}
            onPopupCloseComplete={(closeKey) => {
              const popup = document.querySelector<HTMLElement>('.oneworks-select-popup')
              closeStates.push({
                callbackRevision: revision,
                closeKey,
                hidden: popup == null ||
                  Array.from(popup.classList).some(className => className.endsWith('-select-dropdown-hidden'))
              })
            }}
          />
        )
      })
      await flushInteraction()
    }

    await renderSelect(true, 1)
    const popup = document.querySelector<HTMLElement>('.oneworks-select-popup')
    expect(popup).not.toBeNull()
    expect(Array.from(popup?.classList ?? [])).not.toContain('ant-select-dropdown-hidden')

    await renderSelect(true, 2)
    expect(closeStates).toHaveLength(0)
    await renderSelect(false, 3)
    expect(closeStates).toHaveLength(0)
    await renderSelect(false, 4)
    await finishMotion(document.querySelector('.oneworks-select-popup'))

    expect(closeStates).toEqual([{ callbackRevision: 4, closeKey: 42, hidden: true }])
  })

  it('hands a real desktop Select to the real Modal and restores focus after cancel', async () => {
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
          data={{
            accountOptions: [{
              value: 'work',
              label: 'Work',
              quotaWindows: [{
                id: 'primary-usage',
                label: '5h',
                value: '48%',
                percent: 48,
                primary: true
              }],
              quota: {
                metrics: [{
                  id: 'primary-usage',
                  label: '5h used',
                  value: '48%',
                  primary: true
                }]
              }
            }]
          }}
          handlers={{ onAccountChange: vi.fn() }}
        />
      )
    })

    const trigger = document.querySelector<HTMLButtonElement>('.sender-select-body-trigger')
    await act(async () => trigger?.focus())
    await click(trigger)
    expect(document.querySelector('.oneworks-select-popup')).not.toBeNull()

    await click(document.querySelector('button[aria-label="chat.accountQuota"]'))
    expect(document.querySelector('.ant-modal.account-quota-modal')).toBeNull()
    await flushInteraction()
    await finishMotion(document.querySelector('.oneworks-select-popup'))
    expect(document.querySelector('.ant-modal.account-quota-modal')).not.toBeNull()

    await click(document.querySelector('.ant-modal-close'))
    await flushInteraction()
    await finishMotion(document.querySelector('.ant-modal.account-quota-modal'))
    expect(document.activeElement).toBe(
      document.querySelector<HTMLButtonElement>('.sender-select-body-trigger')
    )
    expect(document.querySelector('.oneworks-select-popup:not(.ant-select-dropdown-hidden)')).toBeNull()
  })

  it('mounts the real modal and Popconfirm and consumes only after explicit confirmation', async () => {
    await act(async () => {
      root.render(
        <AccountQuotaModal
          adapter='codex'
          account='work'
          quota={{
            metrics: [
              {
                id: 'primary-usage',
                label: '5h used',
                value: '48%',
                primary: true
              }
            ]
          }}
          trigger={<button type='button' aria-label='open-usage'>usage</button>}
        />
      )
    })

    const quotaTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="open-usage"]')
    await act(async () => quotaTrigger?.focus())
    await click(quotaTrigger)
    expect(document.querySelector('.ant-modal.account-quota-modal')).not.toBeNull()

    await click(document.querySelector('button[aria-label="Use reset credit"]'))
    await flushInteraction()
    expect(document.querySelector('.ant-popconfirm')).not.toBeNull()
    expect(testState.manageAccount).not.toHaveBeenCalled()

    const findConfirmButton = (label: string) =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('.ant-popconfirm-buttons button')
      ).find(button => button.textContent?.trim() === label) ?? null

    await click(findConfirmButton('Cancel'))
    await flushInteraction()
    expect(testState.manageAccount).not.toHaveBeenCalled()

    await click(document.querySelector('button[aria-label="Use reset credit"]'))
    await flushInteraction()
    await click(findConfirmButton('Use credit'))
    await flushInteraction()

    expect(testState.manageAccount).toHaveBeenCalledTimes(1)
    expect(testState.messageSuccess).toHaveBeenCalledWith('Reset credit used.')
    expect(testState.messageWarning).toHaveBeenCalledWith('Refresh failed.')
    expect(testState.messageError).not.toHaveBeenCalled()

    await click(document.querySelector('.ant-modal-close'))
    await finishMotion(document.querySelector('.ant-modal'))
    expect(document.activeElement).toBe(quotaTrigger)
  })
})
