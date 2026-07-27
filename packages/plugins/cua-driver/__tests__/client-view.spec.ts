import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { normalizeApplicationRulesForView } from '../client/src/application-permissions'

const source = readFileSync(new URL('../client/src/view.tsx', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../client/src/styles.ts', import.meta.url), 'utf8')

describe('cua-driver application permission settings view', () => {
  it('normalizes exact bundle-id rules and merges duplicates to the strictest policy', () => {
    expect(normalizeApplicationRulesForView([
      { bundleId: 'com.apple.TextEdit', mode: 'always_allow' },
      { bundleId: 'COM.APPLE.TEXTEDIT', mode: 'deny' },
      { bundleId: 'bad id', mode: 'deny' },
      { bundleId: 'com.apple.Safari', mode: 'unknown' }
    ])).toEqual([
      { bundleId: 'com.apple.TextEdit', mode: 'deny' },
      { bundleId: 'com.apple.Safari', mode: 'always_ask' }
    ])
  })

  it('renders all three policies and saves through plugin options', () => {
    expect(source).toContain("{ label: t('No confirmation', '无需询问'), value: 'always_allow' }")
    expect(source).toContain("{ label: t('Ask every time', '每次询问'), value: 'always_ask' }")
    expect(source).toContain("{ label: t('Deny access', '拒绝访问'), value: 'deny' }")
    expect(source).toContain("view.options.update({ ...options, ...patch }, 'workspace')")
    expect(source).toContain("onChange={mode => void save('default', { defaultApplicationPermission: mode })}")
  })

  it('uses the host settings primitives and responsive rule layout', () => {
    expect(source).toContain('const { Button, Icon, Input, NativeTabs, Select, SettingsRow, SettingsSection }')
    expect(source).toContain("const [activeTab, setActiveTab] = useState('application-access')")
    expect(source).toContain(
      "{ key: 'application-access', icon: 'policy', label: t('Application access', '应用权限') }"
    )
    expect(source).toContain("{ key: 'agent-pointer', icon: 'palette', label: t('Agent pointer', 'Agent 光标') }")
    expect(source).toContain('activeKey={activeTab}')
    expect(source).toContain("{activeTab === 'application-access' && <SettingsSection>")
    expect(source).toContain("{activeTab === 'agent-pointer' && <SettingsSection>")
    expect(source).not.toContain('Control which native applications CUA may inspect or operate.')
    expect(source).not.toContain('Configure the visible CUA pointer.')
    expect(source).not.toContain('cua-driver__notice')
    expect(source).not.toContain('Rules use macOS bundle IDs')
    expect(source).toContain("title={t('Saved application rules', '已保存的应用规则')}")
    expect(stylesSource).toContain('@media (max-width: 720px)')
    expect(stylesSource).toContain('.cua-driver__rules li')
    expect(stylesSource).toContain('.cua-driver__tab-panel > .config-view__editor-wrap { flex: 0 0 auto;')
    expect(stylesSource).toContain('.cua-driver .config-view__section-body { display: flex; flex: 0 0 auto;')
    expect(stylesSource).toContain('.cua-driver .cua-driver__rule-form { display: grid;')
    expect(stylesSource).not.toContain('flex-direction: column; gap: var(--subpage-secondary-gap, 16px)')
    expect(stylesSource).toContain('margin-block-end: var(--subpage-secondary-gap, 16px)')
  })
})
