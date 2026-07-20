import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'

describe('action search toolbar', () => {
  it('supports route content that already provides its own inset', () => {
    const defaultMarkup = renderToStaticMarkup(
      <ActionSearchToolbar
        query=''
        placeholder='Search'
        onQueryChange={() => undefined}
      />
    )
    const flushMarkup = renderToStaticMarkup(
      <ActionSearchToolbar
        actions={[{
          ariaLabel: 'Filter',
          icon: 'filter_alt',
          key: 'filter',
          onClick: () => undefined
        }]}
        inset={false}
        query=''
        placeholder='Search'
        onQueryChange={() => undefined}
      />
    )

    expect(defaultMarkup).not.toContain('action-search-toolbar--flush')
    expect(flushMarkup).toContain('action-search-toolbar--flush')
    expect(flushMarkup).toContain('route-container-header__action-button')
    expect(flushMarkup).not.toContain('action-search-toolbar__button')
  })

  it('owns compact square action geometry through shared tokens', () => {
    const styles = readFileSync(
      new URL('../src/components/action-search-toolbar/ActionSearchToolbar.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toContain('--oneworks-compact-action-size')
    expect(styles).toContain('--oneworks-compact-action-divider-width')
    expect(styles).not.toMatch(/\.plugin-/)
  })
})
