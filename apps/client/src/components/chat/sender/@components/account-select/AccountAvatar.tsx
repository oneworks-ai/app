import './AccountAvatar.scss'

import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'

const normalizeOptionalText = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const getAccountAvatarSeed = (option: ChatAdapterAccountOption) => (
  normalizeOptionalText(option.email) ??
    normalizeOptionalText(option.label) ??
    option.value
)

export function AccountAvatar({
  option,
  size = 'option'
}: {
  option: ChatAdapterAccountOption
  size?: 'control' | 'option'
}) {
  const avatarUrl = normalizeOptionalText(option.avatarUrl)

  return (
    <span className={`account-avatar account-avatar--${size}`} aria-hidden='true'>
      <RoomPixelAvatar
        className='account-avatar__pixel'
        seed={`adapter-account:${getAccountAvatarSeed(option)}`}
      />
      {avatarUrl != null && (
        <img
          className='account-avatar__image'
          src={avatarUrl}
          alt=''
          referrerPolicy='no-referrer'
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      )}
    </span>
  )
}
