import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('launcher command item visual contract', () => {
  it('keeps settings tabs unpadded and transparent by default', () => {
    const settingsStyles = readFileSync(
      new URL(
        '../src/components/launcher/LauncherSettingsView.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(settingsStyles).toMatch(
      /\.launcher-settings__tabs\s*\{[^}]*background:\s*var\(--oneworks-launcher-tab-bar-background,\s*transparent\)/
    )
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tab\s*\{[^}]*padding:\s*0;/
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
    expect(settingsStyles).toMatch(
      /\.launcher-settings__tab:hover,[^{]*\{[^}]*background:\s*var\(--launcher-item-hover-bg,\s*transparent\)/
    )
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
