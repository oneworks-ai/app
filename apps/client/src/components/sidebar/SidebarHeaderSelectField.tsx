import type { SelectProps } from 'antd'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

interface SidebarHeaderSelectFieldProps extends SelectProps {
  icon: string
}

export function SidebarHeaderSelectField({
  className,
  icon,
  ...selectProps
}: SidebarHeaderSelectFieldProps) {
  return (
    <div className='toolbar-filter-control'>
      <MaterialSymbol className='toolbar-filter-icon' name={icon} />
      <Select
        className={className == null || className === ''
          ? 'toolbar-filter-select'
          : `toolbar-filter-select ${className}`}
        {...selectProps}
      />
    </div>
  )
}
