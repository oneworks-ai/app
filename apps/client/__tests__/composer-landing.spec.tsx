import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ComposerLanding } from '#~/components/composer-landing/ComposerLanding'
import { ComposerStarterGuide } from '#~/components/composer-landing/ComposerStarterGuide'

describe('composer landing', () => {
  it('keeps starter layout horizontal spacing owned by the shared 10px surface padding', () => {
    const layoutStyles = readFileSync(
      new URL(
        '../src/components/composer-landing/ComposerStarterLayout.scss',
        import.meta.url
      ),
      'utf8'
    )
    const routeStyles = readFileSync(
      new URL('../src/routes/ChatRoute.scss', import.meta.url),
      'utf8'
    )

    expect(layoutStyles).toContain('--chat-surface-padding: 10px')
    expect(layoutStyles).not.toContain('--chat-surface-padding: 6px')
    expect(routeStyles).toContain(
      'padding: calc(var(--chat-header-overlay-content-offset) + 12px) 0 16px'
    )
    expect(routeStyles).not.toContain(
      'padding: calc(var(--chat-header-overlay-content-offset) + 12px) 24px 16px'
    )
  })

  it('keeps starter content inside one full-height landing region', () => {
    const html = renderToStaticMarkup(
      <ComposerLanding className='composer-landing--starter'>
        <div>Guide</div>
      </ComposerLanding>
    )

    expect(html).toContain('composer-landing composer-landing--starter')
    expect(html).toContain('class="composer-landing__content"')
  })

  it('renders introduction, composer, then platform list in the shared starter layout', () => {
    const html = renderToStaticMarkup(
      <ComposerStarterGuide
        composer={<div data-slot='composer'>Composer</div>}
        description='Choose one'
        icon='extension'
        items={[{
          icon: 'add',
          key: 'starter',
          order: 0,
          searchText: 'Starter prompt',
          title: 'Starter',
          value: 'Prompt'
        }]}
        labels={{
          emptySearch: 'Empty',
          favorite: 'Favorite',
          recent: 'Recent',
          searchPlaceholder: 'Search',
          showLess: 'Less',
          showMore: count => `More ${count}`,
          unfavorite: 'Unfavorite'
        }}
        onSelect={() => {}}
      />
    )

    expect(html).toContain('composer-content-frame composer-starter-layout')
    expect(html).toContain('has-starter-list composer-starter-guide')
    expect(html).toContain('composer-starter-layout__composer')
    expect(html).toContain('composer-starter-list')
    expect(html).toContain('composer-starter-guide__introduction-icon')
    expect(html).toContain('extension')
    expect(html.indexOf('Choose one')).toBeLessThan(html.indexOf('data-slot="composer"'))
    expect(html.indexOf('data-slot="composer"')).toBeLessThan(html.indexOf('composer-starter-list'))
  })
})
