import { App, Dropdown } from 'antd'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { getClientBase } from '#~/runtime-config.js'
import { copyTextWithFeedback } from '#~/utils/copy.js'

import { SessionContextMenuContent } from './SessionContextMenuContent'
import type { SessionContextMenuEntry } from './SessionContextMenuContent'
import type { SidebarRoomItem } from './conversation-items'

export const buildRoomUrl = (roomId: string) => {
  const url = new URL(globalThis.location.origin)
  const clientBase = getClientBase().replace(/\/+$/, '')
  const routeBase = clientBase === '' ? '' : clientBase
  url.pathname = `${routeBase}/rooms/${encodeURIComponent(roomId)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

interface RoomOperationMenuLabels {
  archiveRoom: string
  confirmArchiveRoom: string
  copyRoomId: string
  copyRoomLink: string
  favoriteRoom: string
  openRoom: string
}

interface RoomOperationMenuHandlers {
  onArchive: () => void
  onCopyId: () => void
  onCopyLink: () => void
  onFavorite: () => void
  onOpen: () => void
}

export const isRoomArchived = (room: SidebarRoomItem) => room.archivedAt != null
export const isRoomFavorited = (room: SidebarRoomItem) => room.favoritedAt != null

export function createRoomOperationMenuEntries({
  handlers,
  labels,
  room
}: {
  handlers: RoomOperationMenuHandlers
  labels: RoomOperationMenuLabels
  room: SidebarRoomItem
}): SessionContextMenuEntry[] {
  const favorited = isRoomFavorited(room)
  const archived = isRoomArchived(room)

  return [
    {
      key: 'open-room',
      label: labels.openRoom,
      icon: 'open_in_new',
      onClick: handlers.onOpen
    },
    { key: 'divider-metadata', type: 'divider', label: '', icon: '', onClick: () => undefined },
    {
      key: 'favorite-room',
      label: labels.favoriteRoom,
      icon: favorited ? 'star' : 'star_border',
      onClick: handlers.onFavorite
    },
    {
      key: 'archive-room',
      label: labels.archiveRoom,
      confirmLabel: labels.confirmArchiveRoom,
      icon: archived ? 'unarchive' : 'archive',
      onClick: handlers.onArchive
    },
    { key: 'divider-copy', type: 'divider', label: '', icon: '', onClick: () => undefined },
    {
      key: 'copy-room-link',
      label: labels.copyRoomLink,
      icon: 'link',
      onClick: handlers.onCopyLink
    },
    {
      key: 'copy-room-id',
      label: labels.copyRoomId,
      icon: 'fingerprint',
      onClick: handlers.onCopyId
    }
  ]
}

export function RoomContextMenu({
  children,
  onArchive,
  onFavorite,
  onSelect,
  room,
  trigger = ['contextMenu']
}: {
  children: ReactElement
  onArchive: (id: string, isArchived: boolean) => void | Promise<void>
  onFavorite: (id: string, isFavorited: boolean) => void | Promise<void>
  onSelect: (room: SidebarRoomItem) => void
  room: SidebarRoomItem
  trigger?: ('click' | 'contextMenu')[]
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'archive-room' | null>(null)

  const closeMenu = () => {
    setOpen(false)
    setPendingAction(null)
  }

  const archiveActionLabel = isRoomArchived(room)
    ? t('agentRoom.sidebar.unarchiveRoom')
    : t('agentRoom.sidebar.archiveRoom')

  const handleArchiveClick = () => {
    if (pendingAction === 'archive-room') {
      closeMenu()
      void onArchive(room.id, !isRoomArchived(room))
      return
    }

    setPendingAction('archive-room')
  }

  const entries = createRoomOperationMenuEntries({
    room,
    labels: {
      openRoom: t('agentRoom.sidebar.openRoom'),
      favoriteRoom: isRoomFavorited(room)
        ? t('agentRoom.sidebar.unfavoriteRoom')
        : t('agentRoom.sidebar.favoriteRoom'),
      archiveRoom: archiveActionLabel,
      confirmArchiveRoom: t('common.confirmAction', { action: archiveActionLabel }),
      copyRoomLink: t('agentRoom.sidebar.copyRoomLink'),
      copyRoomId: t('agentRoom.sidebar.copyRoomId')
    },
    handlers: {
      onOpen: () => {
        closeMenu()
        onSelect(room)
      },
      onFavorite: () => {
        closeMenu()
        void onFavorite(room.id, !isRoomFavorited(room))
      },
      onArchive: handleArchiveClick,
      onCopyLink: () => {
        closeMenu()
        void copyTextWithFeedback({
          text: buildRoomUrl(room.id),
          messageApi: message,
          successMessage: t('agentRoom.sidebar.roomLinkCopied'),
          failureMessage: t('common.copyFailed')
        })
      },
      onCopyId: () => {
        closeMenu()
        void copyTextWithFeedback({
          text: room.id,
          messageApi: message,
          successMessage: t('agentRoom.sidebar.roomIdCopied'),
          failureMessage: t('common.copyFailed')
        })
      }
    }
  })

  return (
    <Dropdown
      trigger={trigger}
      open={open}
      overlayClassName='session-context-menu-dropdown'
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setPendingAction(null)
        }
      }}
      popupRender={() => (
        <SessionContextMenuContent
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
