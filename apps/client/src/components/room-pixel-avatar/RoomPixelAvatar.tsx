import './RoomPixelAvatar.scss'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'

const ROOM_PIXEL_AVATAR_SIZE = 5

const palette = [
  ['#0f766e', '#14b8a6'],
  ['#1d4ed8', '#60a5fa'],
  ['#b45309', '#f59e0b'],
  ['#be123c', '#fb7185'],
  ['#4338ca', '#818cf8'],
  ['#15803d', '#4ade80'],
  ['#0e7490', '#22d3ee']
] as const

const hashSeed = (seed: string) => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const buildPixelMap = (seed: string) => {
  const hash = hashSeed(seed)
  const pixels: boolean[] = []

  for (let row = 0; row < ROOM_PIXEL_AVATAR_SIZE; row += 1) {
    const rowBits: boolean[] = []
    for (let col = 0; col < 3; col += 1) {
      const bit = ((hash >> ((row * 3 + col) % 24)) & 1) === 1
      rowBits.push(bit)
    }
    pixels.push(rowBits[0]!, rowBits[1]!, rowBits[2]!, rowBits[1]!, rowBits[0]!)
  }

  return {
    accent: palette[hash % palette.length]![0],
    accentSoft: palette[(hash >>> 4) % palette.length]![1],
    pixels
  }
}

export function RoomPixelAvatar({
  className,
  label,
  seed
}: {
  className?: string
  label?: string
  seed: string
}) {
  const avatar = useMemo(() => buildPixelMap(seed), [seed])
  const style = {
    '--room-pixel-avatar-accent': avatar.accent,
    '--room-pixel-avatar-accent-soft': avatar.accentSoft
  } as CSSProperties

  return (
    <span
      className={['room-pixel-avatar', className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-hidden={label == null ? true : undefined}
      style={style}
    >
      {avatar.pixels.map((filled, index) => (
        <span
          key={index}
          className={[
            'room-pixel-avatar__pixel',
            filled ? 'room-pixel-avatar__pixel--filled' : ''
          ].filter(Boolean).join(' ')}
        />
      ))}
    </span>
  )
}
