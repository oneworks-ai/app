import type { MutableRefObject } from 'react'

import type { SessionInfo } from '@oneworks/types'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'

import type { PendingContextFile, PendingImage } from '../../@types/sender-composer'
import type { SenderEditorHandle } from '../../@types/sender-editor'
import type { SenderProps } from '../../@types/sender-props'
import type { SenderCompletionMatch, SenderTokenDecoration } from '../../@utils/sender-completion'
import { SenderAttachments } from '../sender-attachments/SenderAttachments'
import { SenderMonacoEditor } from '../sender-monaco-editor/SenderMonacoEditor'
import { SenderToolbar } from '../sender-toolbar/SenderToolbar'

export function SenderComposerInput({
  editorRef,
  sessionInfo,
  pendingImages,
  pendingFiles,
  onRemovePendingImage,
  onRemovePendingFile,
  placeholder,
  input,
  disabled,
  secondarySendShortcut,
  onSecondarySendShortcut,
  minVisibleLineCount,
  onInputChange,
  onCursorChange,
  onKeyDown,
  onPaste,
  resolveCompletionMatch,
  resolveTokenDecorations,
  toolbarState,
  toolbarData,
  toolbarRefs,
  toolbarHandlers,
  sessionTarget,
  showHeaderControlsInMore,
  showStatusBarControlsInMore,
  statusBarGitControlsInMore
}: {
  editorRef: MutableRefObject<SenderEditorHandle | null>
  sessionInfo?: SessionInfo | null
  pendingImages: PendingImage[]
  pendingFiles: PendingContextFile[]
  onRemovePendingImage: (id: string) => void
  onRemovePendingFile: (path: string) => void
  placeholder: string
  input: string
  disabled: boolean
  secondarySendShortcut?: string
  onSecondarySendShortcut?: () => void
  minVisibleLineCount?: number
  onInputChange: (value: string, cursorOffset: number | null) => void
  onCursorChange: (cursorOffset: number | null) => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void | Promise<void>
  resolveCompletionMatch: (
    value: string,
    cursorOffset: number | null,
    sessionInfo?: SessionInfo | null
  ) => SenderCompletionMatch | null
  resolveTokenDecorations: (value: string) => SenderTokenDecoration[]
  toolbarState: SenderToolbarState
  toolbarData: SenderToolbarData
  toolbarRefs: SenderToolbarRefs
  toolbarHandlers: SenderToolbarHandlers
  sessionTarget?: SenderProps['sessionTarget']
  showHeaderControlsInMore?: boolean
  showStatusBarControlsInMore?: boolean
  statusBarGitControlsInMore?: SenderProps['statusBarGitControlsInMore']
}) {
  return (
    <div className='chat-input-composer'>
      <SenderAttachments
        pendingImages={pendingImages}
        pendingFiles={pendingFiles}
        onRemovePendingImage={onRemovePendingImage}
        onRemovePendingFile={onRemovePendingFile}
      />
      <SenderMonacoEditor
        editorRef={editorRef}
        sessionInfo={sessionInfo}
        value={input}
        placeholder={placeholder}
        disabled={disabled}
        sendShortcut={toolbarState.resolvedSendShortcut}
        sendShortcutDisabled={toolbarState.sendBlocked || toolbarState.hideSubmitAction}
        onSendShortcut={toolbarHandlers.onSend}
        secondarySendShortcut={secondarySendShortcut}
        onSecondarySendShortcut={onSecondarySendShortcut}
        minVisibleLineCount={minVisibleLineCount}
        onInputChange={onInputChange}
        onCursorChange={onCursorChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        resolveCompletionMatch={resolveCompletionMatch}
        resolveTokenDecorations={resolveTokenDecorations}
      />
      <SenderToolbar
        state={toolbarState}
        data={toolbarData}
        refs={toolbarRefs}
        handlers={toolbarHandlers}
        sessionTarget={sessionTarget}
        showHeaderControlsInMore={showHeaderControlsInMore}
        showStatusBarControlsInMore={showStatusBarControlsInMore}
        statusBarGitControlsInMore={statusBarGitControlsInMore}
      />
    </div>
  )
}
