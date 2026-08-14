// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { respondSessionInteraction } from '#~/api/sessions'
import { useChatInteraction } from '#~/hooks/chat/use-chat-interaction'

vi.mock('#~/api/sessions', () => ({
  respondSessionInteraction: vi.fn()
}))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const createDeferred = () => {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('chat interaction response lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let latest: ReturnType<typeof useChatInteraction>

  const Probe = ({ sessionId }: { sessionId?: string }) => {
    latest = useChatInteraction({ sessionId })
    return null
  }

  beforeEach(async () => {
    vi.mocked(respondSessionInteraction).mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<Probe sessionId='sess-1' />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const setRequest = async (id = 'request-1', question = 'Continue?') => {
    await act(async () =>
      latest.setInteractionRequest({
        id,
        payload: { question, sessionId: 'sess-1' }
      })
    )
  }

  it('propagates request failures and retains the pending interaction for retry', async () => {
    const failure = new Error('interaction_not_pending')
    vi.mocked(respondSessionInteraction).mockRejectedValueOnce(failure).mockResolvedValueOnce({ ok: true })
    await setRequest()

    await expect(latest.handleInteractionResponse('request-1', ['runtime'])).rejects.toBe(failure)
    expect(latest.interactionRequest?.id).toBe('request-1')

    await act(async () => latest.handleInteractionResponse('request-1', ['runtime']))
    expect(latest.interactionRequest).toBeNull()
    expect(respondSessionInteraction).toHaveBeenNthCalledWith(1, 'sess-1', 'request-1', ['runtime'])
    expect(respondSessionInteraction).toHaveBeenNthCalledWith(2, 'sess-1', 'request-1', ['runtime'])
  })

  it('does not let a stale success clear a replacement request with the same native id', async () => {
    const pending = createDeferred()
    vi.mocked(respondSessionInteraction).mockReturnValueOnce(pending.promise as never)
    await setRequest('request-1', 'First?')
    const submission = latest.handleInteractionResponse('request-1', ['runtime'])

    await setRequest('request-1', 'Replacement?')
    await act(async () => pending.resolve())
    await submission

    expect(latest.interactionRequest?.payload.question).toBe('Replacement?')
  })

  it('does not let a response from the previous session clear navigation state', async () => {
    const pending = createDeferred()
    vi.mocked(respondSessionInteraction).mockReturnValueOnce(pending.promise as never)
    await setRequest()
    const submission = latest.handleInteractionResponse('request-1', [])

    await act(async () => root.render(<Probe sessionId='sess-2' />))
    await setRequest('request-2', 'New session?')
    await act(async () => pending.resolve())
    await submission

    expect(latest.interactionRequest?.id).toBe('request-2')
  })
})
