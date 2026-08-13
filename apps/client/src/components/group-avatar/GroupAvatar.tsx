import './GroupAvatar.scss'

import { createSeededAvatarDataUri } from '@oneworks/avatar'
import type { CSSProperties } from 'react'

import { getWorkspaceResourceUrl } from '#~/api'

export interface GroupAvatarMember {
  avatar?: string
  key: string
  label?: string
}

const resolveAvatarUrl = (member: GroupAvatarMember) => {
  const avatar = member.avatar?.trim()
  if (avatar != null && avatar !== '') {
    return /^(?:blob:|data:|https?:\/\/)/u.test(avatar)
      ? avatar
      : getWorkspaceResourceUrl(avatar)
  }
  return createSeededAvatarDataUri({
    seed: `entity:${member.key}`,
    size: 72,
    title: member.label ?? member.key
  })
}

const resolvePlacements = (count: number) => {
  if (count <= 1) return [{ size: 100, x: 0, y: 0 }]
  if (count === 2) {
    return [
      { size: 50, x: 0, y: 25 },
      { size: 50, x: 50, y: 25 }
    ]
  }
  if (count === 3) {
    return [
      { size: 50, x: 25, y: 0 },
      { size: 50, x: 0, y: 50 },
      { size: 50, x: 50, y: 50 }
    ]
  }
  if (count === 4) {
    return [
      { size: 50, x: 0, y: 0 },
      { size: 50, x: 50, y: 0 },
      { size: 50, x: 0, y: 50 },
      { size: 50, x: 50, y: 50 }
    ]
  }

  const size = 100 / 3
  const rowCount = Math.ceil(count / 3)
  const firstRowCount = count % 3 || 3
  const yOffset = (100 - rowCount * size) / 2

  return Array.from({ length: count }, (_, index) => {
    const row = index < firstRowCount
      ? 0
      : 1 + Math.floor((index - firstRowCount) / 3)
    const column = index < firstRowCount
      ? index
      : (index - firstRowCount) % 3
    const itemsInRow = row === 0 ? firstRowCount : 3
    const xOffset = (100 - itemsInRow * size) / 2
    return {
      size,
      x: xOffset + column * size,
      y: yOffset + row * size
    }
  })
}

export function GroupAvatar({
  className,
  label,
  members
}: {
  className?: string
  label?: string
  members: GroupAvatarMember[]
}) {
  const visibleMembers = members.slice(0, 9)
  const cells = visibleMembers.length === 0
    ? [{ key: label?.trim() || 'group', label }]
    : visibleMembers
  const placements = resolvePlacements(cells.length)

  return (
    <span
      aria-label={label}
      aria-hidden={label == null ? true : undefined}
      className={['group-avatar', className].filter(Boolean).join(' ')}
      role={label == null ? undefined : 'img'}
    >
      {cells.map((member, index) => (
        <span
          className='group-avatar__cell'
          key={member.key}
          style={{
            '--group-avatar-cell-size': `${placements[index].size}%`,
            '--group-avatar-cell-x': `${placements[index].x}%`,
            '--group-avatar-cell-y': `${placements[index].y}%`
          } as CSSProperties}
        >
          <img alt='' draggable={false} src={resolveAvatarUrl(member)} />
        </span>
      ))}
    </span>
  )
}
