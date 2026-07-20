import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('shared resize handle geometry', () => {
  it('keeps iframe DevTools hit areas out of flex layout geometry', () => {
    const styles = readFileSync(
      new URL('../src/components/chat/interaction-panel/ChatInteractionPanel.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toContain(
      'flex: 0 0 var(--oneworks-resize-handle-line-width, 1px)'
    )
    expect(styles).not.toContain(
      'flex: 0 0 var(--iframe-devtools-resizer-hit-size)'
    )
    expect(styles).not.toContain(
      'flex-basis: var(--iframe-devtools-resizer-hit-size)'
    )
  })
})
