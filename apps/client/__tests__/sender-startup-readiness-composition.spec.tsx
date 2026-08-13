// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SenderBody } from '#~/components/chat/sender/@components/sender-body/SenderBody'
import type {
  SenderToolbarData,
  SenderToolbarRefs,
  SenderToolbarState
} from '#~/components/chat/sender/@types/sender-toolbar-types'
import type { SenderVoiceInputController } from '#~/components/chat/sender/@types/sender-voice-input'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount }: { onMount?: (...args: unknown[]) => void }) => {
    useEffect(() => {
      onMount?.({}, {})
    }, [onMount])
    return <textarea data-testid='real-monaco-input' />
  },
  loader: { config: vi.fn() }
}))

vi.mock('#~/components/workspace/ContextFilePicker', () => ({ ContextFilePicker: () => null }))
vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => ({ isCompactLayout: false })
}))
vi.mock('#~/hooks/use-sender-header-query-state.js', () => ({
  useSenderHeaderQueryState: () => ({ isHeaderCollapsed: false })
}))
vi.mock(
  '#~/components/chat/sender/@components/sender-header-controls/SenderHeaderControls',
  () => ({ SenderHeaderControls: () => null })
)
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
vi.mock(
  '#~/components/chat/sender/@components/sender-attachments/SenderAttachments',
  () => ({ SenderAttachments: () => null })
)
vi.mock(
  '#~/components/chat/sender/@components/sender-toolbar/SenderToolbar',
  () => ({ SenderToolbar: () => null })
)

type SenderBodyProps = ComponentProps<typeof SenderBody>

const createVoiceInput = (phase: 'idle' | 'recording'): SenderVoiceInputController => ({
  handlers: {} as SenderVoiceInputController['handlers'],
  state: { phase } as SenderVoiceInputController['state']
})

const createSenderBodyProps = (
  overrides: Partial<SenderBodyProps> = {}
): SenderBodyProps => ({
  editorRef: { current: null },
  input: '',
  isBusy: false,
  isInlineEdit: false,
  modelUnavailable: false,
  onCancelContextPicker: vi.fn(),
  onClearPendingAnnotations: vi.fn(),
  onClearPendingFileComments: vi.fn(),
  onClearPendingTextSelections: vi.fn(),
  onConfirmContextPicker: vi.fn(),
  onCursorChange: vi.fn(),
  onInputChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
  onRemovePendingAnnotation: vi.fn(),
  onRemovePendingFile: vi.fn(),
  onRemovePendingFileComment: vi.fn(),
  onRemovePendingImage: vi.fn(),
  onRemovePendingTextSelection: vi.fn(),
  pendingAnnotations: [],
  pendingFileComments: [],
  pendingFiles: [],
  pendingImages: [],
  pendingTextSelections: [],
  placeholder: 'Message',
  resolveCompletionMatch: () => null,
  resolveTokenDecorations: () => [],
  showContextPicker: false,
  toolbarData: {} as SenderToolbarData,
  toolbarHandlers: {
    onCloseReferenceActions: vi.fn(),
    onImageFileChange: vi.fn(),
    onInterrupt: vi.fn(),
    onModelSearchValueChange: vi.fn(),
    onOpenContextPicker: vi.fn(),
    onOpenEffortSelector: vi.fn(),
    onOpenModelSelector: vi.fn(),
    onPermissionMenuKeyDown: vi.fn(),
    onPermissionOpenChange: vi.fn(),
    onQueueTextareaFocusRestore: vi.fn(),
    onReferenceImageSelect: vi.fn(),
    onReferenceMenuKeyDown: vi.fn(),
    onReferenceOpenChange: vi.fn(),
    onSelectPermissionMode: vi.fn(),
    onSend: vi.fn(),
    onShowEffortSelectChange: vi.fn(),
    onShowModelSelectChange: vi.fn()
  },
  toolbarRefs: {} as SenderToolbarRefs,
  toolbarState: {
    hideSubmitAction: false,
    resolvedSendShortcut: 'enter',
    sendBlocked: false
  } as SenderToolbarState,
  ...overrides
})

let container: HTMLDivElement
let root: Root

const renderSender = async (overrides: Partial<SenderBodyProps> = {}) => {
  await act(async () => {
    root.render(<SenderBody {...createSenderBodyProps(overrides)} />)
  })
  return container.querySelector('.chat-input-monaco')
}

describe('sender startup readiness composition', () => {
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

  it('reports model unavailability as degraded and becomes editable after configuration recovers', async () => {
    const sender = await renderSender({ modelUnavailable: true })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBeNull()
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBe('true')

    await renderSender({ modelUnavailable: false })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBe('true')
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()
  })

  it('keeps voice recording and inline-edit busy locks non-terminal, then restores editable', async () => {
    const sender = await renderSender({ voiceInput: createVoiceInput('recording') })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBeNull()
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()

    await renderSender({ voiceInput: createVoiceInput('idle') })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBe('true')

    await renderSender({ isBusy: true, isInlineEdit: true, modelUnavailable: true })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBeNull()
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()

    await renderSender({ isBusy: false, isInlineEdit: true, modelUnavailable: true })
    expect(sender?.getAttribute('data-oneworks-sender-editor-ready')).toBe('true')
    expect(sender?.getAttribute('data-oneworks-sender-editor-unavailable')).toBeNull()
  })
})
