import { Modal } from 'antd'
import { useCallback, useRef, useState } from 'react'

import type { PanelTabCloseFocusIntent } from './panel-tab-close-focus'

interface TerminalCloseModalState {
  activeTerminalCount: number
  epoch: number
  open: boolean
}

interface TerminalCloseModalFocus {
  intent: PanelTabCloseFocusIntent
  preferredTabId?: string
}

export function useTerminalCloseModalTransition(
  scheduleFocus: (focus: TerminalCloseModalFocus) => void
) {
  const [modalState, setModalState] = useState<TerminalCloseModalState | null>(null)
  const modalStateRef = useRef<TerminalCloseModalState | null>(null)
  const focusAfterHiddenRef = useRef<(TerminalCloseModalFocus & { epoch: number }) | null>(null)
  const nextEpochRef = useRef(0)
  const closingEpochRef = useRef<number | null>(null)
  const hideModal = useCallback((focus?: TerminalCloseModalFocus) => {
    const current = modalStateRef.current
    if (current == null) return
    const next = { ...current, open: false }
    modalStateRef.current = next
    closingEpochRef.current = current.epoch
    focusAfterHiddenRef.current = focus == null ? null : { ...focus, epoch: current.epoch }
    setModalState(next)
  }, [])
  const openModal = useCallback((activeTerminalCount: number) => {
    nextEpochRef.current += 1
    const next = { activeTerminalCount, epoch: nextEpochRef.current, open: true }
    modalStateRef.current = next
    setModalState(next)
  }, [])
  const onAfterHidden = useCallback((epoch: number) => {
    if (closingEpochRef.current !== epoch) return
    closingEpochRef.current = null
    if (modalStateRef.current?.epoch === epoch) {
      modalStateRef.current = null
      setModalState(null)
    }
    const focus = focusAfterHiddenRef.current
    focusAfterHiddenRef.current = null
    if (focus?.epoch === epoch) scheduleFocus(focus)
  }, [scheduleFocus])
  const isClosing = useCallback(() => closingEpochRef.current != null, [])
  return { hideModal, isClosing, modalState, onAfterHidden, openModal }
}

export function TerminalTabCloseFeedback({
  announcement,
  cancelText,
  confirmContent,
  confirmText,
  confirmTitle,
  confirming,
  open,
  onAfterHidden,
  onCancel,
  onConfirm,
  transitionEpoch
}: {
  announcement: string
  cancelText: string
  confirmContent: string
  confirmText: string
  confirmTitle: string
  confirming: boolean
  open: boolean
  onAfterHidden: (epoch: number) => void
  onCancel: () => void
  onConfirm: () => void
  transitionEpoch: number
}) {
  return (
    <>
      <span
        className='chat-terminal-close-live-region'
        role='alert'
        aria-atomic='true'
        aria-live='assertive'
      >
        {announcement}
      </span>
      <Modal
        cancelText={cancelText}
        destroyOnHidden
        focusTriggerAfterClose={false}
        keyboard
        maskClosable={false}
        okButtonProps={{ danger: true }}
        okText={confirmText}
        open={open}
        title={confirmTitle}
        confirmLoading={confirming}
        afterOpenChange={(isOpen) => {
          if (!isOpen) onAfterHidden(transitionEpoch)
        }}
        onCancel={onCancel}
        onOk={onConfirm}
      >
        <p>{confirmContent}</p>
      </Modal>
    </>
  )
}
