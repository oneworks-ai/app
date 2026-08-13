// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SenderMonacoEditor } from '#~/components/chat/sender/@components/sender-monaco-editor/SenderMonacoEditor'

vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount }: { onMount?: (...args: unknown[]) => void }) => {
    useEffect(() => {
      onMount?.({}, {})
    }, [onMount])
    return <textarea data-testid='real-monaco-input' />
  },
  loader: { config: vi.fn() }
}))

vi.mock(
  '#~/components/chat/sender/@components/sender-monaco-editor/SenderAutomationInput',
  () => ({ SenderAutomationInput: () => null })
)

vi.mock(
  '#~/components/chat/sender/@components/sender-monaco-editor/use-sender-monaco-editor',
  () => ({
    useSenderMonacoEditor: () => ({
      editorHeight: 40,
      handleEditorMount: vi.fn(),
      themeName: 'vs'
    })
  })
)

let container: HTMLDivElement
let root: Root

const renderEditor = async ({
  disabled,
  startupUnavailable
}: {
  disabled: boolean
  startupUnavailable: boolean
}) => {
  await act(async () => {
    root.render(
      <SenderMonacoEditor
        editorRef={{ current: null }}
        value=''
        placeholder='Message'
        disabled={disabled}
        startupUnavailable={startupUnavailable}
        sendShortcut='enter'
        onSendShortcut={vi.fn()}
        onInputChange={vi.fn()}
        onCursorChange={vi.fn()}
        onKeyDown={vi.fn()}
        onPaste={vi.fn()}
        resolveCompletionMatch={() => null}
        resolveTokenDecorations={() => []}
      />
    )
  })
}

describe('sender Monaco startup readiness', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('marks only a mounted and enabled editor as editable across disabled-to-enabled transition', async () => {
    await renderEditor({ disabled: true, startupUnavailable: true })

    const sender = container.querySelector('.chat-input-monaco')
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBeNull()
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBe('true')

    await renderEditor({ disabled: false, startupUnavailable: false })

    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBe('true')
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()
  })

  it('does not classify a transient voice-input lock as an unavailable terminal surface', async () => {
    await renderEditor({ disabled: true, startupUnavailable: false })

    const sender = container.querySelector('.chat-input-monaco')
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBeNull()
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()
  })
})
