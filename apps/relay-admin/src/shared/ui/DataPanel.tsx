import './DataPanel.css'

import { Card } from 'antd'
import type { ReactNode } from 'react'

export interface DataPanelProps {
  actions?: ReactNode
  children: ReactNode
  count?: number
  id?: string
  title?: string
}

export const DataPanel = ({ actions, children, count, id, title }: DataPanelProps) => {
  const hasHeader = title != null || count != null || actions != null

  return (
    <Card
      className='relay-data-panel'
      extra={actions == null ? null : <div className='relay-data-panel__actions'>{actions}</div>}
      id={id}
      title={hasHeader
        ? (
          <div className='relay-data-panel__title-row'>
            {title == null ? null : <h2>{title}</h2>}
            {count == null ? null : <span className='relay-data-panel__count'>{count}</span>}
          </div>
        )
        : undefined}
      variant='borderless'
    >
      {children}
    </Card>
  )
}
