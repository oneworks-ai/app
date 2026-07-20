import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('shared sender surface toolbar contract', () => {
  it('lets themes own toolbar spacing, action padding, and structural dividers', () => {
    const styles = readFileSync(
      new URL('../src/components/chat/sender/SenderSurface.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toContain('--chat-surface-toolbar-gap: 12px')
    expect(styles).toContain('--chat-surface-toolbar-left-gap: 14px')
    expect(styles).toContain('--chat-surface-toolbar-right-gap: 4px')
    expect(styles).toContain('--chat-surface-toolbar-action-padding-block: 0px')
    expect(styles).toContain('--chat-surface-toolbar-bleed-inline: 0px')
    expect(styles).toContain('--chat-surface-toolbar-bleed-bottom: 0px')
    expect(styles).toContain('--chat-surface-toolbar-margin-top: 0px')
    expect(styles).toContain('--chat-surface-toolbar-right-divider-width: 0px')
    expect(styles).toContain(
      '--chat-surface-toolbar-action-height: var(--chat-surface-control-height)'
    )
    expect(styles).toMatch(
      /\.sender-container--chat-surface \.chat-input-toolbar\s*\{[^}]*gap:\s*var\(--chat-surface-toolbar-gap\)/
    )
    expect(styles).toMatch(
      /\.sender-container--chat-surface \.chat-input-toolbar::before\s*\{[^}]*height:\s*var\(--chat-surface-toolbar-divider-width\)/
    )
    expect(styles).toMatch(
      /\.sender-container--chat-surface \.chat-input-toolbar\s*\{[^}]*margin-top:\s*var\(--chat-surface-toolbar-margin-top\)/
    )
    expect(styles).toContain(
      'padding: var(--chat-surface-toolbar-action-padding-block)\n    var(--chat-surface-toolbar-action-padding-inline) !important'
    )
    expect(styles).toMatch(
      /\.sender-responsive-select-button--model\s*\{[^}]*padding:\s*var\(--chat-surface-toolbar-action-padding-block\)\s*var\(--chat-surface-toolbar-action-padding-inline\) !important/
    )
    expect(styles).toMatch(
      /\.sender-select-shell--model\s*\{[^}]*--oneworks-select-padding-inline:\s*var\(\s*--chat-surface-toolbar-action-padding-inline\s*\)/
    )
    expect(styles).toMatch(
      /\.sender-select-shell--model\s*\{[^}]*--oneworks-select-padding-block:\s*var\(\s*--chat-surface-toolbar-action-padding-block\s*\)/
    )
    expect(styles).toContain(
      'padding: var(--chat-surface-status-action-padding-block)\n    var(--chat-surface-status-action-padding-inline) !important'
    )
    expect(styles).toContain('.sender-select-content-trigger')
    expect(styles).not.toMatch(
      /:is\(\.sender-select-shell--model, \.sender-select-shell--effort\)\s*\{[^}]*padding-inline:/
    )
    expect(styles).toContain(
      'height: var(--chat-surface-control-separator-height)'
    )
    expect(styles).toContain('--chat-surface-status-padding-block: var(')
    expect(styles).toContain('--chat-surface-status-padding-inline: var(')
    expect(styles).toContain('--chat-surface-status-group-gap: 14px')
    expect(styles).toContain('--chat-surface-status-actions-gap: 14px')
    expect(styles).toContain('--chat-surface-status-account-gap: 4px')
    expect(styles).toContain('--chat-surface-status-account-separator-width: 0px')
    expect(styles).toContain('--chat-surface-control-hover-bg: transparent')
    expect(styles).toContain('--chat-surface-control-hover-shadow: none')
    expect(styles).toContain('--chat-surface-control-font-size: 12px')
    expect(styles).toContain('--chat-surface-status-action-hover-bg: var(')
    expect(styles).toContain('--chat-surface-status-action-hover-color: var(')
    expect(styles).toContain('--chat-surface-status-action-hover-shadow: var(')
    expect(styles).toContain('--chat-surface-control-font-weight: 400')
    expect(styles).toContain(
      '--chat-surface-control-line-height: var(--chat-surface-control-height)'
    )
    expect(styles).toContain(
      '--chat-surface-control-height: var(--chat-surface-control-size, 18px)'
    )
    expect(styles).toContain('--chat-surface-toolbar-bg: transparent')
    expect(styles).toContain('--chat-surface-status-action-padding-block: 0px')
    expect(styles).toContain('--chat-surface-status-divider-layout-width: var(')
    expect(styles).toContain('--chat-surface-status-divider-overlay-width: 0px')
    expect(styles).toContain('--chat-surface-status-icon-action-size: var(')
    expect(styles).toMatch(
      /\.chat-status-bar\s*\{[^}]*padding:\s*var\(--chat-surface-status-padding-block\)\s*var\(--chat-surface-status-padding-inline\)/
    )
    expect(styles).toMatch(
      /\.chat-status-bar-frame\s*\{[^}]*min-height:\s*calc\(\s*var\(--chat-surface-status-row-height\)\s*\+\s*var\(--chat-surface-status-divider-layout-width\)/
    )
    expect(styles).toMatch(
      /\.chat-status-bar::before\s*\{[^}]*border-bottom:\s*var\(--chat-surface-status-divider-overlay-width\)/
    )
    expect(styles).toMatch(
      /\.chat-header-git__trigger\.ant-btn\.ant-btn-text\)\s*\{[^}]*height:\s*var\(--chat-surface-status-control-height\) !important;[^}]*padding:\s*var\(--chat-surface-status-action-padding-block\)\s*var\(--chat-surface-status-action-padding-inline\) !important/
    )
    expect(styles).toMatch(
      /:is\(\.toolbar-btn__icon-shell,[^}]*\.model-select-trigger-text,[^}]*\)\s*\{[^}]*color:\s*var\(--chat-surface-control-default-color\)/
    )
    expect(styles).toMatch(
      /:is\(\.toolbar-btn\.toolbar-btn--reference, \.sender-select-content-trigger, \.sender-responsive-select-button--model\)\s*\{[^}]*font-size:\s*var\(--chat-surface-control-font-size\) !important;[^}]*font-weight:\s*var\(--chat-surface-control-font-weight\) !important;[^}]*line-height:\s*var\(--chat-surface-control-line-height\) !important/
    )
    expect(styles).toMatch(
      /:is\(\.sender-voice-control__button, \.chat-send-btn\)\s*\{[^}]*font-size:\s*var\(--chat-surface-control-font-size\) !important;[^}]*font-weight:\s*var\(--chat-surface-control-font-weight\) !important;[^}]*line-height:\s*var\(--chat-surface-control-line-height\) !important/
    )
    expect(styles).toMatch(
      /:is\(\.model-select, \.effort-select\)\s*:is\(\.ant-select-selection-item,[^}]*\)\s*\{[^}]*color:\s*var\(--chat-surface-control-default-color\)/
    )
    expect(styles).toMatch(
      /:is\(\.sender-select-shell:hover \.model-select,[^}]*\)\s*:is\(\.ant-select-selection-item,[^}]*\)\s*\{[^}]*color:\s*var\(--chat-surface-control-hover-color\)/
    )
    expect(styles).not.toMatch(
      /\.model-select-trigger-text[^}]*\{[^}]*var\(--placeholder-color/
    )
    expect(styles).not.toMatch(
      /:is\(\.model-select, \.effort-select\)[^}]*\{[^}]*var\(--primary-color/
    )
    expect(styles).toMatch(
      /\.chat-header-git__trigger\.ant-btn\.ant-btn-text\)\s*\{[^}]*font-size:\s*var\(--chat-surface-control-font-size\) !important;[^}]*font-weight:\s*var\(--chat-surface-control-font-weight\) !important;[^}]*line-height:\s*var\(--chat-surface-control-line-height\) !important/
    )
    expect(styles).toContain(
      '.account-quota-indicators:is(:hover, :focus-within)'
    )
    expect(styles).toContain('.sender-select-shell--account:not(.is-disabled)')
    expect(styles).toContain('.account-quota-indicators,')
    expect(styles).toContain('.sender-select-shell--adapter:not(.is-disabled)')
    expect(styles).toMatch(
      /:is\(:hover, :focus-within, \.is-open\)\s*\{[^}]*background:\s*var\(--chat-surface-status-action-hover-bg\) !important/
    )
    expect(styles).toMatch(
      /\.account-select\s+\.ant-select-selector,\s*\.adapter-select,\s*\.adapter-select\s+\.ant-select-selector\)\s*\{[^}]*background:\s*transparent !important/
    )
    expect(styles).toMatch(/\.account-select\s+\*/)
    expect(styles).toMatch(/\.adapter-select\s+\*/)
    expect(styles).toContain('.oneworks-control-trigger')
    expect(styles).toMatch(
      /\.sender-select-shell--account\s+\.account-select\s+\.ant-select-selector\s*\{[^}]*padding-inline:\s*0 !important/
    )
    expect(styles).toMatch(
      /:is\(\.account-select, \.adapter-select\)\s+\.ant-select-selector\s*\{[^}]*font-size:\s*var\(--chat-surface-control-font-size\) !important;[^}]*font-weight:\s*var\(--chat-surface-control-font-weight\) !important;[^}]*line-height:\s*var\(--chat-surface-control-line-height\) !important;[^}]*background:\s*transparent !important;[^}]*color:\s*var\(--chat-surface-status-default-color\) !important/
    )
    expect(styles).toContain('--quota-usage-ring-inner-bg: var(')
    expect(styles).toContain('.quota-usage-ring__inner')
    expect(styles).toContain(
      '.sender-container--chat-surface.sender-container--chat-surface\n  .chat-status-bar'
    )
    expect(styles).toContain(
      'background: var(--chat-surface-control-hover-bg)'
    )
    expect(styles).not.toContain(
      'box-shadow: inset 0 0 0 1px\n    color-mix(in srgb, var(--primary-color) 38%, transparent) !important'
    )
  })

  it('forwards open and disabled state to every compact Select shell', () => {
    const senderStyles = readFileSync(
      new URL('../src/components/chat/sender/SenderSurface.scss', import.meta.url),
      'utf8'
    )
    const sharedSelectStyles = readFileSync(
      new URL(
        '../src/components/chat/sender/@components/sender-toolbar/SenderSelectShared.scss',
        import.meta.url
      ),
      'utf8'
    )
    const modelControl = readFileSync(
      new URL(
        '../src/components/chat/sender/@components/model-select/ModelSelectControl.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const accountControl = readFileSync(
      new URL(
        '../src/components/chat/sender/@components/account-select/AccountSelectControl.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const adapterControl = readFileSync(
      new URL(
        '../src/components/chat/sender/@components/adapter-select/AdapterSelectControl.tsx',
        import.meta.url
      ),
      'utf8'
    )

    expect(modelControl).toContain("isModelSelectOpen ? 'is-open' : ''")
    expect(modelControl).toContain(
      "modelUnavailable || isThinking ? 'is-disabled' : ''"
    )
    expect(accountControl).toContain("showAccountSelect ? 'is-open' : ''")
    expect(accountControl).toContain("isDisabled ? 'is-disabled' : ''")
    expect(adapterControl).toContain("showAdapterSelect ? 'is-open' : ''")
    expect(adapterControl).toContain("isDisabled ? 'is-disabled' : ''")
    expect(senderStyles).toContain(
      '.sender-select-shell--model:not(.is-disabled):is(:hover, :focus-within, .is-open)'
    )
    expect(senderStyles).toContain('.sender-responsive-select-button--model')
    expect(sharedSelectStyles).toContain('&:not(.is-disabled):hover')
    expect(sharedSelectStyles).not.toContain('\n  &:hover {')
  })
})
