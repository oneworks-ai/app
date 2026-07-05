import { adminListSurfaceClassNames } from '@oneworks/components/admin-list-surface'
import { Checkbox } from 'antd'

import type { AdminListColumnOption } from './AdminListTable'

export interface AdminListTableColumnPickerProps {
  columnOptions: AdminListColumnOption[]
  requiredColumnKeys: string[]
  resolvedVisibleColumnKeys: ReadonlySet<string>
  visibleColumnKeys: string[]
  onVisibleColumnKeysChange: (keys: string[]) => void
}

export const AdminListTableColumnPicker = ({
  columnOptions,
  requiredColumnKeys,
  resolvedVisibleColumnKeys,
  visibleColumnKeys,
  onVisibleColumnKeysChange
}: AdminListTableColumnPickerProps) => (
  <div className={adminListSurfaceClassNames.columnMenu} role='group' aria-label='展示列'>
    {columnOptions.map(option => (
      <Checkbox
        key={option.key}
        checked={resolvedVisibleColumnKeys.has(option.key)}
        disabled={option.required}
        onChange={event => {
          const nextKeys = event.target.checked
            ? [...visibleColumnKeys, option.key]
            : visibleColumnKeys.filter(key => key !== option.key)
          onVisibleColumnKeysChange(Array.from(new Set([...requiredColumnKeys, ...nextKeys])))
        }}
      >
        {option.label}
      </Checkbox>
    ))}
  </div>
)
