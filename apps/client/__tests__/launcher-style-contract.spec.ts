import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('launcher command item visual contract', () => {
  it('keeps usage search inside the usage page', () => {
    const routeSource = readFileSync(
      new URL('../src/routes/LauncherRoute.tsx', import.meta.url),
      'utf8'
    )
    const usageStyles = readFileSync(
      new URL('../src/components/usage/UsagePanel.scss', import.meta.url),
      'utf8'
    )
    const usageSource = readFileSync(
      new URL('../src/components/usage/UsagePanel.tsx', import.meta.url),
      'utf8'
    )
    const routeStyles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )

    expect(routeSource).not.toContain("launcherViewMode !== 'usage' && (")
    expect(routeSource).not.toMatch(
      /launcherViewMode === 'usage'[\s\S]{0,100}setLauncherViewModeWithUrl\('commands'/
    )
    expect(routeSource).toContain('usagePanelRef.current?.handleSearchKeyDown(event)')
    expect(routeSource).toContain('onSearchQueryChange={setLauncherQueryWithUrl}')
    expect(routeSource).toContain('searchQuery={query}')
    expect(routeSource).toContain("t('usage.searchPlaceholder')")
    expect(usageSource).toContain("className='usage-panel__search-results'")
    expect(usageSource).toContain("'launcher-command-item'")
    expect(usageStyles).toMatch(
      /\.usage-panel--launcher\s*\{[^}]*padding:\s*0 0 34px;/
    )
    expect(usageStyles).not.toMatch(
      /\.usage-panel__metrics\s*\{[^}]*linear-gradient/
    )
    expect(usageStyles).toMatch(
      /\.usage-panel\s*\{[^}]*gap:\s*var\(--subpage-tertiary-gap,\s*10px\);/
    )
    expect(usageStyles).toMatch(
      /\.usage-panel__heatmap-months,\s*\.usage-panel__heatmap-row\s*\{[^}]*justify-content:\s*space-between;/
    )
    expect(usageSource).not.toContain("t('usage.activity.description')")
    expect(usageSource).toMatch(
      /<div className='usage-panel__section-heading'>\s*<h3>[\s\S]*?<\/h3>\s*<div className='usage-panel__activity-meta'>/
    )
    expect(routeStyles).toMatch(
      /html\.oneworks-launcher-web \.launcher-route,\s*\.launcher-web-overlay \.launcher-route\s*\{[^}]*width:\s*720px;/u
    )
    expect(routeStyles).not.toMatch(
      /\.launcher-route\.is-usage-route\s*\{[^}]*width:/u
    )
  })

  it('keeps settings tabs content-sized with a full-bleed sticky surface', () => {
    const settingsStyles = readFileSync(
      new URL(
        '../src/components/launcher/LauncherSettingsView.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs-surface\s*\{[^}]*top:\s*-10px;/
    )
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs-surface\s*\{[^}]*margin:\s*-10px\s+calc\(var\(--launcher-command-list-padding-inline,\s*14px\)\s*\*\s*-1\)\s+0;/
    )
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs-surface\s*\{[^}]*padding:\s*10px\s+var\(--launcher-command-list-padding-inline,\s*14px\)\s+0;/
    )
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs-surface\s*\{[^}]*background:\s*var\(\s*--oneworks-launcher-tab-bar-background,\s*color-mix\(in srgb,\s*var\(--bg-color\)\s*92%,\s*var\(--sub-bg-color\)\)\s*\);/
    )
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs\s*\{[^}]*--native-tabs-gap:\s*var\(--launcher-tab-gap,\s*10px\);/
    )
    expect(settingsStyles).not.toContain('.launcher-settings__tab {')
    expect(settingsStyles).toMatch(
      /\.launcher-settings__items\s*\{[^}]*gap:\s*10px;/
    )
  })

  it('shares icon-label spacing between the search row and settings tabs', () => {
    const routeStyles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )
    const settingsStyles = readFileSync(
      new URL(
        '../src/components/launcher/LauncherSettingsView.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(routeStyles).toMatch(
      /--launcher-icon-label-gap:\s*var\(--oneworks-launcher-icon-label-gap,\s*6px\);/
    )
    expect(routeStyles).toMatch(
      /\.launcher-command-search__input-row\s*\{[^}]*gap:\s*var\(--launcher-icon-label-gap\);/
    )
    expect(settingsStyles).not.toContain('.launcher-settings__tab {')
  })

  it('keeps launcher menus opaque while preserving theme ownership', () => {
    const routeStyles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )

    expect(routeStyles).toMatch(
      /--launcher-menu-background:\s*var\(\s*--oneworks-launcher-menu-background,\s*var\(--bg-color\)\s*\);/
    )
    expect(routeStyles).toMatch(
      /\.launcher-command-dropdown\.ant-dropdown,[^{]*\{[\s\S]*?\.ant-dropdown-menu\s*\{[^}]*background:\s*var\(--launcher-menu-background\)\s*!important;/
    )
    expect(routeStyles).toMatch(
      /\.launcher-command-menu-submenu\.ant-dropdown-menu-submenu-popup\s*\{[^}]*--launcher-menu-background:\s*var\(\s*--oneworks-launcher-menu-background,\s*var\(--bg-color\)\s*\);[^}]*background:\s*var\(--launcher-menu-background\)\s*!important;/
    )
    expect(routeStyles).not.toMatch(
      /\.launcher-command-dropdown\.ant-dropdown,[^{]*\{[\s\S]*?\.ant-dropdown-menu\s*\{[^}]*background:\s*var\(--oneworks-overlay-surface/
    )
  })

  it('shows the platform settings shortcut in the launcher menu', () => {
    const routeSource = readFileSync(
      new URL('../src/routes/LauncherRoute.tsx', import.meta.url),
      'utf8'
    )
    const routeStyles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )

    expect(routeSource).toContain(
      "getShortcutDisplayTokens('mod+,', isMacShortcutLayout)"
    )
    expect(routeSource).toMatch(
      /key:\s*'settings',[\s\S]*?extra:\s*\([\s\S]*?className='launcher-command-menu__shortcut'/
    )
    expect(routeStyles).toMatch(
      /\.launcher-command-menu__shortcut\s*\{[^}]*color:\s*var\(--launcher-muted-color\);[^}]*font-size:\s*11px;/
    )
  })

  it('keeps default hover surfaces transparent while preserving theme overrides', () => {
    const routeStyles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )
    const settingsStyles = readFileSync(
      new URL(
        '../src/components/launcher/LauncherSettingsView.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(routeStyles).toMatch(
      /--launcher-item-hover-bg:\s*var\(\s*--oneworks-launcher-item-hover-bg,\s*transparent\s*\)/
    )
    expect(routeStyles).toMatch(
      /\.launcher-command-item:hover,[^{]*\{[^}]*background:\s*var\(--launcher-item-hover-bg\)/
    )
    expect(settingsStyles).not.toContain('.launcher-settings__tab:hover')
  })

  it('uses complete active foreground semantics for command content', () => {
    const styles = readFileSync(
      new URL('../src/routes/LauncherRoute.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toMatch(
      /--launcher-item-active-bg:\s*var\(\s*--oneworks-launcher-item-active-bg,\s*transparent\s*\)/
    )
    expect(styles).toContain('--launcher-item-active-color: var(')
    expect(styles).toContain('--launcher-item-active-muted-color: var(')
    expect(styles).toMatch(
      /\.launcher-command-item\.is-active\s*\{[^}]*color:\s*var\(--launcher-item-active-color\)/
    )
    expect(styles).toMatch(
      /\.launcher-command-item\.is-active\s+\.launcher-command-item__subtitle\s*\{[^}]*color:\s*var\(--launcher-item-active-muted-color\)/
    )
    expect(styles).toMatch(
      /\.launcher-command-item\.is-active\s+\.launcher-command-item__badge\s*\{[^}]*color:\s*var\(--launcher-item-active-color\)/
    )
    expect(styles).toMatch(
      /\.launcher-command-item\.is-active\s+:where\([^)]*\.launcher-command-item__action[^)]*\)\s*\{[^}]*color:\s*var\(--launcher-item-active-muted-color\)/
    )
    expect(styles).not.toMatch(
      /\.launcher-command-item\.is-active\s+\.launcher-command-item__icon\s*\{/
    )
    expect(styles).not.toMatch(
      /\.launcher-command-item\.is-active\s+:is\([^)]*\.launcher-command-item__action/
    )
  })

  it('hides the native shortcut placeholder behind the styled display', () => {
    const styles = readFileSync(
      new URL(
        '../src/components/config/ConfigShortcutInput.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(styles).toMatch(
      /\.config-shortcut-input__native::placeholder\s*\{[^}]*color:\s*transparent;[^}]*opacity:\s*0;/
    )
  })
})
