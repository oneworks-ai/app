import type { CSSProperties, ReactNode, Ref } from 'react'

export interface RouteWorkbenchSidebarItem {
  id: string
  label: ReactNode
  active?: boolean
  disabled?: boolean
  href?: string
  icon?: ReactNode
  onSelect?: () => void
}

export interface RouteWorkbenchShellProps {
  children: ReactNode
  className?: string
  contentAriaHidden?: boolean
  contentClassName?: string
  contentFirst?: boolean
  contentRegionClassName?: string
  contentRegionRef?: Ref<HTMLDivElement | null>
  desktopChrome?: ReactNode
  mobileSidebar?: ReactNode
  sidebar?: ReactNode
  sidebarClassName?: string
  sidebarEdgeSwipeZone?: ReactNode
  sidebarFooter?: ReactNode
  sidebarIcon?: ReactNode
  sidebarItems?: RouteWorkbenchSidebarItem[]
  sidebarPreviewDismissLayer?: ReactNode
  sidebarRegionClassName?: string
  sidebarTitle?: ReactNode
  style?: CSSProperties
}

const routeWorkbenchSidebarItemClassName = (item: RouteWorkbenchSidebarItem) =>
  [
    'route-workbench-shell__sidebar-item',
    item.active === true ? 'is-active' : ''
  ].filter(Boolean).join(' ')

export function RouteWorkbenchSidebarNav({
  sidebarClassName,
  sidebarFooter,
  sidebarIcon,
  sidebarItems = [],
  sidebarTitle
}: Pick<
  RouteWorkbenchShellProps,
  'sidebarClassName' | 'sidebarFooter' | 'sidebarIcon' | 'sidebarItems' | 'sidebarTitle'
>) {
  if (sidebarTitle == null && sidebarItems.length === 0 && sidebarFooter == null) {
    return null
  }

  return (
    <aside className={['route-workbench-shell__sidebar', sidebarClassName].filter(Boolean).join(' ')}>
      {sidebarTitle == null
        ? null
        : (
          <div className='route-workbench-shell__sidebar-brand'>
            {sidebarIcon == null ? null : (
              <span className='route-workbench-shell__sidebar-brand-icon'>
                {sidebarIcon}
              </span>
            )}
            <span className='route-workbench-shell__sidebar-brand-text'>{sidebarTitle}</span>
          </div>
        )}
      {sidebarItems.length === 0
        ? null
        : (
          <nav className='route-workbench-shell__sidebar-nav' aria-label='Section navigation'>
            {sidebarItems.map(item => {
              const itemContent = (
                <>
                  {item.icon == null ? null : (
                    <span className='route-workbench-shell__sidebar-item-icon' aria-hidden='true'>
                      {item.icon}
                    </span>
                  )}
                  <span className='route-workbench-shell__sidebar-item-label'>{item.label}</span>
                </>
              )

              return item.href == null
                ? (
                  <button
                    key={item.id}
                    type='button'
                    className={routeWorkbenchSidebarItemClassName(item)}
                    disabled={item.disabled}
                    aria-current={item.active === true ? 'page' : undefined}
                    onClick={item.onSelect}
                  >
                    {itemContent}
                  </button>
                )
                : (
                  <a
                    key={item.id}
                    className={routeWorkbenchSidebarItemClassName(item)}
                    href={item.href}
                    aria-current={item.active === true ? 'page' : undefined}
                    onClick={event => {
                      if (item.disabled === true) {
                        event.preventDefault()
                        return
                      }
                      item.onSelect?.()
                    }}
                  >
                    {itemContent}
                  </a>
                )
            })}
          </nav>
        )}
      {sidebarFooter == null ? null : (
        <div className='route-workbench-shell__sidebar-footer'>
          {sidebarFooter}
        </div>
      )}
    </aside>
  )
}

export function RouteWorkbenchShell({
  children,
  className,
  contentAriaHidden,
  contentClassName,
  contentFirst = false,
  contentRegionClassName,
  contentRegionRef,
  desktopChrome,
  mobileSidebar,
  sidebar,
  sidebarClassName,
  sidebarEdgeSwipeZone,
  sidebarFooter,
  sidebarIcon,
  sidebarItems = [],
  sidebarPreviewDismissLayer,
  sidebarRegionClassName,
  sidebarTitle,
  style
}: RouteWorkbenchShellProps) {
  const resolvedSidebar = sidebar ?? (
    <RouteWorkbenchSidebarNav
      sidebarClassName={sidebarClassName}
      sidebarFooter={sidebarFooter}
      sidebarIcon={sidebarIcon}
      sidebarItems={sidebarItems}
      sidebarTitle={sidebarTitle}
    />
  )

  const content = (
    <div
      ref={contentRegionRef as Ref<HTMLDivElement>}
      className={['route-workbench-shell__content-region', contentRegionClassName].filter(Boolean).join(' ')}
      aria-hidden={contentAriaHidden}
    >
      <div className={['route-workbench-shell__content', contentClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </div>
  )

  return (
    <div className={['route-workbench-shell', className].filter(Boolean).join(' ')} style={style}>
      {contentFirst ? content : null}
      {mobileSidebar}
      {contentFirst ? null : desktopChrome}
      {contentFirst ? null : sidebarEdgeSwipeZone}
      {contentFirst ? null : sidebarPreviewDismissLayer}
      {contentFirst || resolvedSidebar == null ? null : (
        <div className={['route-workbench-shell__sidebar-region', sidebarRegionClassName].filter(Boolean).join(' ')}>
          {resolvedSidebar}
        </div>
      )}
      {contentFirst ? null : content}
    </div>
  )
}
