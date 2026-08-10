import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ONEWORKS_THEME_COLOR_PRESETS } from '@oneworks/icon/presets'

import { iconThemes, normalizeDesktopIconSettings } from '#~/components/config/app-icon-settings-model'
import { getProjectThemePreviewSources } from '#~/components/config/project-theme-color-settings-model'

describe('launcher app icon themes', () => {
  it('offers and normalizes the linear theme', () => {
    expect(iconThemes).toContain('linear')
    expect(ONEWORKS_THEME_COLOR_PRESETS).toContainEqual({
      primaryColor: '#7C8A96',
      theme: 'linear'
    })
    expect(normalizeDesktopIconSettings({ iconTheme: 'linear' }).iconTheme).toBe('linear')
    expect(normalizeDesktopIconSettings({ iconTheme: 'unknown' }).iconTheme).toBe('linear')
    expect(normalizeDesktopIconSettings(undefined).iconTheme).toBe('linear')
  })

  it('generates a linear preview through the shared icon renderer', () => {
    const previews = getProjectThemePreviewSources({
      iconBackground: 'solid',
      iconMode: 'dark',
      t: key => key
    })

    expect(previews.linear).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(decodeURIComponent(previews.linear?.split(',')[1] ?? '')).toContain(
      'data-oneworks-surface="linear"'
    )
  })

  it('sizes the shared theme selector from the preset count', () => {
    const styles = readFileSync(
      new URL('../src/components/ConfigView.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toContain(
      'repeat(var(--config-project-theme-option-count), minmax(0, 1fr))'
    )
    expect(styles).not.toMatch(
      /\.config-view__project-theme-radio-group\s*\{[^}]*grid-template-columns:\s*repeat\(3,/
    )
  })

  it('keeps Web icon preferences writable and preserves the rest of global desktop config', () => {
    const source = readFileSync(
      new URL('../src/components/launcher/LauncherSettingsView.tsx', import.meta.url),
      'utf8'
    )

    expect(source).toContain("updateConfig('global', 'desktop', {")
    expect(source).toContain('...cloneGlobalDesktopConfig(rawGlobalDesktop)')
    expect(source).toContain('disabled={!canUpdateAppIconPreferences}')
    expect(source).toContain('saving={savingDesktopIconSettings}')
    expect(source).not.toContain('saving={savingDesktopIconSettings || !canUpdateDesktopIcon}')
  })

  it('drives the launcher and navigation menu icons from the merged desktop preference', () => {
    const launcherSource = readFileSync(
      new URL('../src/routes/LauncherRoute.tsx', import.meta.url),
      'utf8'
    )
    const navRailSource = readFileSync(
      new URL('../src/components/NavRail.tsx', import.meta.url),
      'utf8'
    )

    expect(launcherSource).toContain('normalizeLauncherIconSettings(configRes?.sources?.merged?.desktop)')
    expect(launcherSource).toContain('theme: canUseApiConfig ? webIconSettings.iconTheme')
    expect(navRailSource).toContain('configRes?.sources?.merged?.desktop?.iconTheme')
    expect(navRailSource).toContain('iconThemes.includes(configuredIconTheme)')
  })

  it('carries the homepage preview icon theme into the merged desktop config', () => {
    const previewRuntimeSource = readFileSync(
      new URL('../src/homepage-preview/mock-runtime.ts', import.meta.url),
      'utf8'
    )

    expect(previewRuntimeSource).toContain('iconTheme: normalizeIconTheme(data.payload.iconTheme)')
    expect(previewRuntimeSource).toContain('iconTheme: config.iconTheme')
  })
})
