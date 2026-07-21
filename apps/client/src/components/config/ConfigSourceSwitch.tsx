import type { ReactNode } from 'react'

import type { ConfigSource } from '@oneworks/core'

import { IconSegmentedControl } from '#~/components/icon-segmented-control'

export function ConfigSourceSwitch<TSource extends ConfigSource>({
  value,
  onChange,
  options,
  disabled = false
}: {
  value: TSource
  onChange: (value: TSource) => void
  options: Array<{ value: TSource; icon: string; label: ReactNode }>
  disabled?: boolean
}) {
  return (
    <IconSegmentedControl
      ariaLabel={options.map(option => String(option.label)).join(' / ')}
      className='config-view__source-switch'
      itemClassName='config-view__source-switch-button'
      value={value}
      options={options.map(option => ({
        disabled,
        icon: <span className='material-symbols-rounded'>{option.icon}</span>,
        label: String(option.label),
        value: option.value
      }))}
      onChange={onChange}
    />
  )
}
