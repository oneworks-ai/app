import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AdminActionButton } from '../src/shared/ui/AdminActionButton'

describe('admin action button', () => {
  it('moves icon-only action copy from native title to the shared tooltip', () => {
    const html = renderToStaticMarkup(
      <AdminActionButton aria-label='刷新列表' iconName='refresh' title='刷新列表' type='text' />
    )

    expect(html).toContain('aria-label="刷新列表"')
    expect(html).not.toContain('title="刷新列表"')
  })

  it('keeps disabled icon-only actions hoverable through a tooltip target', () => {
    const html = renderToStaticMarkup(
      <AdminActionButton aria-label='刷新列表' disabled iconName='refresh' title='刷新列表' type='text' />
    )

    expect(html).toContain('relay-admin-action-button__tooltip-target')
    expect(html).toContain('aria-label="刷新列表"')
    expect(html).not.toContain('title="刷新列表"')
  })
})
