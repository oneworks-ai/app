import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { NavRailWindowBar } from '#~/components/NavRail'

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => undefined,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined
    }
  })
})

const shortcutCaptures = vi.hoisted(() =>
  [] as Array<{
    actionKey?: string
    onPointerEnter?: () => void
  }>
)

vi.mock('antd', () => ({
  Button: (
    {
      children,
      icon,
      ...props
    }: React.PropsWithChildren<{ icon?: React.ReactNode } & Record<string, unknown>>
  ) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/session/test'
  }),
  useNavigate: () => vi.fn()
}))

vi.mock('swr', () => ({
  default: () => ({
    data: undefined
  })
}))

vi.mock('@oneworks/components/route-layout', () => ({
  ShortcutTooltip: (
    {
      children,
      onPointerEnter,
      ...props
    }: React.PropsWithChildren<{ onPointerEnter?: () => void } & Record<string, unknown>>
  ) => {
    shortcutCaptures.push({
      actionKey: props['data-nav-rail-window-action-key'] as string | undefined,
      onPointerEnter
    })

    return <>{children}</>
  }
}))

vi.mock('#~/components/icons/IconAsset', () => ({
  renderIconAsset: ({ icon }: { icon: string }) => <span>{icon}</span>
}))

vi.mock('#~/components/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ name }: { name: string }) => <span>{name}</span>
}))

vi.mock('#~/desktop/view-shortcuts', () => ({
  getDesktopViewShortcut: (key: string) => key
}))

const renderWindowBar = (
  props: Partial<React.ComponentProps<typeof NavRailWindowBar>> = {}
) => {
  shortcutCaptures.length = 0

  return renderToStaticMarkup(
    <NavRailWindowBar
      isMacShortcutLayout={false}
      sidebarCollapsed
      sidebarPreviewOpen
      collapsedActions={[]}
      onToggleSidebarCollapsed={vi.fn()}
      {...props}
    />
  )
}

describe('nav rail window bar', () => {
  it('closes the sidebar preview before opening another hover preview', () => {
    const calls: string[] = []

    renderWindowBar({
      collapsedActions: [{
        icon: 'chat',
        key: 'session-preview',
        label: 'Session preview',
        onPreviewOpen: () => calls.push('open-session')
      }],
      onSidebarPreviewClose: () => calls.push('close-sidebar')
    })

    shortcutCaptures.find(capture => capture.actionKey === 'session-preview')?.onPointerEnter?.()

    expect(calls).toEqual(['close-sidebar', 'open-session'])
  })

  it('keeps sidebar hover actions wired to the sidebar preview opener', () => {
    const calls: string[] = []

    renderWindowBar({
      collapsedActions: [{
        icon: 'left_panel_open',
        key: 'sidebar-preview',
        label: 'Sidebar preview',
        previewOnHover: 'sidebar'
      }],
      onSidebarPreviewClose: () => calls.push('close-sidebar'),
      onSidebarPreviewPointerEnter: () => calls.push('open-sidebar')
    })

    shortcutCaptures.find(capture => capture.actionKey === 'sidebar-preview')?.onPointerEnter?.()

    expect(calls).toEqual(['open-sidebar'])
  })

  it('renders notification badges on collapsed window actions', () => {
    const html = renderWindowBar({
      collapsedActions: [{
        badge: {
          animated: true,
          label: 'Waiting',
          tone: 'warning'
        },
        icon: 'chat',
        key: 'session-preview',
        label: 'Session preview'
      }]
    })

    expect(html).toContain('aria-label="Session preview · Waiting"')
    expect(html).toContain('nav-rail-window-action-badge is-warning is-animated')
  })
})
