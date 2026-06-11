import { Button, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RoomContextMenu, isRoomArchived, isRoomFavorited } from './RoomContextMenu'
import type { SidebarRoomItem } from './conversation-items'

export function RoomItemActions({
  isTouchInteraction,
  onArchive,
  onFavorite,
  onSelect,
  room,
  showCompactActionMenu
}: {
  isTouchInteraction: boolean
  onArchive: (id: string, isArchived: boolean) => void | Promise<void>
  onFavorite: (id: string, isFavorited: boolean) => void | Promise<void>
  onSelect: (room: SidebarRoomItem) => void
  room: SidebarRoomItem
  showCompactActionMenu: boolean
}) {
  const { t } = useTranslation()
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const [pendingAction, setPendingAction] = useState<'archive' | null>(null)
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title

  useEffect(() => {
    if (pendingAction == null) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const nextTarget = event.target
      if (!(nextTarget instanceof Node)) {
        setPendingAction(null)
        return
      }

      if (!actionsRef.current?.contains(nextTarget)) {
        setPendingAction(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [pendingAction])

  const archiveActionLabel = isRoomArchived(room)
    ? t('agentRoom.sidebar.unarchiveRoom')
    : t('agentRoom.sidebar.archiveRoom')
  const archiveConfirmLabel = t('common.confirmAction', { action: archiveActionLabel })
  const moreActionsLabel = t('common.moreActions')

  const handleArchiveClick = () => {
    if (pendingAction === 'archive') {
      setPendingAction(null)
      void onArchive(room.id, !isRoomArchived(room))
      return
    }

    setPendingAction('archive')
  }

  const moreAction = (
    <RoomContextMenu
      room={room}
      trigger={['click']}
      onArchive={onArchive}
      onFavorite={onFavorite}
      onSelect={onSelect}
    >
      <Tooltip title={resolveTooltipTitle(moreActionsLabel)}>
        <Button
          type='text'
          size='small'
          className='room-item__action-btn room-item__action-btn--more'
          aria-label={moreActionsLabel}
          onClick={(event) => {
            event.stopPropagation()
          }}
          icon={<span className='material-symbols-rounded'>more_horiz</span>}
        />
      </Tooltip>
    </RoomContextMenu>
  )

  if (showCompactActionMenu) {
    return (
      <div ref={actionsRef} className='room-item__actions'>
        {moreAction}
      </div>
    )
  }

  return (
    <div ref={actionsRef} className='room-item__actions' onMouseLeave={() => setPendingAction(null)}>
      <Tooltip
        title={resolveTooltipTitle(
          isRoomFavorited(room) ? t('agentRoom.sidebar.unfavoriteRoom') : t('agentRoom.sidebar.favoriteRoom')
        )}
      >
        <Button
          type='text'
          size='small'
          className={`room-item__action-btn room-item__action-btn--favorite ${
            isRoomFavorited(room) ? 'is-favorited' : ''
          }`}
          onClick={(event) => {
            event.stopPropagation()
            setPendingAction(null)
            void onFavorite(room.id, !isRoomFavorited(room))
          }}
          icon={<span className='material-symbols-rounded'>star</span>}
        />
      </Tooltip>
      <Tooltip title={resolveTooltipTitle(pendingAction === 'archive' ? archiveConfirmLabel : archiveActionLabel)}>
        <Button
          type='text'
          size='small'
          className={`room-item__action-btn room-item__action-btn--archive ${
            pendingAction === 'archive' ? 'is-confirming' : ''
          }`}
          onClick={(event) => {
            event.stopPropagation()
            handleArchiveClick()
          }}
        >
          <span className='material-symbols-rounded'>
            {isRoomArchived(room) ? 'unarchive' : 'archive'}
          </span>
          {pendingAction === 'archive' && (
            <span className='room-item__action-label'>{archiveConfirmLabel}</span>
          )}
        </Button>
      </Tooltip>
      {moreAction}
    </div>
  )
}
