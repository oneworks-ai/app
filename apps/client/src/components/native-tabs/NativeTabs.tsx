import './NativeTabs.scss'

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

import type { IconAsset } from '#~/components/icons/IconAsset'
import { renderIconAsset } from '#~/components/icons/IconAsset'

export interface NativeTabItem<TabKey extends string = string> {
  ariaControls?: string
  disabled?: boolean
  icon?: IconAsset
  id?: string
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
  const activeIndex = items.findIndex(item => activeKey === item.key)
  const tabbableIndex = activeIndex >= 0 ? activeIndex : items.findIndex(item => !item.disabled)

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

    const enabledIndexes = items.flatMap((item, index) => item.disabled ? [] : [index])
    if (enabledIndexes.length === 0) return

    const enabledPosition = Math.max(0, enabledIndexes.indexOf(currentIndex))
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    let nextIndex: number | undefined

    if (event.key === 'Home') {
      nextIndex = enabledIndexes[0]
    } else if (event.key === 'End') {
      nextIndex = enabledIndexes.at(-1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const visualOffset = event.key === 'ArrowRight' ? 1 : -1
      const offset = isRtl ? -visualOffset : visualOffset
      nextIndex = enabledIndexes[
        (enabledPosition + offset + enabledIndexes.length) % enabledIndexes.length
      ]
    }

    if (nextIndex == null || nextIndex === currentIndex) return
    const nextItem = items[nextIndex]
    if (nextItem == null) return

    event.preventDefault()
    onChange?.(nextItem.key, nextItem)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > .native-tabs__tab')
    requestAnimationFrame(() => tabs?.[nextIndex]?.focus())
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation='horizontal'
      className={['native-tabs', className].filter(Boolean).join(' ')}
      role='tablist'
      style={style}
    >
      <div className='native-tabs__items'>
        {items.map((item, index) => {
          const active = activeKey === item.key
          const icon = renderIconAsset({
            active,
            className: 'native-tabs__icon',
            icon: item.icon
          })

          return (
            <button
              aria-selected={active ? 'true' : 'false'}
              aria-controls={item.ariaControls}
              className='native-tabs__tab'
              disabled={item.disabled}
              id={item.id}
              key={item.key}
              onClick={() => {
                if (!item.disabled) onChange?.(item.key, item)
              }}
              onKeyDown={event => handleTabKeyDown(event, index)}
              role='tab'
              tabIndex={index === tabbableIndex ? 0 : -1}
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
