import './SenderToolbar.scss'

import type { SenderProps } from '../../@types/sender-props'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import type { SenderVoiceInputController } from '../../@types/sender-voice-input'

import { EffortSelectControl } from '../effort-select/EffortSelectControl'
import { ModelSelectControl } from '../model-select/ModelSelectControl'
import { ReferenceActionsControl } from '../reference-actions/ReferenceActionsControl'
import { SenderSubmitAction } from '../sender-submit-action/SenderSubmitAction'
import { SenderVoiceControl } from './SenderVoiceControl'
import { SenderVoiceRecordingBar } from './SenderVoiceRecordingBar'

export function SenderToolbar({
  state,
  data,
  refs,
  handlers,
  sessionTarget,
  showHeaderControlsInMore = false,
  showStatusBarControlsInMore = false,
  statusBarGitControlsInMore,
  voiceInput
}: {
  state: SenderToolbarState
  data: SenderToolbarData
  refs: SenderToolbarRefs
  handlers: SenderToolbarHandlers
  sessionTarget?: SenderProps['sessionTarget']
  showHeaderControlsInMore?: boolean
  showStatusBarControlsInMore?: boolean
  statusBarGitControlsInMore?: SenderProps['statusBarGitControlsInMore']
  voiceInput?: SenderVoiceInputController
}) {
  const isVoiceRecording = voiceInput?.state.phase === 'recording'
  const isVoiceTranscribing = voiceInput?.state.phase === 'transcribing'
  const voiceSubmitAvailable = voiceInput?.state.canSendAfterTranscription === true

  return (
    <div className='chat-input-toolbar'>
      {!state.hideReferenceActions && (
        <input
          ref={refs.fileInputRef}
          type='file'
          accept='image/*'
          multiple
          onChange={handlers.onImageFileChange}
          className='file-input-hidden'
        />
      )}

      <div className='toolbar-left'>
        {(isVoiceRecording || isVoiceTranscribing) && voiceInput != null
          ? (
            <SenderVoiceRecordingBar voiceInput={voiceInput} />
          )
          : (
            <>
              {!state.hideReferenceActions && (
                <ReferenceActionsControl
                  state={state}
                  data={data}
                  refs={refs}
                  handlers={handlers}
                  sessionTarget={sessionTarget}
                  showHeaderControlsInMore={showHeaderControlsInMore}
                  showStatusBarControlsInMore={showStatusBarControlsInMore}
                  statusBarGitControlsInMore={statusBarGitControlsInMore}
                />
              )}

              {!state.isInlineEdit && !state.hideSelectionControls && (
                <ModelSelectControl
                  state={state}
                  data={data}
                  refs={refs}
                  handlers={handlers}
                />
              )}

              {!state.isInlineEdit && !state.hideSelectionControls && state.supportsEffort && (
                <EffortSelectControl
                  state={state}
                  data={data}
                  refs={refs}
                  handlers={handlers}
                />
              )}
            </>
          )}
      </div>

      {(voiceInput != null || !state.hideSubmitAction) && (
        <div className={`toolbar-right ${state.isInlineEdit ? 'toolbar-right--inline-edit' : ''}`.trim()}>
          {voiceInput != null && (
            <SenderVoiceControl voiceInput={voiceInput} />
          )}

          {!state.hideSubmitAction && (
            <SenderSubmitAction
              isInlineEdit={state.isInlineEdit}
              submitLoading={isVoiceTranscribing || state.submitLoading}
              submitLabel={data.submitLabel}
              hasComposerContent={isVoiceRecording || isVoiceTranscribing || state.hasComposerContent}
              modelUnavailable={(isVoiceRecording && !voiceSubmitAvailable) || isVoiceTranscribing ||
                state.modelUnavailable}
              sendBlocked={!isVoiceRecording && state.sendBlocked}
              sendBlockedTooltip={isVoiceRecording ? undefined : state.sendBlockedTooltip}
              showConfirmInteractionAction={!isVoiceRecording && !isVoiceTranscribing &&
                state.showConfirmInteractionAction}
              confirmInteractionLabel={data.confirmInteractionLabel}
              isThinking={!isVoiceRecording && !isVoiceTranscribing && state.isThinking}
              stopLoading={state.stopLoading}
              resolvedSendShortcut={state.resolvedSendShortcut}
              queueSteerShortcut={data.composerControlShortcuts.queueSteer}
              queueNextShortcut={data.composerControlShortcuts.queueNext}
              isMac={state.isMac}
              onCancel={handlers.onCancel}
              onConfirmInteractionAction={handlers.onConfirmInteractionOption}
              onSend={isVoiceRecording
                ? () => voiceInput?.handlers.stopRecording({ sendAfterTranscription: true })
                : handlers.onSend}
              onStop={handlers.onInterrupt}
            />
          )}
        </div>
      )}
    </div>
  )
}
