import { describe, expect, it, vi } from 'vitest'

import { buildMarkdownLinkText, openExternalLink } from '#~/components/markdown-link-context-menu-utils'

describe('markdown link actions', () => {
  it('preserves an explicit OneWorks intent when copying Markdown', () => {
    expect(buildMarkdownLinkText({
      href: 'https://example.com/docs',
      label: 'Docs',
      title: 'oneworks:open=external'
    })).toBe('[Docs](https://example.com/docs "oneworks:open=external")')
  })

  it('uses the desktop bridge for the system default browser', () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined)
    const open = vi.fn()
    vi.stubGlobal('window', {
      oneworksDesktop: { openExternalUrl },
      open
    })

    openExternalLink('https://example.com/docs')

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
    expect(open).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
