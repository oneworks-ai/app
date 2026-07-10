import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  detailFetcher: undefined as undefined | (() => Promise<unknown>),
  getAdapterAccountDetail: vi.fn(),
  mutate: vi.fn()
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  },
  Button: ({
    'aria-label': ariaLabel,
    children,
    icon
  }: {
    'aria-label'?: string
    children?: ReactNode
    icon?: ReactNode
  }) => (
    <button type='button' aria-label={ariaLabel}>{icon}{children}</button>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Input: () => <input readOnly />,
  Popconfirm: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Spin: () => <span>loading</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('swr', () => ({
  default: (key: readonly string[] | string | null, fetcher: () => Promise<unknown>) => {
    if (Array.isArray(key) && key[0] === '/api/adapters/account-quota' && key[2] === 'work') {
      testState.detailFetcher = fetcher
      return {
        data: {
          account: {
            key: 'work',
            title: 'Work',
            status: 'ready',
            quota: {
              summary: 'Pro · 5h 48% · 7d 8%',
              metrics: [
                {
                  id: 'primary-usage',
                  label: '5h used',
                  value: '48%',
                  description: 'Resets 2026-07-10 16:14'
                },
                {
                  id: 'secondary-usage',
                  label: '7d used',
                  value: '8%',
                  description: 'Resets 2026-07-17 05:42'
                }
              ]
            },
            actions: [
              {
                key: 'refresh',
                label: 'Refresh quota',
                description: 'Refresh the latest quota.',
                scope: 'account'
              }
            ]
          }
        },
        isLoading: false,
        mutate: testState.mutate
      }
    }

    return {
      data: undefined,
      isLoading: false,
      mutate: vi.fn()
    }
  },
  useSWRConfig: () => ({ mutate: vi.fn() })
}))

vi.mock('#~/api', () => ({
  getAdapterAccountDetail: testState.getAdapterAccountDetail,
  getAdapterAccounts: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  manageAdapterAccount: vi.fn()
}))

vi.mock('#~/components/config/record-editors/SchemaObjectEditor', () => ({
  SchemaObjectEditor: () => <div data-testid='account-editor' />
}))

const translations: Record<string, string> = {
  'config.accounts.actions.refresh.label': '刷新额度',
  'config.accounts.quotaTitle': '额度',
  'config.accounts.status.ready': '可用'
}

const t = (key: string, options?: Record<string, unknown> & { defaultValue?: string }) => (
  translations[key] ?? options?.defaultValue ?? key
)

describe('adapter accounts manager', () => {
  beforeEach(() => {
    testState.detailFetcher = undefined
    testState.getAdapterAccountDetail.mockReset()
    testState.mutate.mockReset()
  })

  it('loads and displays the selected account quota', async () => {
    const { AdapterAccountsManager } = await import('#~/components/config/AdapterAccountsManager')
    const html = renderToStaticMarkup(
      <AdapterAccountsManager
        adapterKey='codex'
        value={{ accounts: { work: {} } }}
        accountsData={{ accounts: [], actions: [] }}
        nestedPath={['accounts', 'work']}
        onChange={vi.fn()}
        onOpenNestedPath={vi.fn()}
        t={t}
      />
    )

    expect(html).toContain('额度')
    expect(html).toContain('5h used')
    expect(html).toContain('48%')
    expect(html).toContain('7d used')
    expect(html).toContain('8%')
    expect(html).toContain('aria-label="刷新额度"')

    testState.getAdapterAccountDetail.mockResolvedValue({ account: { key: 'work' } })
    await expect(testState.detailFetcher?.()).resolves.toEqual({ account: { key: 'work' } })
    expect(testState.getAdapterAccountDetail).toHaveBeenCalledWith('codex', 'work', { refresh: true })
  })
})
