import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { buildNavRailMoreMenuItems } from '#~/components/nav-rail-more-menu'

describe('nav rail more menu links', () => {
  it('renders native anchors for link menu items', () => {
    const items = buildNavRailMoreMenuItems({
      closeMenu: vi.fn(),
      isMac: false,
      sections: [{
        items: [{
          href: '/ui/launcher',
          key: 'open-other-projects',
          label: 'Open Another Project'
        }],
        key: 'app-pages'
      }]
    })
    const item = items?.[0] as { label?: ReactNode } | undefined

    expect(item).toBeDefined()
    expect(renderToStaticMarkup(item?.label ?? null)).toContain(
      '<a class="nav-menu-link" href="/ui/launcher">Open Another Project</a>'
    )
  })
})
