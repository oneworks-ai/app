// @vitest-environment happy-dom
import { createInstance } from 'i18next'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AskUserQuestionParams } from '@oneworks/core'

import {
  SenderInteractionPanel
} from '#~/components/chat/sender/@components/sender-interaction-panel/SenderInteractionPanel'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const createI18n = async (language: 'en' | 'zh' = 'en') => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: language,
    resources: {
      en: {
        translation: {
          common: { cancel: 'Cancel' },
          chat: {
            interactionOptionNavigation: 'Quick option navigation',
            interactionOptionPrevious: 'Previous option',
            interactionOptionNext: 'Next option',
            interactionMultiSelectOptionSelected: '{{option}}, selected',
            interactionMultiSelectOptionUnselected: '{{option}}, not selected',
            interactionMultiSelectCustomAnswer: 'Custom answer (optional)',
            interactionMultiSelectCustomPlaceholder: 'Add another answer',
            interactionMultiSelectSubmit_one: 'Submit {{count}} selection',
            interactionMultiSelectSubmit_other: 'Submit {{count}} selections',
            interactionResponseFailed: "Couldn't submit this response. Check your connection and try again."
          }
        }
      },
      zh: {
        translation: {
          common: { cancel: '取消' },
          chat: {
            interactionOptionNavigation: '选项快速切换',
            interactionOptionPrevious: '上一个选项',
            interactionOptionNext: '下一个选项',
            interactionMultiSelectOptionSelected: '{{option}}，已选中',
            interactionMultiSelectOptionUnselected: '{{option}}，未选中',
            interactionMultiSelectCustomAnswer: '自定义答案（可选）',
            interactionMultiSelectCustomPlaceholder: '补充其他答案',
            interactionMultiSelectSubmit: '提交 {{count}} 个选项',
            interactionResponseFailed: '提交回答失败，请检查网络后重试。'
          }
        }
      }
    }
  })
  return i18n
}

describe('sender interaction panel multi-select', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderPanel = async (
    payload: AskUserQuestionParams,
    onInteractionResponse = vi.fn(),
    language: 'en' | 'zh' = 'en',
    requestId = 'multi-1'
  ) => {
    const i18n = await createI18n(language)
    const onActiveOptionIndexChange = vi.fn()
    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <SenderInteractionPanel
            interactionRequest={{ id: requestId, payload }}
            activeOptionIndex={0}
            deniedTools={[]}
            reasons={[]}
            onActiveOptionIndexChange={onActiveOptionIndexChange}
            onMoveActiveOption={vi.fn()}
            onInteractionResponse={onInteractionResponse}
          />
        </I18nextProvider>
      )
    )
    return {
      onActiveOptionIndexChange,
      onInteractionResponse,
      rerender: async (nextRequestId: string, nextPayload = payload) => {
        await act(async () =>
          root.render(
            <I18nextProvider i18n={i18n}>
              <SenderInteractionPanel
                interactionRequest={{ id: nextRequestId, payload: nextPayload }}
                activeOptionIndex={0}
                deniedTools={[]}
                reasons={[]}
                onActiveOptionIndexChange={onActiveOptionIndexChange}
                onMoveActiveOption={vi.fn()}
                onInteractionResponse={onInteractionResponse}
              />
            </I18nextProvider>
          )
        )
      }
    }
  }

  it('keeps defaults selected, toggles without submitting, and submits once in option order', async () => {
    const onResponse = vi.fn()
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which targets?',
      multiselect: true,
      defaultValue: ['history'],
      options: [
        { label: 'Runtime', value: 'runtime' },
        { label: 'History', value: 'history' }
      ]
    }, onResponse)

    const runtime = container.querySelector<HTMLButtonElement>('[data-option-index="0"]')!
    const history = container.querySelector<HTMLButtonElement>('[data-option-index="1"]')!
    expect(runtime.getAttribute('aria-pressed')).toBe('false')
    expect(history.getAttribute('aria-pressed')).toBe('true')
    expect(history.getAttribute('aria-label')).toBe('History, selected')

    await act(async () => runtime.click())
    expect(onResponse).not.toHaveBeenCalled()
    expect(runtime.getAttribute('aria-pressed')).toBe('true')

    const submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 2 selections'))!
    await act(async () => submit.click())
    await act(async () => submit.click())
    expect(onResponse).toHaveBeenCalledWith('multi-1', ['runtime', 'history'])
    expect(onResponse).toHaveBeenCalledTimes(1)
  })

  it('appends a custom answer, supports keyboard toggling, and keeps focus navigation stable', async () => {
    const onResponse = vi.fn()
    const { onActiveOptionIndexChange } = await renderPanel({
      sessionId: 'sess-1',
      question: 'Which targets?',
      multiselect: true,
      options: [
        { label: 'Runtime', value: 'runtime' },
        { label: 'History', value: 'history' }
      ]
    }, onResponse)
    const runtime = container.querySelector<HTMLButtonElement>('[data-option-index="0"]')!
    const history = container.querySelector<HTMLButtonElement>('[data-option-index="1"]')!

    await act(async () => {
      runtime.focus()
      runtime.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      runtime.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    })
    expect(runtime.getAttribute('aria-pressed')).toBe('true')
    expect(onActiveOptionIndexChange).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(history)

    const input = container.querySelector<HTMLInputElement>('.interaction-panel__custom-answer-input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '  custom target  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 2 selections'))!
    await act(async () => submit.click())
    expect(onResponse).toHaveBeenCalledWith('multi-1', ['runtime', 'custom target'])
  })

  it('shows bilingual copy, preserves custom defaults, and cancels with an empty selection array', async () => {
    const onResponse = vi.fn()
    await renderPanel(
      {
        sessionId: 'sess-1',
        question: '请选择目标',
        multiselect: true,
        defaultValue: ['runtime', '自定义默认值'],
        options: [{ label: '运行时', value: 'runtime' }]
      },
      onResponse,
      'zh'
    )
    expect(container.textContent).toContain('自定义答案（可选）')
    expect(container.querySelector<HTMLInputElement>('.interaction-panel__custom-answer-input')?.value)
      .toBe('自定义默认值')
    const cancel = container.querySelector<HTMLButtonElement>(
      '.interaction-panel__multi-select-actions button:first-child'
    )!
    expect(cancel.textContent).toBe('取消')
    await act(async () => cancel.click())
    expect(onResponse).toHaveBeenCalledWith('multi-1', [])
    expect(onResponse).toHaveBeenCalledTimes(1)
  })

  it('keeps single-select options on the existing immediate-submit path', async () => {
    const onResponse = vi.fn()
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which target?',
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)
    const runtime = container.querySelector<HTMLButtonElement>('[data-option-index="0"]')!
    expect(runtime.hasAttribute('aria-pressed')).toBe(false)
    expect(container.querySelector('.interaction-panel__multi-select')).toBeNull()
    await act(async () => runtime.click())
    expect(onResponse).toHaveBeenCalledWith('multi-1', 'runtime')
  })

  it('keeps single-select immediate submission retryable when its async boundary rejects', async () => {
    const onResponse = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(undefined)
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which target?',
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)
    const runtime = container.querySelector<HTMLButtonElement>('[data-option-index="0"]')!

    await act(async () => runtime.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('try again')
    await act(async () => runtime.click())

    expect(onResponse).toHaveBeenCalledTimes(2)
    expect(onResponse).toHaveBeenNthCalledWith(1, 'multi-1', 'runtime')
    expect(onResponse).toHaveBeenNthCalledWith(2, 'multi-1', 'runtime')
  })

  it.each([
    ['server rejection', new Error('interaction_not_pending')],
    ['network error', new TypeError('Failed to fetch')],
    ['timeout', new DOMException('Request timed out', 'TimeoutError')]
  ])('re-enables a failed submit after %s and retries with the preserved answer', async (_label, failure) => {
    const firstSubmit = createDeferred<void>()
    const onResponse = vi.fn()
      .mockReturnValueOnce(firstSubmit.promise)
      .mockResolvedValueOnce(undefined)
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which targets?',
      multiselect: true,
      defaultValue: ['runtime'],
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)

    const submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 1 selection'))!
    await act(async () => submit.click())
    expect(submit.disabled).toBe(true)

    await act(async () => firstSubmit.reject(failure))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('try again')
    expect(submit.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('[data-option-index="0"]')?.getAttribute('aria-pressed'))
      .toBe('true')

    await act(async () => submit.click())
    expect(onResponse).toHaveBeenNthCalledWith(1, 'multi-1', ['runtime'])
    expect(onResponse).toHaveBeenNthCalledWith(2, 'multi-1', ['runtime'])
  })

  it('re-enables a failed cancel and settles exactly once after retry', async () => {
    const firstCancel = createDeferred<void>()
    const onResponse = vi.fn()
      .mockReturnValueOnce(firstCancel.promise)
      .mockResolvedValueOnce(undefined)
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which targets?',
      multiselect: true,
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)
    const cancel = container.querySelector<HTMLButtonElement>(
      '.interaction-panel__multi-select-actions button:first-child'
    )!

    await act(async () => cancel.click())
    await act(async () => firstCancel.reject(new Error('cancel failed')))
    expect(cancel.disabled).toBe(false)
    await act(async () => cancel.click())
    await act(async () => cancel.click())
    expect(onResponse).toHaveBeenCalledTimes(2)
    expect(onResponse).toHaveBeenNthCalledWith(1, 'multi-1', [])
    expect(onResponse).toHaveBeenNthCalledWith(2, 'multi-1', [])
  })

  it('suppresses simultaneous click and keyboard submission while one request is pending', async () => {
    const pending = createDeferred<void>()
    const onResponse = vi.fn(() => pending.promise)
    await renderPanel({
      sessionId: 'sess-1',
      question: 'Which targets?',
      multiselect: true,
      defaultValue: ['runtime'],
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)
    const input = container.querySelector<HTMLInputElement>('.interaction-panel__custom-answer-input')!
    const submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 1 selection'))!

    await act(async () => {
      submit.click()
      submit.click()
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })
    expect(onResponse).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
  })

  it('ignores stale completion after request replacement and after unmount', async () => {
    const stale = createDeferred<void>()
    const unmounted = createDeferred<void>()
    const onResponse = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(unmounted.promise)
    const { rerender } = await renderPanel({
      sessionId: 'sess-1',
      question: 'First?',
      multiselect: true,
      defaultValue: ['runtime'],
      options: [{ label: 'Runtime', value: 'runtime' }]
    }, onResponse)
    let submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 1 selection'))!
    await act(async () => submit.click())

    await rerender('multi-2', {
      sessionId: 'sess-1',
      question: 'Second?',
      multiselect: true,
      defaultValue: ['history'],
      options: [{ label: 'History', value: 'history' }]
    })
    await act(async () => stale.reject(new Error('stale request failed')))
    expect(container.querySelector('[role="alert"]')).toBeNull()
    submit = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Submit 1 selection'))!
    expect(submit.disabled).toBe(false)
    await act(async () => submit.click())

    await act(async () => root.render(<div>navigated</div>))
    await act(async () => unmounted.resolve())
    expect(container.textContent).toBe('navigated')
  })
})
