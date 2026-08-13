import '../ConfigView.scss'

import type { ReactNode } from 'react'
import { forwardRef, useState } from 'react'

export interface ConfigSectionFrameProps {
  bodyClassName?: string
  children: ReactNode
  className?: string
  collapsed?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  headerContent?: ReactNode
  headerExtra?: ReactNode
  headerLeading?: ReactNode
  icon?: ReactNode
  onCollapsedChange?: (collapsed: boolean) => void
  title?: ReactNode
}

export const ConfigSectionFrame = forwardRef<HTMLDivElement, ConfigSectionFrameProps>(({
  bodyClassName,
  children,
  className,
  collapsed,
  collapsible = false,
  defaultCollapsed = false,
  headerContent,
  headerExtra,
  headerLeading,
  icon,
  onCollapsedChange,
  title
}, ref) => {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isCollapsed = collapsible && (collapsed ?? internalCollapsed)
  const wrapClassName = [
    'config-view__editor-wrap',
    collapsible ? 'config-view__editor-wrap--collapsible' : '',
    isCollapsed ? 'is-collapsed' : '',
    className
  ].filter(Boolean).join(' ')
  const hasHeading = headerContent != null || title != null || icon != null
  const hasHeader = hasHeading || headerLeading != null || headerExtra != null
  const headerClassName = [
    'config-view__section-header',
    !hasHeading ? 'config-view__section-header--actions-only' : ''
  ].filter(Boolean).join(' ')
  const sectionBodyClassName = ['config-view__section-body', bodyClassName]
    .filter(Boolean)
    .join(' ')
  const heading = headerContent ?? (
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
  )
  const toggleCollapsed = () => {
    const nextCollapsed = !isCollapsed
    if (collapsed == null) setInternalCollapsed(nextCollapsed)
    onCollapsedChange?.(nextCollapsed)
  }

  return (
    <div className={wrapClassName}>
      {hasHeader && (
        <div className={headerClassName}>
          {collapsible
            ? (
              <button
                aria-expanded={!isCollapsed}
                className='config-view__section-toggle'
                type='button'
                onClick={toggleCollapsed}
              >
                {heading}
                <span className='material-symbols-rounded config-view__section-toggle-icon'>
                  expand_more
                </span>
              </button>
            )
            : heading}
          {headerExtra != null && (
            <div className='config-view__section-header-extra'>
              {headerExtra}
            </div>
          )}
        </div>
      )}
      {!isCollapsed && (
        <div ref={ref} className={sectionBodyClassName}>
          {children}
        </div>
      )}
    </div>
  )
})

ConfigSectionFrame.displayName = 'ConfigSectionFrame'
