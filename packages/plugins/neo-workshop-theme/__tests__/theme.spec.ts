import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { activatePlugin, neoWorkshopTheme, normalizeNeoWorkshopThemeSettings } from '../client/src/index'

describe('neo workshop theme plugin', () => {
  it('owns its theme recipe and defaults', () => {
    expect(neoWorkshopTheme).toMatchObject({ id: 'neo-workshop', primaryColor: '#fe7da8' })
    expect(neoWorkshopTheme.settingsTabs.map(tab => tab.id)).toEqual(['colors', 'geometry', 'components'])
    expect(normalizeNeoWorkshopThemeSettings(undefined)).toMatchObject({
      overrides: {
        colors: { borders: true, palette: true },
        geometry: { buttonPadding: { enabled: true, value: 5 }, corners: true, shadows: true }
      }
    })
  })

  it('clamps the read-only button padding and registers through the theme extension point', () => {
    expect(normalizeNeoWorkshopThemeSettings({ overrides: { geometry: { buttonPadding: { value: 99 } } } }))
      .toMatchObject({ overrides: { geometry: { buttonPadding: { enabled: true, value: 12 } } } })
    const dispose = vi.fn()
    const register = vi.fn(() => ({ dispose }))
    expect(activatePlugin({ themes: { register } })).toEqual({ dispose })
    expect(register).toHaveBeenCalledWith(neoWorkshopTheme)
  })

  it('styles sender surfaces through the shared theme contract', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')
    const senderButtonsRecipe = themeCss.match(
      /html\[data-oneworks-theme-pack='neo-workshop'\]\[data-oneworks-theme-pack-overrides~='buttons'\]\s+\.sender-container--chat-surface\s*\{([^}]*)\}/
    )?.[1]
    const senderBordersRecipe = themeCss.match(
      /html\[data-oneworks-theme-pack='neo-workshop'\]\[data-oneworks-theme-pack-overrides~='borders'\]\s+\.sender-container--chat-surface\s*\{([^}]*)\}/
    )?.[1]

    expect(themeCss).toContain('.sender-container--chat-surface')
    expect(themeCss).toContain('--chat-surface-frame-border-width')
    expect(themeCss).toContain('--chat-surface-composer-border-width')
    expect(themeCss).toContain('--chat-surface-status-divider-width')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-gap: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-left-gap: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-right-gap: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-bleed-inline: var(')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-bleed-bottom: var(')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-margin-top: 4px')
    expect(senderButtonsRecipe).toContain('--chat-surface-toolbar-action-padding-block: var(')
    expect(senderButtonsRecipe).toContain(
      '--chat-surface-toolbar-action-height: var(--oneworks-neo-control-size)'
    )
    expect(senderButtonsRecipe).toContain(
      '--chat-surface-status-control-height: var(--oneworks-neo-control-size)'
    )
    expect(senderButtonsRecipe).toMatch(
      /--chat-surface-toolbar-action-padding-block:\s*var\(\s*--oneworks-neo-button-padding,\s*5px\s*\)/
    )
    expect(senderButtonsRecipe).toMatch(
      /--chat-surface-toolbar-action-padding-inline:\s*var\(\s*--oneworks-neo-button-padding,\s*5px\s*\)/
    )
    expect(senderButtonsRecipe).toContain('--chat-surface-control-hover-bg: var(--tag-bg)')
    expect(senderButtonsRecipe).toContain('--chat-surface-control-hover-color: #141111')
    expect(senderButtonsRecipe).toContain('--chat-surface-control-hover-shadow: none')
    expect(senderButtonsRecipe).toContain('--chat-surface-status-padding-block: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-status-padding-inline: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-status-group-gap: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-status-actions-gap: 0px')
    expect(senderButtonsRecipe).toContain('--chat-surface-status-account-gap: 0px')
    expect(senderButtonsRecipe).toMatch(
      /--chat-surface-status-action-padding-inline:\s*var\(\s*--oneworks-neo-button-padding,\s*5px\s*\)/
    )
    expect(senderButtonsRecipe).toMatch(
      /--chat-surface-status-action-padding-block:\s*var\(\s*--oneworks-neo-button-padding,\s*5px\s*\)/
    )
    expect(senderButtonsRecipe).toMatch(
      /--chat-surface-status-icon-action-size:\s*var\(\s*--chat-surface-status-control-height\s*\)/
    )
    expect(senderButtonsRecipe).not.toMatch(
      /--chat-surface-status-icon-action-size:\s*var\(\s*--chat-surface-toolbar-action-height\s*\)/
    )
    expect(senderButtonsRecipe).not.toContain('--chat-surface-control-separator-height')
    expect(senderBordersRecipe).toContain('--chat-surface-toolbar-divider-width: var(')
    expect(senderBordersRecipe).toContain('--chat-surface-status-divider-layout-width: 0px')
    expect(senderBordersRecipe).toContain('--chat-surface-status-divider-overlay-width: var(')
    expect(senderBordersRecipe).toContain('--chat-surface-toolbar-right-divider-width: var(')
    expect(senderBordersRecipe).toContain('--chat-surface-control-separator-width: var(')
    expect(senderBordersRecipe).toContain('--chat-surface-control-separator-height: 100%')
    expect(senderBordersRecipe).toContain('--chat-surface-control-separator-offset: 0px')
    expect(senderBordersRecipe).toContain('--chat-surface-control-separator-radius: 0px')
    expect(senderBordersRecipe).toContain('--chat-surface-status-separator-width: var(')
    expect(senderBordersRecipe).toContain('--chat-surface-status-separator-height: 100%')
    expect(senderBordersRecipe).toContain('--chat-surface-status-account-separator-width: var(')
    expect(themeCss).not.toMatch(/\.automation-/)
    expect(themeCss).not.toMatch(/\.plugin-create-/)
  })

  it('removes the shared overlay selection rail without menu item exceptions', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toContain('--oneworks-overlay-line-width: 0px')
    expect(themeCss).not.toContain('.ant-dropdown-menu-item-selected::before')
  })

  it('maps the shared launcher contract without launcher page selectors', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')
    const rootRecipe = themeCss.match(
      /html\[data-oneworks-theme-pack='neo-workshop'\]\s*\{([^}]*)\}/
    )?.[1]
    const paletteRecipe = themeCss.match(
      /html\[data-oneworks-theme-pack='neo-workshop'\]\[data-oneworks-theme-pack-overrides~='palette'\]\s*\{([^}]*)\}/
    )?.[1]

    expect(themeCss).toContain('--oneworks-launcher-shell-radius: 0px')
    expect(themeCss).toContain('--oneworks-launcher-shell-shadow: 4px 4px 0')
    expect(themeCss).toContain('--oneworks-launcher-item-active-bg: var(--tag-bg)')
    expect(rootRecipe).not.toContain('--oneworks-launcher-item-active-color')
    expect(rootRecipe).not.toContain('--oneworks-launcher-item-active-muted-color')
    expect(paletteRecipe).toContain('--oneworks-launcher-item-active-color: #141111')
    expect(paletteRecipe).toContain('--oneworks-launcher-item-active-muted-color: color-mix(')
    expect(themeCss).not.toContain('.launcher-route')
  })

  it('maps compact action geometry without page-specific selectors', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toContain('--oneworks-compact-action-size: var(--oneworks-neo-control-size)')
    expect(themeCss).toContain('--oneworks-compact-action-gap: 0px')
    expect(themeCss).toContain('--oneworks-compact-action-divider-width')
    expect(themeCss).toContain('--route-container-header-action-divider-width: 0px')
    expect(themeCss).toContain('--route-container-header-action-group-divider-width: var(')
    expect(themeCss).toContain('--route-container-header-joined-action-divider-width: 0px')
    expect(themeCss).toMatch(
      /\.ant-btn:not\(\.route-container-header__action-button\)/
    )
    expect(themeCss).not.toContain('.action-search-toolbar')
  })

  it('maps general Select content padding to the theme button rhythm', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toMatch(
      /\[data-oneworks-theme-pack-overrides~='button-padding'\][\s\S]*:is\(\.oneworks-select,\s*\.mobile-aware-select-trigger-shell--content\)\s*\{[\s\S]*--oneworks-select-padding-inline:\s*var\(\s*--oneworks-neo-button-padding,\s*5px\s*\)/
    )
    expect(themeCss).toMatch(
      /\[data-oneworks-theme-pack-overrides~='inputs'\]\s*:where\(\s*\.ant-select:not\(\.ant-select-status-error\):not\(\.ant-select-status-warning\):not\(\.ant-select-disabled\)\s*\.ant-select-selector\s*\)/
    )
  })
})
