import './StatusBadge.css'

export type StatusBadgeTone = 'danger' | 'muted' | 'success' | 'warning'

export interface StatusBadgeProps {
  tone: StatusBadgeTone
  children: string
}

export const StatusBadge = ({ children, tone }: StatusBadgeProps) => (
  <span className={`relay-status-badge relay-status-badge--${tone}`}>
    {children}
  </span>
)
