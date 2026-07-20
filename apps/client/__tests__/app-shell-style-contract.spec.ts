import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('app shell surface geometry', () => {
  it('keeps route-sidebar content on the active theme surface radius', () => {
    const styles = readFileSync(
      new URL('../src/components/layout/AppShell.scss', import.meta.url),
      'utf8'
    )

    expect(styles).not.toMatch(
      /\.app-shell__content\.app-shell__content--route-sidebar\s*\{[^}]*border-radius:\s*0/
    )
    expect(styles).toMatch(
      /\.app-shell__content\.app-shell__content--route-sidebar\s*>\s*\*\s*\{[^}]*border-radius:\s*var\(--app-shell-content-radius\)/
    )
  })
})
