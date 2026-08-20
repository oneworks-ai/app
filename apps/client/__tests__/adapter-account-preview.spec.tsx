// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdapterAccountPreview } from '#~/components/config/AdapterAccountPreview'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testState = vi.hoisted(() => ({
  data: undefined as any
}))

vi.mock('#~/components/config/@hooks/use-adapter-account-preview-data', () => ({
  useAdapterAccountPreviewData: () => ({ data: testState.data, isLoading: false })
}))

const translations: Record<string, string> = {
  'config.accounts.empty': 'No accounts',
  'config.accounts.previewMore': 'View more',
  'config.accounts.previewMoreLabel': 'View more accounts',
  'config.accounts.status.error': 'Error',
  'config.accounts.status.missing': 'Missing',
  'config.accounts.status.ready': 'Ready',
  'config.accounts.title': 'Accounts'
}

const t = (key: string) => translations[key] ?? key

describe('adapter account preview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    testState.data = {
      accounts: [
        {
          key: 'primary',
          title: 'Primary account',
          status: 'ready',
          quota: {
            metrics: [{ id: 'primary-usage', label: '7d used', value: '25%', primary: true }]
          }
        },
        { key: 'backup', title: 'Backup account', status: 'ready' },
        { key: 'third', title: 'Third account', status: 'ready' },
        { key: 'fourth', title: 'Fourth account', status: 'error' }
      ],
      defaultAccount: 'primary'
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps three compact rows by replacing overflow accounts with a direct more action', async () => {
    const onOpenAccount = vi.fn()
    const onOpenAccounts = vi.fn()
    await act(async () => {
      root.render(
        <AdapterAccountPreview
          adapterKey='codex'
          adapterValue={{
            defaultAccount: 'primary',
            accounts: {
              primary: {},
              backup: {},
              third: {},
              fourth: {}
            }
          }}
          supportsAccounts
          onOpenAccount={onOpenAccount}
          onOpenAccounts={onOpenAccounts}
          t={t}
        />
      )
    })

    const rows = container.querySelectorAll<HTMLButtonElement>('.adapter-account-preview__row')
    expect(rows).toHaveLength(3)
    expect(container.textContent).toContain('Primary account')
    expect(container.textContent).toContain('Backup account')
    expect(container.textContent).toContain('View more')
    expect(container.textContent).toContain('+2')
    expect(container.textContent).not.toContain('Third account')
    expect(container.querySelector('.quota-usage-ring')).not.toBeNull()

    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    rows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onOpenAccount).toHaveBeenCalledWith('primary')
    expect(onOpenAccounts).toHaveBeenCalledOnce()
  })
})
