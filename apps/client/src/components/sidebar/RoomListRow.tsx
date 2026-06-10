import { Checkbox } from 'antd'

import { RoomItem } from './RoomItem'
import type { SidebarRoomItem } from './conversation-items'
import { getRoomSidebarId } from './conversation-items'

interface RoomListRowProps {
  activeId?: string
  isBatchMode: boolean
  isCompactLayout: boolean
  isTouchInteraction: boolean
  room: SidebarRoomItem
  selectedIds: Set<string>
  onArchiveRoom: (id: string, isArchived: boolean) => void | Promise<void>
  onFavoriteRoom: (id: string, isFavorited: boolean) => void | Promise<void>
  onSelectRoom: (room: SidebarRoomItem) => void
  onToggleSelect: (id: string) => void
}

export function RoomListRow({
  activeId,
  isBatchMode,
  isCompactLayout,
  isTouchInteraction,
  room,
  selectedIds,
  onArchiveRoom,
  onFavoriteRoom,
  onSelectRoom,
  onToggleSelect
}: RoomListRowProps) {
  const roomSidebarId = getRoomSidebarId(room.id)
  const isSelected = selectedIds.has(roomSidebarId)

  return (
    <div
      className={[
        'session-row',
        'session-row--room',
        activeId === roomSidebarId ? 'is-active' : '',
        isSelected ? 'is-selected' : ''
      ].filter(Boolean).join(' ')}
    >
      <div className='session-row-main'>
        {isBatchMode && (
          <div
            className='session-select-toggle'
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onChange={() => onToggleSelect(roomSidebarId)}
            />
          </div>
        )}
        <RoomItem
          room={room}
          isActive={activeId === roomSidebarId}
          isBatchMode={isBatchMode}
          isCompactLayout={isCompactLayout}
          isSelected={isSelected}
          isTouchInteraction={isTouchInteraction}
          onArchive={onArchiveRoom}
          onFavorite={onFavoriteRoom}
          onSelect={(selectedRoom) => {
            if (isBatchMode) {
              onToggleSelect(roomSidebarId)
              return
            }

            onSelectRoom(selectedRoom)
          }}
        />
      </div>
    </div>
  )
}
