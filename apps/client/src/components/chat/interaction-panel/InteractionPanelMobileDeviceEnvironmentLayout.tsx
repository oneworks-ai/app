import type { ReactNode } from 'react'

export const renderMobileEnvironmentTabLabel = (icon: string, label: ReactNode) => (
  <span className='chat-interaction-panel-mobile-debug__environment-tab-label'>
    <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
    <span>{label}</span>
  </span>
)

export function MobileEnvironmentActions({ children }: { children: ReactNode }) {
  return <div className='chat-interaction-panel-mobile-debug__environment-actions'>{children}</div>
}

export function MobileEnvironmentField({ children, label }: { children: ReactNode; label: ReactNode }) {
  return (
    <label className='chat-interaction-panel-mobile-debug__environment-field'>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function MobileEnvironmentFieldGrid({ children }: { children: ReactNode }) {
  return <div className='chat-interaction-panel-mobile-debug__environment-field-grid'>{children}</div>
}

export function MobileEnvironmentSection({ children }: { children: ReactNode }) {
  return <div className='chat-interaction-panel-mobile-debug__environment-section'>{children}</div>
}
