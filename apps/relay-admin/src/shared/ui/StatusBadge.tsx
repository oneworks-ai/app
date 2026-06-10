import './StatusBadge.css'

export interface StatusBadgeProps {
  tone: 'danger' | 'muted' | 'success' | 'warning'
  children: string
}

export const StatusBadge = ({ children, tone }: StatusBadgeProps) => (
  <span className={`relay-status-badge relay-status-badge--${tone}`}>
    {children}
  </span>
)
