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
import { SenderVoiceControl, SenderVoiceRecordingBar } from './SenderVoiceControl'

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
  if (voiceInput != null && voiceInput.state.phase !== 'idle') {
    return (
      <div className='chat-input-toolbar chat-input-toolbar--voice-active'>
        <SenderVoiceRecordingBar voiceInput={voiceInput} />
      </div>
    )
  }

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
        {voiceInput != null && (
          <SenderVoiceControl voiceInput={voiceInput} />
        )}

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
      </div>

      {!state.hideSubmitAction && (
        <div className={`toolbar-right ${state.isInlineEdit ? 'toolbar-right--inline-edit' : ''}`.trim()}>
          <SenderSubmitAction
            isInlineEdit={state.isInlineEdit}
            submitLoading={state.submitLoading}
            submitLabel={data.submitLabel}
            hasComposerContent={state.hasComposerContent}
            modelUnavailable={state.modelUnavailable}
            sendBlocked={state.sendBlocked}
            sendBlockedTooltip={state.sendBlockedTooltip}
            showConfirmInteractionAction={state.showConfirmInteractionAction}
            confirmInteractionLabel={data.confirmInteractionLabel}
            isThinking={state.isThinking}
            stopLoading={state.stopLoading}
            resolvedSendShortcut={state.resolvedSendShortcut}
            queueSteerShortcut={data.composerControlShortcuts.queueSteer}
            queueNextShortcut={data.composerControlShortcuts.queueNext}
            isMac={state.isMac}
            onCancel={handlers.onCancel}
            onConfirmInteractionAction={handlers.onConfirmInteractionOption}
            onSend={handlers.onSend}
            onStop={handlers.onInterrupt}
          />
        </div>
      )}
    </div>
  )
}
