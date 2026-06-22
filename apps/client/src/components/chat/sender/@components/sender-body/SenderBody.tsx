import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionInfo } from '@oneworks/types'

import { ContextFilePicker } from '#~/components/workspace/ContextFilePicker'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { useSenderHeaderQueryState } from '#~/hooks/use-sender-header-query-state.js'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

import type {
  PendingAnnotation,
  PendingAnnotationPreviewState,
  PendingContextFile,
  PendingFileComment,
  PendingImage,
  PendingTextSelection
} from '../../@types/sender-composer'
import type { SenderEditorHandle } from '../../@types/sender-editor'
import type { SenderProps } from '../../@types/sender-props'
import type { SenderCompletionMatch, SenderTokenDecoration } from '../../@utils/sender-completion'
import { SenderComposerInput } from '../sender-composer-input/SenderComposerInput'
import { SenderHeaderControls } from '../sender-header-controls/SenderHeaderControls'

export function SenderBody({
  isInlineEdit,
  isBusy,
  modelUnavailable,
  pendingImages,
  pendingFiles,
  pendingAnnotations,
  pendingTextSelections,
  pendingFileComments,
  onRemovePendingImage,
  onRemovePendingFile,
  onRemovePendingAnnotation,
  onRemovePendingTextSelection,
  onRemovePendingFileComment,
  onClearPendingAnnotations,
  onClearPendingTextSelections,
  onClearPendingFileComments,
  onPendingAnnotationPreviewChange,
  onOpenPendingFileComment,
  editorRef,
  sessionId,
  sessionInfo,
  placeholder,
  input,
  onInputChange,
  onCursorChange,
  onKeyDown,
  onPaste,
  secondarySendShortcut,
  onSecondarySendShortcut,
  resolveCompletionMatch,
  resolveTokenDecorations,
  toolbarState,
  toolbarData,
  toolbarRefs,
  toolbarHandlers,
  sessionTarget,
  agentRoomTargetMembers,
  hideHeaderControls,
  showStatusBarControlsInMore,
  statusBarGitControlsInMore,
  showContextPicker,
  onCancelContextPicker,
  onConfirmContextPicker,
  voiceInput
}: {
  isInlineEdit: boolean
  isBusy: boolean
  modelUnavailable?: boolean
  pendingImages: PendingImage[]
  pendingFiles: PendingContextFile[]
  pendingAnnotations: PendingAnnotation[]
  pendingTextSelections: PendingTextSelection[]
  pendingFileComments: PendingFileComment[]
  onRemovePendingImage: (id: string) => void
  onRemovePendingFile: (path: string) => void
  onRemovePendingAnnotation: (id: string) => void
  onRemovePendingTextSelection: (id: string) => void
  onRemovePendingFileComment: (id: string) => void
  onClearPendingAnnotations: () => void
  onClearPendingTextSelections: () => void
  onClearPendingFileComments: () => void
  onPendingAnnotationPreviewChange?: (state: PendingAnnotationPreviewState) => void
  onOpenPendingFileComment?: (comment: PendingFileComment) => void
  editorRef: MutableRefObject<SenderEditorHandle | null>
  sessionId?: string
  sessionInfo?: SessionInfo | null
  placeholder: string
  input: string
  onInputChange: (value: string, cursorOffset: number | null) => void
  onCursorChange: (cursorOffset: number | null) => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void | Promise<void>
  secondarySendShortcut?: string
  onSecondarySendShortcut?: () => void
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
  agentRoomTargetMembers?: SenderProps['agentRoomTargetMembers']
  hideHeaderControls?: boolean
  showStatusBarControlsInMore?: boolean
  statusBarGitControlsInMore?: SenderProps['statusBarGitControlsInMore']
  showContextPicker: boolean
  onCancelContextPicker: () => void
  onConfirmContextPicker: (files: PendingContextFile[]) => void
  voiceInput?: SenderVoiceInputController
}) {
  const { t } = useTranslation()
  const { isCompactLayout } = useResponsiveLayout()
  const { isHeaderCollapsed } = useSenderHeaderQueryState()
  const minVisibleLineCount = !isInlineEdit && !isCompactLayout ? 2 : 1
  const showHeaderControlsInMore = hideHeaderControls !== true && !isInlineEdit && isHeaderCollapsed

  return (
    <div className={`chat-input-container ${isInlineEdit ? 'chat-input-container--inline-edit' : ''}`.trim()}>
      {hideHeaderControls !== true && (
        <SenderHeaderControls
          isInlineEdit={isInlineEdit}
          sessionTarget={sessionTarget}
          toolbarState={toolbarState}
          toolbarData={toolbarData}
          toolbarRefs={toolbarRefs}
          toolbarHandlers={toolbarHandlers}
          input={input}
          agentRoomTargetMembers={agentRoomTargetMembers}
        />
      )}
      <SenderComposerInput
        editorRef={editorRef}
        sessionInfo={sessionInfo}
        pendingImages={pendingImages}
        pendingFiles={pendingFiles}
        pendingAnnotations={pendingAnnotations}
        pendingTextSelections={pendingTextSelections}
        pendingFileComments={pendingFileComments}
        onRemovePendingImage={onRemovePendingImage}
        onRemovePendingFile={onRemovePendingFile}
        onRemovePendingAnnotation={onRemovePendingAnnotation}
        onRemovePendingTextSelection={onRemovePendingTextSelection}
        onRemovePendingFileComment={onRemovePendingFileComment}
        onClearPendingAnnotations={onClearPendingAnnotations}
        onClearPendingTextSelections={onClearPendingTextSelections}
        onClearPendingFileComments={onClearPendingFileComments}
        onPendingAnnotationPreviewChange={onPendingAnnotationPreviewChange}
        onOpenPendingFileComment={onOpenPendingFileComment}
        input={input}
        placeholder={placeholder || t('chat.inputPlaceholder')}
        disabled={(!isInlineEdit && modelUnavailable) || (isInlineEdit && isBusy)}
        secondarySendShortcut={secondarySendShortcut}
        onSecondarySendShortcut={onSecondarySendShortcut}
        minVisibleLineCount={minVisibleLineCount}
        onInputChange={onInputChange}
        onCursorChange={onCursorChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        resolveCompletionMatch={resolveCompletionMatch}
        resolveTokenDecorations={resolveTokenDecorations}
        toolbarState={toolbarState}
        toolbarData={toolbarData}
        toolbarRefs={toolbarRefs}
        toolbarHandlers={toolbarHandlers}
        sessionTarget={sessionTarget}
        showHeaderControlsInMore={showHeaderControlsInMore}
        showStatusBarControlsInMore={showStatusBarControlsInMore === true && !isInlineEdit}
        statusBarGitControlsInMore={statusBarGitControlsInMore}
        voiceInput={voiceInput}
      />
      {!isInlineEdit && (
        <ContextFilePicker
          open={showContextPicker}
          sessionId={sessionId}
          selectedPaths={pendingFiles.map(file => file.path)}
          onCancel={onCancelContextPicker}
          onConfirm={onConfirmContextPicker}
        />
      )}
    </div>
  )
}
