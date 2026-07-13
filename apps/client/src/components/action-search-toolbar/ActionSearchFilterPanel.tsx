import './ActionSearchFilterPanel.scss'

import type { ReactNode } from 'react'

export function ActionSearchFilterPanel({ children, open }: { children: ReactNode; open: boolean }) {
  if (!open) return null

  return (
    <div className='action-search-filter-panel is-open'>
      <div className='action-search-filter-panel__inner'>{children}</div>
    </div>
  )
}
