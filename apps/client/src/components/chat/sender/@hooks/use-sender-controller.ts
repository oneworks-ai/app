/* eslint-disable max-lines */
import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { buildSenderControllerResult } from '#~/components/chat/sender/@core/build-sender-controller-result'
import { buildSenderToolbar } from '#~/components/chat/sender/@core/build-sender-toolbar'
import { getSenderInteractionState } from '#~/components/chat/sender/@core/get-sender-interaction-state'
import { getSenderRuntimeState } from '#~/components/chat/sender/@core/get-sender-runtime-state'
import type { SenderProps } from '#~/components/chat/sender/@types/sender-props'

import { useSenderAttachments } from './use-sender-attachments'
import { useSenderAutofocus } from './use-sender-autofocus'
import { useSenderCompletion } from './use-sender-completion'
import { useSenderComposerState } from './use-sender-composer-state'
import { useSenderFocusRestore } from './use-sender-focus-restore'
import { useSenderHistory } from './use-sender-history'
import { useSenderKeydown } from './use-sender-keydown'
import { useSenderReferenceActions } from './use-sender-reference-actions'
import { useSenderReferenceFocusRestore } from './use-sender-reference-focus-restore'
import { useSenderRefs } from './use-sender-refs'
import { useSenderSelectOverlays } from './use-sender-select-overlays'
import { useSenderShortcuts } from './use-sender-shortcuts'
import { useSenderSubmit } from './use-sender-submit'
import { useSenderVoiceInput } from './use-sender-voice-input'

const mergePendingContextFiles = <T extends { path: string }>(current: T[], incoming: T[]) => {
  const nextByPath = new Map(current.map(file => [file.path, file]))
  for (const file of incoming) {
    if (file.path.trim() === '') {
      continue
    }
    nextByPath.set(file.path, file)
  }
  return Array.from(nextByPath.values())
}

export const useSenderController = (props: SenderProps) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { editorRef, fileInputRef, modelSelectRef, effortSelectRef } = useSenderRefs()
  const handledContextReferenceRequestIdRef = useRef<number | null>(null)
  const handledAnnotationReferenceRequestIdRef = useRef<number | null>(null)
  const handledTextSelectionReferenceRequestIdRef = useRef<number | null>(null)
  const handledPendingReferenceDraftRequestIdRef = useRef<number | null>(null)
  const { isInlineEdit, isMac, isThinking, isBusy, supportsEffort } = getSenderRuntimeState(props)
  const composer = useSenderComposerState(props.initialContent)
  const completion = useSenderCompletion({
    initialContent: props.initialContent,
    input: composer.input,
    setInput: composer.setInput,
    sessionInfo: props.sessionInfo,
    editorRef
  })
  const history = useSenderHistory({
    initialContent: props.initialContent,
    input: composer.input,
    setInput: composer.setInput,
    editorRef
  })
  const attachments = useSenderAttachments({
    initialContent: props.initialContent,
    isBusy,
    isInlineEdit,
    modelUnavailable: props.modelUnavailable,
    interactionRequest: props.interactionRequest,
    message,
    t,
    fileInputRef,
    setPendingImages: composer.setPendingImages,
    setPendingFiles: composer.setPendingFiles
  })
  const referenceActions = useSenderReferenceActions({
    initialContent: props.initialContent,
    isInlineEdit,
    permissionMode: props.permissionMode ?? 'default',
    permissionModeValues: (props.permissionModeOptions ?? []).map(option => option.value),
    onPermissionSelect: (mode) => props.onPermissionModeChange?.(mode),
    onReferenceImageSelect: attachments.handleImageUpload,
    onOpenContextPicker: attachments.handleOpenContextPicker
  })
  const selectOverlays = useSenderSelectOverlays({
    initialContent: props.initialContent,
    isInlineEdit,
    isThinking,
    modelUnavailable: props.modelUnavailable,
    supportsEffort,
    modelSelectRef,
    effortSelectRef
  })
  const focusRestore = useSenderFocusRestore({
    editorRef,
    suspended: selectOverlays.showModelSelect || selectOverlays.showEffortSelect ||
      referenceActions.showReferenceActions || attachments.showContextPicker
  })
  const { hideSender, permissionContext } = getSenderInteractionState({
    interactionRequest: props.interactionRequest,
    isInlineEdit
  })
  const isPermissionInteraction = !isInlineEdit && props.interactionRequest?.payload.kind === 'permission'
  const showConfirmInteractionAction = isPermissionInteraction &&
    (props.interactionOptionNavigation?.optionCount ?? 0) > 0
  const sendBlockedTooltip = isPermissionInteraction ? t('chat.permissionSendBlockedTooltip') : undefined
  const { clearInputShortcut, composerControlShortcuts, resolvedSendShortcut, queuedMessageShortcuts } =
    useSenderShortcuts({
      enabled: !hideSender && !attachments.showContextPicker && !isInlineEdit,
      isInlineEdit,
      isMac,
      isThinking,
      modelUnavailable: props.modelUnavailable,
      permissionModeOptions: props.permissionModeOptions ?? [],
      referenceActions,
      selectOverlays
    })

  const resetComposer = () => {
    composer.resetComposerContent()
    completion.resetCompletion()
    history.resetHistory()
    attachments.resetAttachmentUi()
    selectOverlays.resetSelectOverlays()
    referenceActions.resetReferenceActions()
  }
  const handleInterrupt = props.stopLoading === true ? () => undefined : props.onInterrupt
  const handleSend = useSenderSubmit({
    getInput: () => editorRef.current?.getValue() ?? composer.input,
    pendingImages: composer.pendingImages,
    pendingFiles: composer.pendingFiles,
    pendingAnnotations: composer.pendingAnnotations,
    pendingTextSelections: composer.pendingTextSelections,
    isBusy,
    allowWhileBusy: isThinking,
    isInlineEdit,
    modelUnavailable: props.modelUnavailable,
    interactionRequest: props.interactionRequest,
    onInteractionResponse: props.onInteractionResponse,
    onSend: props.onSend,
    onSendContent: props.onSendContent,
    message,
    t,
    resetComposer
  })
  const handleBlockedSendAttempt = () => {
    void message.error({
      content: t('chat.permissionSendBlockedError'),
      key: 'chat-permission-send-blocked'
    })
  }
  const triggerSend = (mode?: 'steer' | 'next') => {
    if (props.hideSubmitAction === true) {
      return
    }
    if (isPermissionInteraction) {
      handleBlockedSendAttempt()
      return
    }

    void handleSend(mode)
  }
  const notifyVoiceError = useCallback((content: string) => {
    void message.error({ content, key: 'chat-voice-input-error' })
  }, [message])
  const notifyVoiceWarning = useCallback((content: string) => {
    void message.warning({ content, key: 'chat-voice-input-warning' })
  }, [message])
  const notifyVoiceSuccess = useCallback((content: string) => {
    void message.success({ content, key: 'chat-voice-input-success' })
  }, [message])
  const voiceInput = useSenderVoiceInput({
    canSendAfterTranscription: props.hideSubmitAction !== true &&
      !props.modelUnavailable &&
      !isPermissionInteraction &&
      props.submitLoading !== true,
    canStartRecording: !isBusy && !props.modelUnavailable && !isPermissionInteraction,
    editorRef,
    enabled: props.enableVoiceInput === true && !isInlineEdit && !hideSender,
    input: composer.input,
    notifyError: notifyVoiceError,
    notifySuccess: notifyVoiceSuccess,
    notifyWarning: notifyVoiceWarning,
    onInputChange: props.onInputChange,
    onSendAfterTranscription: () => triggerSend(),
    setInput: composer.setInput
  })

  useEffect(() => {
    const request = props.contextReferenceRequest
    if (request == null || request.files.length === 0 || isInlineEdit) {
      return
    }
    if (handledContextReferenceRequestIdRef.current === request.id) {
      return
    }
    handledContextReferenceRequestIdRef.current = request.id
    if (props.modelUnavailable) {
      void message.warning(t('chat.modelConfigRequired'))
      return
    }
    if (props.interactionRequest != null) {
      void message.warning(t('chat.fileNotSupportedInInteraction'))
      return
    }

    composer.setPendingFiles(current => mergePendingContextFiles(current, request.files))
    focusRestore.queueEditorFocusRestore()
  }, [
    focusRestore,
    isInlineEdit,
    message,
    composer.setPendingFiles,
    props.contextReferenceRequest,
    props.interactionRequest,
    props.modelUnavailable,
    t
  ])

  useEffect(() => {
    const request = props.annotationReferenceRequest
    if (request == null || request.annotations.length === 0 || isInlineEdit) {
      return
    }
    if (handledAnnotationReferenceRequestIdRef.current === request.id) {
      return
    }
    handledAnnotationReferenceRequestIdRef.current = request.id
    if (props.modelUnavailable) {
      void message.warning(t('chat.modelConfigRequired'))
      return
    }
    if (props.interactionRequest != null) {
      void message.warning(t('chat.fileNotSupportedInInteraction'))
      return
    }

    composer.setPendingAnnotations(current => [...current, ...request.annotations])
    focusRestore.queueEditorFocusRestore()
  }, [
    composer.setPendingAnnotations,
    focusRestore,
    isInlineEdit,
    message,
    props.annotationReferenceRequest,
    props.interactionRequest,
    props.modelUnavailable,
    t
  ])

  useEffect(() => {
    const request = props.textSelectionReferenceRequest
    if (request == null || request.selections.length === 0 || isInlineEdit) {
      return
    }
    if (handledTextSelectionReferenceRequestIdRef.current === request.id) {
      return
    }
    handledTextSelectionReferenceRequestIdRef.current = request.id
    if (props.modelUnavailable) {
      void message.warning(t('chat.modelConfigRequired'))
      return
    }
    if (props.interactionRequest != null) {
      void message.warning(t('chat.fileNotSupportedInInteraction'))
      return
    }

    composer.setPendingTextSelections(current => [...current, ...request.selections])
    focusRestore.queueEditorFocusRestore()
  }, [
    composer.setPendingTextSelections,
    focusRestore,
    isInlineEdit,
    message,
    props.interactionRequest,
    props.modelUnavailable,
    props.textSelectionReferenceRequest,
    t
  ])

  useEffect(() => {
    const request = props.pendingReferenceDraftRequest
    if (request == null || isInlineEdit) {
      return
    }
    if (handledPendingReferenceDraftRequestIdRef.current === request.id) {
      return
    }
    handledPendingReferenceDraftRequestIdRef.current = request.id

    composer.setPendingImages(request.pendingImages)
    composer.setPendingFiles(request.pendingFiles)
    composer.setPendingAnnotations(request.pendingAnnotations)
    composer.setPendingTextSelections(request.pendingTextSelections)
    focusRestore.queueEditorFocusRestore()
  }, [
    composer.setPendingAnnotations,
    composer.setPendingFiles,
    composer.setPendingImages,
    composer.setPendingTextSelections,
    focusRestore,
    isInlineEdit,
    props.pendingReferenceDraftRequest
  ])

  useEffect(() => {
    if (isInlineEdit) return
    props.onPendingReferenceDraftChange?.({
      pendingImages: composer.pendingImages,
      pendingFiles: composer.pendingFiles,
      pendingAnnotations: composer.pendingAnnotations,
      pendingTextSelections: composer.pendingTextSelections
    })
  }, [
    composer.pendingAnnotations,
    composer.pendingFiles,
    composer.pendingImages,
    composer.pendingTextSelections,
    isInlineEdit,
    props.onPendingReferenceDraftChange
  ])

  useEffect(() => {
    if (isInlineEdit) return
    props.onPendingAnnotationCountChange?.(composer.pendingAnnotations.length)
  }, [
    composer.pendingAnnotations.length,
    isInlineEdit,
    props.onPendingAnnotationCountChange
  ])

  useSenderAutofocus({ autoFocus: props.autoFocus === true, autoFocusKey: props.autoFocusKey, editorRef })
  useSenderReferenceFocusRestore({ focusRestore, referenceActions })

  const handleKeyDown = useSenderKeydown({
    editorRef,
    isMac,
    clearInputShortcut,
    isInlineEdit,
    isThinking,
    input: composer.input,
    pendingImageCount: composer.pendingImages.length,
    pendingFileCount: composer.pendingFiles.length + composer.pendingAnnotations.length +
      composer.pendingTextSelections.length,
    interactionOptionCount: props.interactionOptionNavigation?.optionCount ?? 0,
    onCancel: props.onCancel,
    onClear: props.onClear,
    onInteractionOptionMove: props.interactionOptionNavigation?.onMove,
    onInteractionOptionSubmit: props.interactionOptionNavigation?.onSubmit,
    onInterrupt: handleInterrupt,
    onInterruptHint: () => {
      void message.open({
        type: 'info',
        content: t('chat.queue.stopShortcutConfirm'),
        duration: 1.6,
        key: 'chat-stop-shortcut-confirm'
      })
    },
    onResetComposer: resetComposer,
    showReferenceActions: referenceActions.showReferenceActions,
    onCloseReferenceActions: () => referenceActions.closeReferenceActions({ restoreFocus: true }),
    showModelSelect: selectOverlays.showModelSelect,
    onCloseModelSelect: () => {
      selectOverlays.setShowModelSelect(false)
      focusRestore.queueEditorFocusRestore()
    },
    showEffortSelect: selectOverlays.showEffortSelect,
    onCloseEffortSelect: () => {
      selectOverlays.setShowEffortSelect(false)
      focusRestore.queueEditorFocusRestore()
    },
    showCompletion: completion.showCompletion,
    historyIndex: history.historyIndex,
    onHistoryNavigate: history.handleHistoryNavigation,
    onInputClear: history.clearInputValue
  })
  const toolbar = buildSenderToolbar({
    attachments,
    callbacks: { onSend: triggerSend },
    composer: {
      input: composer.input,
      pendingImageCount: composer.pendingImages.length,
      pendingFileCount: composer.pendingFiles.length + composer.pendingAnnotations.length +
        composer.pendingTextSelections.length
    },
    composerControlShortcuts,
    focusRestore,
    isBusy,
    isInlineEdit,
    isMac,
    isThinking,
    sendBlocked: isPermissionInteraction,
    sendBlockedTooltip,
    showConfirmInteractionAction,
    confirmInteractionLabel: showConfirmInteractionAction ? t('chat.permissionConfirmOption') : undefined,
    onConfirmInteractionOption: showConfirmInteractionAction ? props.interactionOptionNavigation?.onSubmit : undefined,
    message,
    props,
    refs: { fileInputRef, modelSelectRef, effortSelectRef },
    referenceActions,
    queuedMessageShortcuts,
    resolvedSendShortcut,
    selectOverlays,
    supportsEffort,
    t
  })

  const controller = buildSenderControllerResult({
    attachments,
    completion,
    composer,
    focusRestore,
    handleKeyDown,
    hideSender,
    interactionRequest: props.interactionRequest,
    interactionResponse: props.onInteractionResponse,
    isBusy,
    isInlineEdit,
    isThinking,
    modelUnavailable: props.modelUnavailable,
    permissionContext,
    editorRef,
    placeholder: props.placeholder ?? props.interactionRequest?.payload.question ?? t('chat.inputPlaceholder'),
    secondarySendShortcut: isThinking && !isPermissionInteraction ? queuedMessageShortcuts.queueNext : undefined,
    onSecondarySendShortcut: isThinking && !isPermissionInteraction
      ? () => {
        void handleSend('next')
      }
      : undefined,
    toolbar,
    voiceInput
  })

  return {
    ...controller,
    onInputChange: (value: string, cursorOffset: number | null) => {
      controller.onInputChange(value, cursorOffset)
      props.onInputChange?.(value)
    }
  }
}
