import './NativeTabs.scss'

import type { CSSProperties, ReactNode } from 'react'

import type { IconAsset } from '#~/components/icons/IconAsset'
import { renderIconAsset } from '#~/components/icons/IconAsset'

export interface NativeTabItem<TabKey extends string = string> {
  disabled?: boolean
  icon?: IconAsset
  key: TabKey
  label: ReactNode
}

export interface NativeTabsProps<TabKey extends string = string> {
  activeKey?: TabKey
  actions?: ReactNode
  ariaLabel?: string
  className?: string
  iconSize?: number | string
  items: Array<NativeTabItem<TabKey>>
  onChange?: (key: TabKey, item: NativeTabItem<TabKey>) => void
}

const toCssSize = (value: number | string | undefined) => {
  if (typeof value === 'number') return `${value}px`
  return value
}

export function NativeTabs<TabKey extends string = string>({
  activeKey,
  actions,
  ariaLabel,
  className,
  iconSize,
  items,
  onChange
}: NativeTabsProps<TabKey>) {
  const style: CSSProperties | undefined = iconSize == null
    ? undefined
    : { '--native-tabs-icon-size': toCssSize(iconSize) } as CSSProperties

  return (
    <div
      aria-label={ariaLabel}
      className={['native-tabs', className].filter(Boolean).join(' ')}
      role='tablist'
      style={style}
    >
      <div className='native-tabs__items'>
        {items.map(item => {
          const active = activeKey === item.key
          const icon = renderIconAsset({
            active,
            className: 'native-tabs__icon',
            icon: item.icon
          })

          return (
            <button
              aria-selected={active ? 'true' : 'false'}
              className='native-tabs__tab'
              disabled={item.disabled}
              key={item.key}
              onClick={() => {
                if (!item.disabled) onChange?.(item.key, item)
              }}
              role='tab'
              type='button'
            >
              <span className='native-tabs__label'>
                {icon}
                <span className='native-tabs__text'>{item.label}</span>
              </span>
            </button>
          )
        })}
      </div>
      {actions == null ? null : <div className='native-tabs__actions'>{actions}</div>}
    </div>
  )
}
