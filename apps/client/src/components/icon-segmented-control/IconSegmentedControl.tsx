import './IconSegmentedControl.scss'

import { Tooltip } from 'antd'
import type { KeyboardEvent, ReactNode } from 'react'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

export interface IconSegmentedControlOption<TValue extends string> {
  icon: ReactNode
  label: string
  value: TValue
  disabled?: boolean
}

export interface IconSegmentedControlProps<TValue extends string> {
  ariaLabel: string
  onChange: (value: TValue) => void
  options: Array<IconSegmentedControlOption<TValue>>
  value: TValue
  className?: string
  itemClassName?: string
  preservePointerFocus?: boolean
}

export const getRelativeIconSegmentedValue = <TValue extends string>(
  options: Array<IconSegmentedControlOption<TValue>>,
  currentValue: TValue,
  offset: number
) => {
  const enabledOptions = options.filter(option => option.disabled !== true)
  const currentIndex = enabledOptions.findIndex(option => option.value === currentValue)
  if (currentIndex < 0 || enabledOptions.length === 0) return undefined
  return enabledOptions[(currentIndex + offset + enabledOptions.length) % enabledOptions.length]?.value
}

const selectItem = <TValue extends string>(
  current: HTMLButtonElement,
  nextValue: TValue | undefined,
  onChange: (value: TValue) => void
) => {
  if (nextValue == null) return
  const nextItem = Array.from(
    current.parentElement?.querySelectorAll<HTMLButtonElement>(
      '.oneworks-icon-segmented__item:not(:disabled)'
    ) ?? []
  ).find(item => item.dataset.value === nextValue)
  if (nextItem == null) return
  nextItem.focus()
  onChange(nextValue)
}

const selectRelativeItem = <TValue extends string>(
  current: HTMLButtonElement,
  currentValue: TValue,
  offset: number,
  options: Array<IconSegmentedControlOption<TValue>>,
  onChange: (value: TValue) => void
) => {
  selectItem(current, getRelativeIconSegmentedValue(options, currentValue, offset), onChange)
}

export function IconSegmentedControl<TValue extends string>({
  ariaLabel,
  className,
  itemClassName,
  onChange,
  options,
  preservePointerFocus = false,
  value
}: IconSegmentedControlProps<TValue>) {
  const { isTouchInteraction } = useResponsiveLayout()
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, optionValue: TValue) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectRelativeItem(event.currentTarget, optionValue, -1, options, onChange)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectRelativeItem(event.currentTarget, optionValue, 1, options, onChange)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabledOptions = options.filter(option => option.disabled !== true)
      selectItem(
        event.currentTarget,
        enabledOptions[event.key === 'Home' ? 0 : enabledOptions.length - 1]?.value,
        onChange
      )
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(optionValue)
    }
  }

  return (
    <span
      aria-label={ariaLabel}
      className={['oneworks-icon-segmented', className].filter(Boolean).join(' ')}
      role='radiogroup'
    >
      {options.map(option => {
        const active = value === option.value
        return (
          <Tooltip
            key={option.value}
            placement='top'
            title={isTouchInteraction ? undefined : option.label}
          >
            <button
              aria-checked={active}
              aria-label={option.label}
              className={[
                'oneworks-icon-segmented__item',
                itemClassName,
                active ? 'is-active' : ''
              ].filter(Boolean).join(' ')}
              data-value={option.value}
              disabled={option.disabled}
              role='radio'
              tabIndex={active ? 0 : -1}
              type='button'
              onClick={() => onChange(option.value)}
              onKeyDown={event => handleKeyDown(event, option.value)}
              onMouseDown={preservePointerFocus ? event => event.preventDefault() : undefined}
            >
              <span className='oneworks-icon-segmented__icon' aria-hidden='true'>
                {option.icon}
              </span>
            </button>
          </Tooltip>
        )
      })}
    </span>
  )
}
