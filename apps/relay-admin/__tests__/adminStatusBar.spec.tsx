import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AdminStatusBar } from '../src/features/dashboard/AdminStatusBar'

describe('admin status bar', () => {
  it('does not render a missing session prompt because the dashboard redirects instead', () => {
    const html = renderToStaticMarkup(
      <AdminStatusBar authStatus='missing' loading={false} loginUrl='/login' />
    )

    expect(html).toBe('')
    expect(html).not.toContain('admin sign-in required')
    expect(html).not.toContain('Sign in')
  })
})
