import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../client/src/index.tsx', import.meta.url), 'utf8')

describe('demo plugin client entry HMR', () => {
  it('uses analyzable source imports and versioned production peers', () => {
    expect(source).toContain("import('./styles')")
    expect(source).toContain("import('./i18n')")
    expect(source).toContain("import('./demo-model')")
    expect(source).toContain("import('./view')")
    expect(source).toContain("importWithPluginVersion('./styles.js', pluginVersion)")
    expect(source).toContain("importWithPluginVersion('./view.js', pluginVersion)")
    expect(source).not.toContain('resolvePeerModule')
  })

  it('accepts source updates without escalating to a page reload', () => {
    expect(source).toContain("import.meta.hot.accept('./styles.ts'")
    expect(source).toContain("import.meta.hot.accept(['./i18n.ts', './demo-model.ts']")
    expect(source).not.toContain("'./view.tsx'], reloadActivePlugins")
    expect(source).toContain('import.meta.hot.accept(reloadActivePlugins)')
    expect(source).toContain('activeReloads.delete(reload)')
    expect(source).toContain('activeStyles.delete(style)')
  })
})
