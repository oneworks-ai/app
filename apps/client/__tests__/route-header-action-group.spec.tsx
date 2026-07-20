import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RouteHeaderActionGroup } from '@oneworks/components/route-layout'

describe('route header action group contract', () => {
  it('renders joined groups through the shared route header primitive', () => {
    const html = renderToStaticMarkup(
      <RouteHeaderActionGroup className='test-actions' joined>
        <span className='route-container-header__action-segment'>
          <button type='button'>Primary</button>
        </span>
        <span className='route-container-header__action-segment'>
          <button type='button'>Menu</button>
        </span>
      </RouteHeaderActionGroup>
    )

    expect(html).toContain('route-container-header__action-group')
    expect(html).toContain('is-joined')
    expect(html).toContain('test-actions')
  })

  it('owns group height, spacing, and divider geometry in the shared layout CSS', () => {
    const styles = readFileSync(
      new URL('../../../packages/route-layout/src/RouteContainerHeader.css', import.meta.url),
      'utf8'
    )

    expect(styles).toMatch(
      /\.route-container-header__action-group\s*\{[^}]*height:\s*100%;[^}]*align-items:\s*stretch;[^}]*gap:\s*var\(/
    )
    expect(styles).toMatch(
      /\.route-container-header__action-group:not\(\.is-joined\)\s*>\s*\*\s*\+\s*\*::before\s*\{[^}]*width:\s*var\(--route-container-header-action-group-divider-width,\s*0px\)[^}]*background:\s*var\(/
    )
    expect(styles).toMatch(
      /\.route-container-header__action-group\.is-joined[^}]*>\s*\.route-container-header__action-segment[^}]*\+\s*\.route-container-header__action-segment::before\s*\{[^}]*width:\s*var\(\s*--route-container-header-joined-action-divider-width,[^}]*background:\s*var\(/
    )
    expect(styles).not.toContain(
      'border-inline-start: var(\n    --route-container-header-action-group-divider-width'
    )
    expect(styles).toMatch(
      /\.route-container-header__action-group\.is-joined\s*\{[^}]*--route-container-header-action-group-gap:\s*0px;/
    )
    expect(styles).not.toMatch(
      /\.route-container-header__action-group\.is-joined\s*\{[^}]*--route-container-header-action-group-divider-width:/
    )
  })

  it('keeps chat header workspace actions on the shared action primitives', () => {
    const chatHeader = readFileSync(
      new URL('../src/components/chat/ChatHeader.tsx', import.meta.url),
      'utf8'
    )
    const workspaceActions = readFileSync(
      new URL(
        '../src/components/chat/interaction-panel/InteractionPanelWorkspaceActions.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const workspaceOpener = readFileSync(
      new URL(
        '../src/components/chat/interaction-panel/InteractionPanelWorkspaceOpener.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const headerStyles = readFileSync(
      new URL('../src/components/chat/ChatHeader.scss', import.meta.url),
      'utf8'
    )
    const runCommandTrigger = readFileSync(
      new URL(
        '../src/components/chat/interaction-panel/InteractionPanelRunCommandsTrigger.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const sharedComponentStyles = readFileSync(
      new URL('../../../packages/components/src/route-layout/styles.css', import.meta.url),
      'utf8'
    )
    const routeLayoutStyles = readFileSync(
      new URL('../../../packages/route-layout/src/RouteContainerHeader.css', import.meta.url),
      'utf8'
    )

    expect(chatHeader).toContain("<RouteHeaderActionGroup className='chat-header-actions'>")
    expect(workspaceActions).toContain('<RouteHeaderActionGroup className={containerClassName}>')
    expect(workspaceOpener).toContain("<RouteHeaderActionGroup className='chat-header-workspace-opener' joined>")
    expect(workspaceOpener.match(/<RouteHeaderActionButton/g)).toHaveLength(2)
    expect(runCommandTrigger).toContain("command == null ? '' : 'route-container-header__action-button--content'")
    expect(runCommandTrigger).toContain("<span className='route-container-header__action-segment'>")
    expect(sharedComponentStyles).toContain(
      'padding: var(--route-container-header-action-padding, 0) !important;'
    )
    expect(routeLayoutStyles).toMatch(
      /\.route-container-header__action-button--content\s*\{[^}]*--route-container-header-action-inline-size:\s*auto;[^}]*--route-container-header-action-padding:/
    )
    expect(headerStyles).not.toContain('--chat-header-workspace-action-size')
    expect(headerStyles).not.toContain('--chat-header-workspace-action-bleed')
    expect(headerStyles).not.toMatch(/\.chat-header-workspace-opener\s*\{[^}]*box-shadow:/)
  })
})
