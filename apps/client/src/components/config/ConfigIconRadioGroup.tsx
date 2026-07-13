import type { KeyboardEvent } from 'react'

export interface ConfigIconRadioOption<Value extends string> {
  icon: string
  label: string
  value: Value
}

export function ConfigIconRadioGroup<Value extends string>({
  ariaLabel,
  onChange,
  options,
  value
}: {
  ariaLabel: string
  onChange: (value: Value) => void
  options: Array<ConfigIconRadioOption<Value>>
  value: Value
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + options.length) % options.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % options.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = options.length - 1
    }

    if (nextIndex == null) return

    event.preventDefault()
    const nextOption = options[nextIndex]
    if (nextOption == null) return

    onChange(nextOption.value)
    const radioButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radioButtons?.[nextIndex]?.focus()
  }

  return (
    <div
      className='config-view__icon-radio-group'
      role='radiogroup'
      aria-label={ariaLabel}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type='button'
            className={`config-view__icon-radio${active ? ' is-active' : ''}`}
            aria-label={option.label}
            role='radio'
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={option.label}
            onClick={() => onChange(option.value)}
            onKeyDown={event => handleKeyDown(event, index)}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>{option.icon}</span>
          </button>
        )
      })}
    </div>
  )
}
