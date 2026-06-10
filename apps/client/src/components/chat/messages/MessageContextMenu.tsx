import './MessageContextMenu.scss'

import { App, Drawer, Dropdown } from 'antd'
import { cloneElement, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChatMessage } from '@oneworks/core'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import { MessageContextMenuContent } from './MessageContextMenuContent'
import { buildMessageContextMenuEntries } from './build-message-context-menu-entries'

interface MessageContextMenuProps {
  anchorId: string
  canEdit: boolean
  canFork: boolean
  canRecall: boolean
  children: ReactElement
  copyableText?: string
  isDebugMode: boolean
  isEditing: boolean
  message: ChatMessage
  sessionId?: string
  onFork: () => void
  onRecall: () => void
  onStartEditing: () => void
}

type PendingMessageMenuAction = 'fork' | 'recall' | null

export function MessageContextMenu({
  anchorId,
  canEdit,
  canFork,
  canRecall,
  children,
  copyableText,
  isDebugMode,
  isEditing,
  message: sourceMessage,
  sessionId,
  onFork,
  onRecall,
  onStartEditing
}: MessageContextMenuProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const [open, setOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingMessageMenuAction>(null)
  const shouldUseBottomSheet = isCompactLayout || isTouchInteraction

  const closeMenu = () => {
    setOpen(false)
    setPendingAction(null)
  }

  const handleConfirmableActionClick = (action: Exclude<PendingMessageMenuAction, null>) => {
    if (pendingAction === action) {
      closeMenu()
      if (action === 'recall') {
        void onRecall()
        return
      }
      void onFork()
      return
    }

    setPendingAction(action)
  }

  const entries = buildMessageContextMenuEntries({
    anchorId,
    canEdit,
    canFork,
    canRecall,
    copyableText,
    isDebugMode,
    isEditing,
    messageApi: message,
    onCloseMenu: closeMenu,
    onConfirmableActionClick: handleConfirmableActionClick,
    onStartEditing,
    sessionId,
    sourceMessage,
    t
  })

  if (shouldUseBottomSheet) {
    const childProps = children.props as {
      onDoubleClick?: (event: MouseEvent<HTMLElement>) => void
    }
    const triggerElement = cloneElement(children, {
      onDoubleClick: (event: MouseEvent<HTMLElement>) => {
        childProps.onDoubleClick?.(event)
        if (event.defaultPrevented || isEditing) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setOpen(true)
      }
    })

    return (
      <>
        {triggerElement}
        <Drawer
          open={open}
          placement='bottom'
          height='auto'
          closable={false}
          className='message-context-menu-drawer'
          rootClassName='message-context-menu-drawer-root'
          onClose={closeMenu}
        >
          <div className='message-context-menu-sheet'>
            <div className='message-context-menu-sheet__handle' aria-hidden='true' />
            <div className='message-context-menu-sheet__header'>
              <span>{t('common.moreActions')}</span>
              <button
                type='button'
                className='message-context-menu-sheet__close'
                aria-label={t('common.close')}
                onClick={closeMenu}
              >
                <span className='material-symbols-rounded'>close</span>
              </button>
            </div>
            <MessageContextMenuContent
              entries={entries}
              pendingAction={pendingAction}
              onCancelConfirm={() => setPendingAction(null)}
            />
          </div>
        </Drawer>
      </>
    )
  }

  return (
    <Dropdown
      trigger={['contextMenu']}
      open={open}
      overlayClassName='message-context-menu-dropdown'
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setPendingAction(null)
        }
      }}
      popupRender={() => (
        <MessageContextMenuContent
          entries={entries}
          pendingAction={pendingAction}
          onCancelConfirm={() => setPendingAction(null)}
        />
      )}
    >
      {children}
    </Dropdown>
  )
}
