// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatAdapterAccountSelection } from '#~/hooks/chat/use-chat-adapter-account-selection'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testState = vi.hoisted(() => ({
  data: undefined as any
}))

vi.mock('#~/hooks/use-adapter-accounts-with-quota', () => ({
  useAdapterAccountsWithQuota: () => testState.data
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.accountSelectAutomatic': 'Auto',
      'chat.accountSelectAutomaticHint': 'Automatically chooses a healthy account'
    }[key] ?? key)
  })
}))

let root: Root | undefined
let container: HTMLDivElement | undefined
let latest: ReturnType<typeof useChatAdapterAccountSelection>

const Probe = () => {
  latest = useChatAdapterAccountSelection({ adapter: 'codex', model: 'gpt-5.4' })
  return null
}

const renderProbe = async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Probe />)
  })
}

describe('chat automatic Codex account selection', () => {
  beforeEach(() => {
    localStorage.clear()
    testState.data = {
      automaticSelection: { enabled: true, strategy: 'sticky-priority' },
      defaultAccount: 'primary',
      accounts: [
        { key: 'primary', title: 'Primary', status: 'ready' },
        { key: 'backup', title: 'Backup', status: 'ready' }
      ]
    }
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
    localStorage.clear()
  })

  it('keeps Auto selected after the session reports its resolved physical account', async () => {
    await renderProbe()

    expect(latest.accountOptions[0]).toMatchObject({ value: '', label: 'Auto', automatic: true })
    expect(latest.selectedAccount).toBeUndefined()
    expect(localStorage.getItem('oneworks_chat_adapter_account:codex')).toBe('__automatic__')

    await act(async () => latest.applySessionSelection({ account: 'primary' }))

    expect(latest.selectedAccount).toBeUndefined()
    expect(localStorage.getItem('oneworks_chat_adapter_account:codex')).toBe('__automatic__')
  })

  it('persists an explicit account choice and restores Auto when requested again', async () => {
    await renderProbe()

    await act(async () => latest.setSelectedAccount('backup'))
    expect(latest.selectedAccount).toBe('backup')
    expect(localStorage.getItem('oneworks_chat_adapter_account:codex')).toBe('backup')

    await act(async () => latest.setSelectedAccount(undefined))
    expect(latest.selectedAccount).toBeUndefined()
    expect(localStorage.getItem('oneworks_chat_adapter_account:codex')).toBe('__automatic__')
  })
})
