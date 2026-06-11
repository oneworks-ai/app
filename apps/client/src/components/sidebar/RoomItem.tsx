import './RoomItem.scss'

import { List, Tooltip } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'

import { RoomContextMenu, isRoomFavorited } from './RoomContextMenu'
import { RoomItemActions } from './RoomItemActions'
import type { SidebarRoomItem } from './conversation-items'
import { formatSidebarTimeDisplay } from './sidebar-time-display'
import { SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS } from './sidebar-tooltip'

export { buildRoomUrl, createRoomOperationMenuEntries } from './RoomContextMenu'

export function RoomItem({
  isActive,
  isBatchMode,
  isCompactLayout,
  isSelected,
  isTouchInteraction,
  onArchive,
  onFavorite,
  onSelect,
  room
}: {
  isActive: boolean
  isBatchMode: boolean
  isCompactLayout: boolean
  isSelected: boolean
  isTouchInteraction: boolean
  onArchive: (id: string, isArchived: boolean) => void | Promise<void>
  onFavorite: (id: string, isFavorited: boolean) => void | Promise<void>
  onSelect: (room: SidebarRoomItem) => void
  room: SidebarRoomItem
}) {
  const { t, i18n } = useTranslation()
  const showCompactActionMenu = isCompactLayout || isTouchInteraction
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title

  const timeDisplay = useMemo(() => {
    return formatSidebarTimeDisplay(room.updatedAt ?? room.createdAt, i18n.resolvedLanguage ?? i18n.language)
  }, [i18n.language, i18n.resolvedLanguage, room.createdAt, room.updatedAt])
  const createdTimeDisplay = useMemo(() => {
    return formatSidebarTimeDisplay(room.createdAt, i18n.resolvedLanguage ?? i18n.language)
  }, [i18n.language, i18n.resolvedLanguage, room.createdAt])

  const titleTooltipContent = isTouchInteraction
    ? undefined
    : (
      <div className='room-title-tooltip'>
        <div className='room-title-tooltip__title'>
          {room.title}
        </div>
        <div className='room-title-tooltip__time'>
          {t('common.createdAt')}: {createdTimeDisplay.full}
        </div>
      </div>
    )

  const item = (
    <List.Item
      onClick={() => onSelect(room)}
      className={`room-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${
        isRoomFavorited(room) ? 'room-item--favorited' : ''
      } ${isBatchMode ? 'room-item--batch' : ''} ${isCompactLayout ? 'room-item--compact' : ''} ${
        showCompactActionMenu ? 'room-item--touch' : ''
      }`}
    >
      <div className='room-item__content'>
        <div className={`room-item__leading room-item__leading--${room.status}`}>
          <RoomPixelAvatar className='room-item__avatar' seed={room.id} />
        </div>
        <div className='room-item__info'>
          <div className='room-item__header'>
            <div className='room-item__title'>
              <Tooltip title={titleTooltipContent} mouseEnterDelay={SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS}>
                <span className='room-item__title-text'>{room.title}</span>
              </Tooltip>
              {isRoomFavorited(room) && (
                <Tooltip title={resolveTooltipTitle(t('agentRoom.sidebar.favoritedRoom'))}>
                  <span
                    className='material-symbols-rounded room-item__favorite-icon'
                    aria-label={t('agentRoom.sidebar.favoritedRoom')}
                  >
                    star
                  </span>
                </Tooltip>
              )}
            </div>
            {!isBatchMode && (
              <div className='room-item__header-side'>
                {!isCompactLayout && (
                  <Tooltip
                    title={resolveTooltipTitle(timeDisplay.full)}
                    mouseEnterDelay={SIDEBAR_DETAIL_TOOLTIP_DELAY_SECONDS}
                  >
                    <span className='room-item__time'>{timeDisplay.relative}</span>
                  </Tooltip>
                )}
                <RoomItemActions
                  room={room}
                  isTouchInteraction={isTouchInteraction}
                  showCompactActionMenu={showCompactActionMenu}
                  onArchive={onArchive}
                  onFavorite={onFavorite}
                  onSelect={onSelect}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </List.Item>
  )

  return (
    <RoomContextMenu
      room={room}
      onArchive={onArchive}
      onFavorite={onFavorite}
      onSelect={onSelect}
    >
      {item}
    </RoomContextMenu>
  )
}
