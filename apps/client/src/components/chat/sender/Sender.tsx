import './Sender.scss'

import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useSenderController } from '#~/components/chat/sender/@hooks/use-sender-controller'

import { SenderBody } from './@components/sender-body/SenderBody'
import type { SenderProps } from './@types/sender-props'

export function Sender(props: SenderProps) {
  const { t } = useTranslation()
  const controller = useSenderController(props)
  const hiddenVoiceInputMenu = useMemo<MenuProps | undefined>(() => {
    if (props.hiddenVoiceInputActions == null || controller.hideSender || controller.isInlineEdit) {
      return undefined
    }

    return {
      items: [
        {
          key: 'show-voice-input',
          icon: <span className='material-symbols-rounded'>mic</span>,
          label: t('chat.voiceInput.showInSender')
        },
        {
          key: 'configure-voice-input',
          icon: <span className='material-symbols-rounded'>settings</span>,
          label: t('chat.voiceInput.configure')
        }
      ],
      onClick: ({ key }) => {
        if (key === 'show-voice-input') {
          props.hiddenVoiceInputActions?.onShow()
          return
        }
        if (key === 'configure-voice-input') {
          props.hiddenVoiceInputActions?.onConfigure()
        }
      }
    }
  }, [controller.hideSender, controller.isInlineEdit, props.hiddenVoiceInputActions, t])

  const content = (
    <div
      className={[
        'chat-input-wrapper',
        controller.hideSender ? 'chat-input-wrapper--permission' : '',
        controller.isInlineEdit ? 'chat-input-wrapper--inline-edit' : ''
      ].filter(Boolean).join(' ')}
    >
      {!controller.hideSender && (
        <SenderBody
          isInlineEdit={controller.isInlineEdit}
          isBusy={controller.isBusy}
          modelUnavailable={controller.modelUnavailable}
          pendingImages={controller.composer.pendingImages}
          pendingFiles={controller.composer.pendingFiles}
          pendingAnnotations={controller.composer.pendingAnnotations}
          pendingTextSelections={controller.composer.pendingTextSelections}
          onRemovePendingImage={(id) =>
            controller.composer.setPendingImages(prev => prev.filter(image => image.id !== id))}
          onRemovePendingFile={(path) =>
            controller.composer.setPendingFiles(prev => prev.filter(file => file.path !== path))}
          onRemovePendingAnnotation={(id) =>
            controller.composer.setPendingAnnotations(prev => prev.filter(annotation => annotation.id !== id))}
          onRemovePendingTextSelection={(id) =>
            controller.composer.setPendingTextSelections(prev => prev.filter(selection => selection.id !== id))}
          onClearPendingAnnotations={() => controller.composer.setPendingAnnotations([])}
          onClearPendingTextSelections={() => controller.composer.setPendingTextSelections([])}
          onPendingAnnotationPreviewChange={props.onPendingAnnotationPreviewChange}
          editorRef={controller.editorRef}
          sessionId={props.sessionId}
          sessionInfo={props.sessionInfo}
          placeholder={controller.placeholder}
          input={controller.composer.input}
          onInputChange={controller.onInputChange}
          onCursorChange={controller.onCursorChange}
          onKeyDown={controller.handleKeyDown}
          onPaste={controller.attachments.handlePaste}
          secondarySendShortcut={controller.secondarySendShortcut}
          onSecondarySendShortcut={controller.onSecondarySendShortcut}
          resolveCompletionMatch={controller.completion.resolveCompletionMatch}
          resolveTokenDecorations={controller.completion.resolveTokenDecorations}
          toolbarState={controller.toolbar.toolbarState}
          toolbarData={controller.toolbar.toolbarData}
          toolbarRefs={controller.toolbar.toolbarRefs}
          toolbarHandlers={controller.toolbar.toolbarHandlers}
          sessionTarget={props.sessionTarget}
          agentRoomTargetMembers={props.agentRoomTargetMembers}
          hideHeaderControls={props.hideHeaderControls}
          showStatusBarControlsInMore={props.showStatusBarControlsInMore}
          statusBarGitControlsInMore={props.statusBarGitControlsInMore}
          showContextPicker={controller.attachments.showContextPicker}
          onCancelContextPicker={controller.onCancelContextPicker}
          onConfirmContextPicker={controller.onConfirmContextPicker}
          voiceInput={controller.voiceInput}
        />
      )}
    </div>
  )

  if (hiddenVoiceInputMenu == null) return content

  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={hiddenVoiceInputMenu}
    >
      {content}
    </Dropdown>
  )
}
