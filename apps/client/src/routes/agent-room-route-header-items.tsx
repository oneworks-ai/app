import type { TFunction } from 'i18next'

import type { ChatHeaderMoreItems } from '#~/components/chat/ChatHeader'
import { buildRoomUrl } from '#~/components/sidebar/RoomContextMenu'
import { copyTextWithFeedback } from '#~/utils/copy'

export function buildAgentRoomRouteHeaderItems({
  isRoomArchived,
  isRoomFavorited,
  messageApi,
  onToggleRoomArchive,
  onToggleRoomFavorite,
  roomId,
  t
}: {
  isRoomArchived: boolean
  isRoomFavorited: boolean
  messageApi: {
    error: (content: string) => unknown
    success: (content: string) => unknown
  }
  onToggleRoomArchive: () => void
  onToggleRoomFavorite: () => void
  roomId: string
  t: TFunction
}): ChatHeaderMoreItems {
  return [
    {
      key: 'favorite-room',
      label: isRoomFavorited ? t('agentRoom.sidebar.unfavoriteRoom') : t('agentRoom.sidebar.favoriteRoom'),
      icon: (
        <span className={`material-symbols-rounded chat-header-icon ${isRoomFavorited ? 'is-filled' : ''}`}>
          {isRoomFavorited ? 'star' : 'star_border'}
        </span>
      ),
      onClick: onToggleRoomFavorite
    },
    {
      key: 'archive-room',
      label: isRoomArchived ? t('agentRoom.sidebar.unarchiveRoom') : t('agentRoom.sidebar.archiveRoom'),
      icon: (
        <span className='material-symbols-rounded chat-header-icon'>
          {isRoomArchived ? 'unarchive' : 'archive'}
        </span>
      ),
      onClick: onToggleRoomArchive
    },
    { type: 'divider' },
    {
      key: 'copy-room-link',
      label: t('agentRoom.sidebar.copyRoomLink'),
      icon: <span className='material-symbols-rounded chat-header-icon'>link</span>,
      onClick: () => {
        void copyTextWithFeedback({
          text: buildRoomUrl(roomId),
          messageApi,
          successMessage: t('agentRoom.sidebar.roomLinkCopied'),
          failureMessage: t('common.copyFailed')
        })
      }
    },
    {
      key: 'copy-room-id',
      label: t('agentRoom.sidebar.copyRoomId'),
      icon: <span className='material-symbols-rounded chat-header-icon'>fingerprint</span>,
      onClick: () => {
        void copyTextWithFeedback({
          text: roomId,
          messageApi,
          successMessage: t('agentRoom.sidebar.roomIdCopied'),
          failureMessage: t('common.copyFailed')
        })
      }
    }
  ]
}
