import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '..')

describe('launcher startup shell', () => {
  it('keeps the visible startup placeholder empty and draggable', async () => {
    const source = await readFile(
      path.join(desktopRoot, 'src/main/window-manager.ts'),
      'utf8'
    )

    expect(source).toContain('<body aria-busy="true"></body>')
    expect(source).toContain('-webkit-app-region: drag')
    expect(source).not.toContain('Starting...')
    expect(source).not.toContain('class="bar"')
  })
})
