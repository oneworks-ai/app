import { readFileSync } from 'node:fs'

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const responsiveLayout = vi.hoisted(() => ({
  isCompactLayout: false,
  isTouchInteraction: false
}))

vi.mock('antd', () => ({
  Drawer: () => null,
  Spin: () => <span data-testid='spin' />,
  Select: React.forwardRef<HTMLDivElement, Record<string, unknown>>((
    { 'aria-hidden': ariaHidden, className, tabIndex },
    ref
  ) => (
    <div
      ref={ref}
      aria-hidden={ariaHidden as boolean | undefined}
      className={String(className ?? '')}
      data-tab-index={String(tabIndex)}
    />
  ))
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/hooks/use-responsive-layout', () => ({
  useResponsiveLayout: () => responsiveLayout
}))

describe('mobile-aware select control trigger', () => {
  beforeEach(() => {
    responsiveLayout.isCompactLayout = false
    responsiveLayout.isTouchInteraction = false
  })

  it('provides one native trigger around the desktop select without a duplicate tab stop', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{
          ariaLabel: 'Choose an option',
          className: 'custom-trigger',
          wrapperClassName: 'custom-select-shell'
        }}
      />
    )

    expect(html).toContain('mobile-aware-select-trigger-shell')
    expect(html).toContain('custom-select-shell')
    expect(html).toContain('oneworks-control-trigger--overlay custom-trigger')
    expect(html).toContain('aria-label="Choose an option"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('data-tab-index="-1"')
  })

  it('does not render an interactive trigger for a disabled select', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        disabled
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{ ariaLabel: 'Choose an option' }}
      />
    )

    expect(html).toContain('mobile-aware-select-trigger-shell')
    expect(html).toContain('is-disabled')
    expect(html).not.toContain('oneworks-control-trigger--overlay')
  })

  it('treats a loading desktop select as non-interactive', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        loading
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{ ariaLabel: 'Choose an option' }}
      />
    )

    expect(html).toContain('mobile-aware-select-trigger-shell')
    expect(html).toContain('is-disabled')
    expect(html).not.toContain('oneworks-control-trigger--overlay')
  })

  it('renders a content trigger as the visible select control for custom compact surfaces', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{
          ariaLabel: 'Choose an option',
          className: 'custom-content-trigger',
          content: <span>One</span>
        }}
      />
    )

    expect(html).toContain('mobile-aware-select-trigger-shell--content')
    expect(html).toContain('oneworks-control-trigger--content custom-content-trigger')
    expect(html).toContain('<span>One</span>')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('oneworks-control-trigger--overlay custom-content-trigger')
  })

  it('keeps a disabled content trigger visible but non-interactive', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        disabled
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{
          ariaLabel: 'Choose an option',
          content: <span>One</span>
        }}
      />
    )

    expect(html).toContain('oneworks-control-trigger--content')
    expect(html).toContain('disabled=""')
    expect(html).toContain('<span>One</span>')
  })

  it('keeps a loading content trigger visible but non-interactive', async () => {
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        loading
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        controlTrigger={{
          ariaLabel: 'Choose an option',
          content: <span>One</span>
        }}
      />
    )

    expect(html).toContain('oneworks-control-trigger--content')
    expect(html).toContain('disabled=""')
    expect(html).toContain('<span>One</span>')
  })

  it('keeps the compact drawer hitbox as the only tab stop', async () => {
    responsiveLayout.isCompactLayout = true
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        mobileTitle='Choose an option'
      />
    )

    expect(html).toContain('data-tab-index="-1"')
    expect(html).toContain('oneworks-control-trigger--overlay mobile-aware-select-trigger-hitbox')
    expect(html).toContain('aria-label="Choose an option"')
  })

  it('does not render the compact drawer hitbox while loading', async () => {
    responsiveLayout.isCompactLayout = true
    const { MobileAwareSelect } = await import(
      '#~/components/mobile-aware-select/MobileAwareSelect'
    )

    const html = renderToStaticMarkup(
      <MobileAwareSelect<string>
        loading
        value='one'
        options={[{ label: 'One', value: 'one' }]}
        mobileTitle='Choose an option'
      />
    )

    expect(html).toContain('data-tab-index="-1"')
    expect(html).not.toContain('mobile-aware-select-trigger-hitbox')
  })

  it('lets every visible content trigger consume the shared Select padding token', () => {
    const styles = readFileSync(
      new URL(
        '../src/components/mobile-aware-select/MobileAwareSelect.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(styles).toMatch(
      /\.oneworks-select,\s*\.mobile-aware-select-trigger-shell\s*\{[^}]*--oneworks-select-padding-inline:\s*10px/
    )
    expect(styles).toContain('.mobile-aware-select-trigger-shell--content {')
    expect(styles).toContain('> .oneworks-control-trigger--content {')
    expect(styles).toContain(
      'padding-block: var(--oneworks-select-padding-block)'
    )
    expect(styles).toContain(
      'padding-inline: var(--oneworks-select-padding-inline)'
    )
  })
})
