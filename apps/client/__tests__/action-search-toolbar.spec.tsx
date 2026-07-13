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
})
