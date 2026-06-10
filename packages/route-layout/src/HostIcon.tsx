import { useMemo } from 'react'

import { createMobiusSvg } from '@oneworks/icon/svg'
import type { OneWorksIconBackgroundStyle, OneWorksIconMode, OneWorksIconTheme } from '@oneworks/icon/types'

export interface HostMaterialIconProps {
  name: string
  className?: string
  filled?: boolean
}

export function HostMaterialIcon({ className, filled = false, name }: HostMaterialIconProps) {
  return (
    <span
      className={[
        'material-symbols-rounded',
        'host-material-icon',
        filled ? 'is-filled filled' : '',
        className
      ].filter(Boolean).join(' ')}
      aria-hidden='true'
    >
      {name}
    </span>
  )
}

export interface HostVibeIconProps {
  className?: string
  mode?: OneWorksIconMode
  theme?: OneWorksIconTheme
  title?: string
  backgroundStyle?: OneWorksIconBackgroundStyle
  noBackground?: boolean
  size?: number
}

export function HostVibeIcon({
  backgroundStyle,
  className,
  mode = 'light',
  noBackground = true,
  size = 64,
  theme = 'industrial',
  title = 'oneworks icon'
}: HostVibeIconProps) {
  const iconSrc = useMemo(() => {
    const svg = createMobiusSvg({
      backgroundStyle: noBackground ? undefined : backgroundStyle ?? 'textured',
      mode,
      noBackground,
      shadow: false,
      size,
      theme,
      title
    })

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }, [backgroundStyle, mode, noBackground, size, theme, title])

  return (
    <img
      className={['host-vibe-icon', className].filter(Boolean).join(' ')}
      src={iconSrc}
      alt=''
      aria-hidden='true'
    />
  )
}
