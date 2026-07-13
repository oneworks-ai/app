import './FilterBar.scss'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

interface FilterOption {
  label: string
  value: string
}

interface FilterBarProps {
  className?: string
  tagOptions: FilterOption[]
  tagFilter: string[]
  tagsPlaceholder: string
  onTagFilterChange: (value: string[]) => void
}

export function FilterBar({
  className,
  tagOptions,
  tagFilter,
  tagsPlaceholder,
  onTagFilterChange
}: FilterBarProps) {
  return (
    <div className={['knowledge-base-view__filters', className].filter(Boolean).join(' ')}>
      <Select
        className='knowledge-base-view__filter-select'
        mode='multiple'
        placeholder={tagsPlaceholder}
        options={tagOptions}
        value={tagFilter}
        onChange={onTagFilterChange}
        maxTagCount='responsive'
        disabled={tagOptions.length === 0}
      />
    </div>
  )
}
