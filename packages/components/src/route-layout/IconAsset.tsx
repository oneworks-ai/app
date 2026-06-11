import { isValidElement } from 'react'
import type { ReactNode } from 'react'

import { MaterialSymbol } from './MaterialSymbol.js'

export type IconAssetSource =
  | ReactNode
  | string
  | {
    filled?: boolean
    name: string
    type: 'material'
  }
  | {
    svg: string
    title?: string
    type: 'svg'
  }
  | {
    alt?: string
    src: string
    type: 'image'
  }

export interface StatefulIconAsset {
  active: IconAssetSource
  inactive: IconAssetSource
}

export type IconAsset = IconAssetSource | StatefulIconAsset

const isPlainIconObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isValidElement(value)
)

export const isStatefulIconAsset = (icon: IconAsset): icon is StatefulIconAsset => (
  isPlainIconObject(icon) && 'active' in icon && 'inactive' in icon
)

export const resolveIconAssetSource = (
  icon: IconAsset | undefined,
  active: boolean
): IconAssetSource | undefined => {
  if (icon == null) return undefined
  if (isStatefulIconAsset(icon)) return active ? icon.active : icon.inactive
  return icon
}

export const renderIconAsset = ({
  active,
  className,
  icon,
  materialFilled
}: {
  active: boolean
  className?: string
  icon: IconAsset | undefined
  materialFilled?: boolean
}): ReactNode => {
  const source = resolveIconAssetSource(icon, active)
  if (source == null || typeof source === 'boolean') return null

  const classes = ['icon-asset', className].filter(Boolean).join(' ')

  if (typeof source === 'string') {
    return (
      <MaterialSymbol
        className={classes}
        name={source}
        filled={materialFilled ?? active}
      />
    )
  }

  if (!isPlainIconObject(source)) {
    return source
  }

  if (source.type === 'material') {
    return (
      <MaterialSymbol
        className={classes}
        name={source.name}
        filled={source.filled ?? materialFilled ?? active}
      />
    )
  }

  if (source.type === 'svg') {
    return (
      <span
        className={[classes, 'icon-asset--svg'].filter(Boolean).join(' ')}
        role={source.title == null ? undefined : 'img'}
        aria-label={source.title}
        aria-hidden={source.title == null ? true : undefined}
        dangerouslySetInnerHTML={{ __html: source.svg }}
      />
    )
  }

  if (source.type === 'image') {
    return (
      <img
        className={[classes, 'icon-asset--image'].filter(Boolean).join(' ')}
        src={source.src}
        alt={source.alt ?? ''}
        draggable={false}
      />
    )
  }

  return null
}
