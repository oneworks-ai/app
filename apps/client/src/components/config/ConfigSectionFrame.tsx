import '../ConfigView.scss'

import type { ReactNode } from 'react'
import { forwardRef } from 'react'

export interface ConfigSectionFrameProps {
  bodyClassName?: string
  children: ReactNode
  className?: string
  headerContent?: ReactNode
  headerExtra?: ReactNode
  headerLeading?: ReactNode
  icon?: ReactNode
  title?: ReactNode
}

export const ConfigSectionFrame = forwardRef<HTMLDivElement, ConfigSectionFrameProps>(({
  bodyClassName,
  children,
  className,
  headerContent,
  headerExtra,
  headerLeading,
  icon,
  title
}, ref) => {
  const wrapClassName = ['config-view__editor-wrap', className].filter(Boolean).join(' ')
  const hasHeading = headerContent != null || title != null || icon != null
  const hasHeader = hasHeading || headerLeading != null || headerExtra != null
  const headerClassName = [
    'config-view__section-header',
    !hasHeading ? 'config-view__section-header--actions-only' : ''
  ].filter(Boolean).join(' ')
  const sectionBodyClassName = ['config-view__section-body', bodyClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapClassName}>
      {hasHeader && (
        <div className={headerClassName}>
          {headerContent ?? (
            hasHeading
              ? (
                <div className='config-view__section-title'>
                  {headerLeading}
                  {icon != null && (
                    <span className='material-symbols-rounded config-view__section-icon'>
                      {icon}
                    </span>
                  )}
                  {title != null && <span>{title}</span>}
                </div>
              )
              : null
          )}
          {headerExtra != null && (
            <div className='config-view__section-header-extra'>
              {headerExtra}
            </div>
          )}
        </div>
      )}
      <div ref={ref} className={sectionBodyClassName}>
        {children}
      </div>
    </div>
  )
})

ConfigSectionFrame.displayName = 'ConfigSectionFrame'
