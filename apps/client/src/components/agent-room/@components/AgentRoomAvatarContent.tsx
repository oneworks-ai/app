import { useState } from 'react'

import { getWorkspaceResourceUrl } from '#~/api'
import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'

import type { AgentRoomMemberView } from '../@types/agent-room-view'

const isRemoteAvatar = (value: string) => /^(?:blob:|data:|https?:\/\/)/u.test(value)

export const resolveAgentRoomAvatar = (value: string | undefined) => {
  const avatar = value?.trim()
  if (avatar == null || avatar === '') return undefined
  return isRemoteAvatar(avatar) ? avatar : getWorkspaceResourceUrl(avatar)
}

export function AgentRoomAvatarContent({
  imageClassName,
  member,
  pixelClassName
}: {
  imageClassName?: string
  member: Pick<AgentRoomMemberView, 'avatar' | 'avatarLabel' | 'memberKey'>
  pixelClassName: string
}) {
  const avatar = resolveAgentRoomAvatar(member.avatar)
  const [failedAvatar, setFailedAvatar] = useState<string>()
  if (avatar != null && failedAvatar !== avatar) {
    return <img alt='' className={imageClassName} onError={() => setFailedAvatar(avatar)} src={avatar} />
  }

  const avatarLabel = member.avatarLabel?.trim()
  if (avatarLabel != null && avatarLabel !== '') return avatarLabel

  return <RoomPixelAvatar className={pixelClassName} seed={`entity:${member.memberKey}`} />
}
