import './AdminColumnFilter.css'

import { Popover } from 'antd'
import { useState } from 'react'

import { AdminActionButton } from './AdminActionButton'

export interface AdminColumnFilterOption<T extends string> {
  label: string
  value: T
}

export interface AdminColumnFilterProps<T extends string> {
  allValue: T
  ariaLabel: string
  label: string
  options: AdminColumnFilterOption<T>[]
  value: T
  onChange: (value: T) => void
}

export const AdminColumnFilter = <T extends string>({
  allValue,
  ariaLabel,
  label,
  options,
  value,
  onChange
}: AdminColumnFilterProps<T>) => {
  const [isOpen, setIsOpen] = useState(false)
  const isFiltered = value !== allValue
  const menu = (
    <div className='relay-admin-column-filter__menu' role='listbox' aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          aria-selected={option.value === value}
          className={[
            'relay-admin-column-filter__option',
            option.value === value ? 'is-selected' : ''
          ].filter(Boolean).join(' ')}
          role='option'
          type='button'
          onClick={() => {
            onChange(option.value)
            setIsOpen(false)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  return (
    <span className='relay-admin-column-filter'>
      <span className='relay-admin-column-filter__label'>{label}</span>
      <Popover
        content={menu}
        open={isOpen}
        overlayClassName='relay-admin-column-filter__popover'
        placement='bottomLeft'
        trigger='click'
        onOpenChange={setIsOpen}
      >
        <AdminActionButton
          aria-label={ariaLabel}
          className={[
            'relay-admin-column-filter__trigger',
            isFiltered || isOpen ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          iconName='filter_list'
          title={ariaLabel}
          type='text'
        />
      </Popover>
    </span>
  )
}
