import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('launcher command item visual contract', () => {
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
})
