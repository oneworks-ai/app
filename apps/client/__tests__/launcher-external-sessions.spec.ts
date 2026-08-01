import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const readClientSource = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

describe('launcher external sessions', () => {
  it('provides a global import section in launcher settings', () => {
    const settingsSource = readClientSource('components/launcher/LauncherSettingsView.tsx')
    const externalSessionsSource = readClientSource(
      'components/launcher/LauncherExternalSessionsView.tsx'
    )

    expect(settingsSource).toContain("id: 'external-sessions'")
    expect(settingsSource).toContain("t('launcher.settings.sections.externalSessions')")
    expect(settingsSource).toContain('<LauncherExternalSessionsView')
    expect(settingsSource).toContain('onImportComplete={onExternalSessionsImportComplete}')
    expect(settingsSource).toContain('workspaceProjects={workspaceProjects}')
    expect(externalSessionsSource).toContain('workspaceProjects: LauncherWorkspaceSelectorProject[]')
    expect(externalSessionsSource).toContain('onImportComplete={onImportComplete}')
    expect(externalSessionsSource).toContain("fixedProjectScope='all-projects'")
    expect(externalSessionsSource).toContain('initialShowAllTime')
    expect(externalSessionsSource).toContain('onSearchChromeChange({')
    expect(externalSessionsSource).toContain('showConfiguration={false}')
    expect(externalSessionsSource).toContain("toolbarPlacement='external'")
  })

  it('restores route-layout spacing tokens and keeps search in launcher chrome', () => {
    const styles = readClientSource(
      'components/launcher/LauncherExternalSessionsView.scss'
    )
    const adapterSource = readClientSource(
      'components/config/ExternalSessionsAdapterTab.tsx'
    )
    const routeSource = readClientSource('routes/LauncherRoute.tsx')

    expect(styles).toMatch(
      /\.launcher-external-sessions\s*\{[^}]*--subpage-tertiary-padding:\s*10px;[^}]*--subpage-tertiary-gap:\s*var\(--subpage-tertiary-padding\);/
    )
    expect(styles).toMatch(
      /\.launcher-external-sessions\s+\.config-view__external-session-panel--filter\s*\{[^}]*padding-top:\s*0;/
    )
    expect(styles).toMatch(
      /\.launcher-external-sessions\s+\.config-view__external-session-candidate-group\s*>\s*\.config-view__field-row:first-child\s*\{[^}]*padding-top:\s*0;/
    )
    expect(adapterSource).toContain("toolbarPlacement === 'inline' && (")
    expect(routeSource).toContain('<ActionSearchToolbarActions actions={injectedSearchChrome?.actions ?? []} />')
    expect(routeSource).toContain(
      'const viewSearchPlaceholder = injectedSearchChrome?.placeholder ?? defaultViewSearchPlaceholder'
    )
    expect(routeSource).toContain('workspaceProjects={mergedProjects}')
    expect(routeSource).toContain(
      'onExternalSessionsImportComplete={refreshImportedWorkspaceProjects}'
    )
  })

  it('uses the shared multi-select to filter preview and import by project', () => {
    const adapterSource = readClientSource(
      'components/config/ExternalSessionsAdapterTab.tsx'
    )
    const configStyles = readClientSource('components/ConfigView.scss')
    const panelSource = readClientSource(
      'components/config/ExternalSessionsPanel.tsx'
    )

    expect(adapterSource).toContain('<MobileAwareSelect<string[], ProjectSelectOption>')
    expect(adapterSource).toContain("mode='multiple'")
    expect(adapterSource).toContain('ALL_PROJECTS_OPTION_VALUE')
    expect(adapterSource).toContain('for (const project of preview?.projects ?? [])')
    expect(adapterSource).toContain(
      'projectPaths: projectPaths.length === 0 ? undefined : projectPaths'
    )
    expect(panelSource).toContain('onProjectPathsChange={setProjectPaths}')
    expect(panelSource).toContain('projectOptions={projectOptions}')
    expect(configStyles).toMatch(
      /\.config-view__external-session-project-select\.oneworks-select\s*\{[^}]*height:\s*30px;/
    )
    expect(configStyles).toMatch(
      /\.config-view__external-session-date-range\.ant-picker\s*\{[^}]*height:\s*30px;/
    )
  })

  it('scopes row loading and confirms bulk imports', () => {
    const adapterSource = readClientSource(
      'components/config/ExternalSessionsAdapterTab.tsx'
    )

    expect(adapterSource).toContain(
      'loading: importingSourcePaths.has(candidate.sourcePath)'
    )
    expect(adapterSource).toContain('disabled: candidate.isImported || isImporting')
    expect(adapterSource).toContain(
      'const importedSourcePaths = new Set(result.sessions.map(session => session.sourcePath))'
    )
    expect(adapterSource).toContain('{ revalidate: false }')
    expect(adapterSource).toContain('modal.confirm({')
    expect(adapterSource).toContain(
      "t('nativeHistoryImport.manager.confirmImportAllTitle'"
    )
    expect(adapterSource).toContain('onOk: () => handleImportSourcePaths(sourcePaths)')
  })
})
