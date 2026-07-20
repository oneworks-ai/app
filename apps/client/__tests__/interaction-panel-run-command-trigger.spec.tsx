import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('antd', () => ({
  Button: ({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} className={className}>
      {children}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('interaction panel run command trigger', () => {
  it('uses the shared content action variant when a command title is present', async () => {
    const { InteractionPanelRunCommandsTrigger } = await import(
      '../src/components/chat/interaction-panel/InteractionPanelRunCommandsTrigger'
    )
    const html = renderToStaticMarkup(
      <InteractionPanelRunCommandsTrigger
        command={{ id: 'test', name: 'Build client', script: 'pnpm build' }}
        iconClassName='material-symbols-rounded'
        onPrimaryClick={() => {}}
      />
    )

    expect(html).toContain('route-container-header__action-segment')
    expect(html).toContain('route-container-header__action-button--content')
    expect(html).toContain('Build client')
  })

  it('keeps an empty run command trigger on the shared icon action geometry', async () => {
    const { InteractionPanelRunCommandsTrigger } = await import(
      '../src/components/chat/interaction-panel/InteractionPanelRunCommandsTrigger'
    )
    const html = renderToStaticMarkup(
      <InteractionPanelRunCommandsTrigger
        iconClassName='material-symbols-rounded'
        onPrimaryClick={() => {}}
      />
    )

    expect(html).toContain('route-container-header__action-button')
    expect(html).not.toContain('route-container-header__action-button--content')
  })
})
