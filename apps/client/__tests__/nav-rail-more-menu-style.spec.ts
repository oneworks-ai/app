import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  new URL('../src/components/NavRail.scss', import.meta.url),
  'utf8'
)

describe('nav rail more menu styles', () => {
  it('keeps the menu and submenu surfaces solid in dark mode', () => {
    expect(styles).toContain('--nav-rail-more-overlay-surface: color-mix(')
    expect(styles).toContain('var(--bg-color) 96%')

    const darkThemeOverride = styles.slice(
      styles.indexOf('html.dark {'),
      styles.indexOf('.nav-rail-more-dropdown.ant-dropdown {', styles.indexOf('html.dark {'))
    )

    expect(darkThemeOverride).toContain('.nav-rail-more-dropdown.ant-dropdown,')
    expect(darkThemeOverride).toContain(
      '.nav-rail-more-submenu-dropdown.ant-dropdown-menu-submenu-popup {'
    )
    expect(darkThemeOverride).toContain(
      '--oneworks-overlay-surface: var(--nav-rail-more-overlay-surface);'
    )
  })
})
