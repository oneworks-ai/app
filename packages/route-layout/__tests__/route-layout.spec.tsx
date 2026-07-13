import { readFileSync } from 'node:fs'

import type { CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  AppShellFrame,
  HostAppShell,
  HostNavRail,
  HostNavRailFooterButton,
  HostSidebarListHeader,
  HostSidebarQuickLinks,
  RouteContainerHeader,
  RouteContainerLayout,
  RouteWorkbenchShell
} from '../src'

describe('route layout primitives', () => {
  it('passes location context to function slots', () => {
    const html = renderToStaticMarkup(
      <RouteContainerLayout
        location={{
          hash: '#details',
          pathname: '/admin',
          search: '?tab=users'
        }}
      >
        {({ hash, path, pathname, search }) => (
          <output
            data-hash={hash}
            data-path={path}
            data-pathname={pathname}
            data-search={search}
          />
        )}
      </RouteContainerLayout>
    )

    expect(html).toContain('data-hash="#details"')
    expect(html).toContain('data-path="/admin?tab=users#details"')
    expect(html).toContain('data-pathname="/admin"')
    expect(html).toContain('data-search="?tab=users"')
  })

  it('renders route layout root styles and main overlays', () => {
    const html = renderToStaticMarkup(
      <RouteContainerLayout
        mainOverlay={<div data-testid='main-overlay' />}
        style={{ '--route-container-side-panel-width': '360px' } as CSSProperties}
      >
        <main>Content</main>
      </RouteContainerLayout>
    )

    expect(html).toContain('--route-container-side-panel-width:360px')
    expect(html).toContain('data-testid="main-overlay"')
  })

  it('renders compact route header title and actions', () => {
    const html = renderToStaticMarkup(
      <RouteContainerHeader
        icon={
          <svg viewBox='0 0 1 1'>
            <path d='M0 0h1v1H0z' />
          </svg>
        }
        title='认证管理'
        actionItems={[
          {
            icon: <span aria-hidden='true'>R</span>,
            key: 'refresh',
            label: 'Refresh'
          }
        ]}
      />
    )

    expect(html).toContain('route-container-header')
    expect(html).toContain('认证管理')
    expect(html).toContain('aria-label="Refresh"')
    expect(html).not.toContain('data-tooltip=')
    expect(html).toContain('title="Refresh"')
    expect(html).toContain('route-container-header__title-icon')
  })

  it('renders route header breadcrumbs with supplied icon slots', () => {
    const html = renderToStaticMarkup(
      <RouteContainerHeader
        title='Jie Yi'
        breadcrumb={{
          backIcon: <span data-icon='back'>back</span>,
          currentTitle: 'Jie Yi',
          separatorIcon: <span data-icon='separator'>separator</span>,
          parentTitle: '用户',
          onBack: () => {}
        }}
      />
    )

    expect(html).toContain('route-container-header__breadcrumb')
    expect(html).toContain('route-container-header__breadcrumb-back')
    expect(html).toContain('data-icon="back"')
    expect(html).toContain('data-icon="separator"')
    expect(html).toContain('用户')
    expect(html).toContain('Jie Yi')
    expect(html).not.toContain('>/</span>')
  })

  it('renders shared workbench sidebar navigation', () => {
    const html = renderToStaticMarkup(
      <RouteWorkbenchShell
        sidebarTitle='认证管理'
        sidebarItems={[
          {
            active: true,
            href: '#overview',
            id: 'overview',
            label: '概览'
          },
          {
            href: '#users',
            id: 'users',
            label: '用户'
          }
        ]}
      >
        <main>Admin content</main>
      </RouteWorkbenchShell>
    )

    expect(html).toContain('route-workbench-shell__sidebar')
    expect(html).toContain('认证管理')
    expect(html).toContain('href="#overview"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Admin content')
  })

  it('renders app shell frame with shared sidebar and content regions', () => {
    const html = renderToStaticMarkup(
      <AppShellFrame
        closeLabel='Close'
        contentClassName='content-slot'
        contentRegionClassName='content-region'
        isCompactLayout={false}
        isMobileSidebarOpen={false}
        onMobileSidebarOpenChange={() => {}}
        routeSidebarAriaLabel='Navigation'
        sidebarCollapsed={false}
        sidebarItems={[{ active: true, id: 'account', label: '账号' }]}
        sidebarTitle='认证管理'
        showSidebar
      >
        <main>Shared app shell</main>
      </AppShellFrame>
    )

    expect(html).toContain('route-workbench-shell')
    expect(html).toContain('route-workbench-shell__sidebar-region')
    expect(html).toContain('content-region')
    expect(html).toContain('content-slot')
    expect(html).toContain('Shared app shell')
  })

  it('renders host app shell and nav rail slots', () => {
    const html = renderToStaticMarkup(
      <HostAppShell
        closeLabel='Close'
        desktopSidebar={() => (
          <HostNavRail
            footerMenu={<HostNavRailFooterButton label='菜单' />}
          >
            <div className='sidebar-container sidebar-container--nav-embedded'>
              <div className='sidebar-content'>
                <HostSidebarListHeader className='sidebar-header'>
                  <HostSidebarQuickLinks
                    ariaLabel='Admin navigation'
                    items={[
                      {
                        active: true,
                        key: 'users',
                        label: '用户',
                        onSelect: () => {}
                      }
                    ]}
                  />
                </HostSidebarListHeader>
              </div>
            </div>
          </HostNavRail>
        )}
        isCompactLayout={false}
        isMobileSidebarOpen={false}
        onMobileSidebarOpenChange={() => {}}
        routeSidebarAriaLabel='Admin navigation'
        sidebarCollapsed={false}
        showSidebar
      >
        <main>Admin users</main>
      </HostAppShell>
    )

    expect(html).toContain('host-app-shell')
    expect(html).toContain('host-app-shell__content')
    expect(html).toContain('host-nav-rail')
    expect(html).toContain('sidebar-container--nav-embedded')
    expect(html).toContain('sidebar-list-header')
    expect(html).toContain('sidebar-header__quick-links')
    expect(html).toContain('host-nav-rail__footer-button')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Admin users')
  })

  it('leaves HostAppShell responsive ownership to its compact state', () => {
    const styles = readFileSync(new URL('../src/RouteWorkbenchShell.css', import.meta.url), 'utf8')
    const responsiveStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'))

    expect(responsiveStyles).toContain('.route-workbench-shell:not(.host-app-shell)')
    expect(responsiveStyles).not.toContain('\n  .route-workbench-shell {\n    flex-direction: column;')
    expect(responsiveStyles).toContain('> .route-workbench-shell__sidebar-region')
  })
})
