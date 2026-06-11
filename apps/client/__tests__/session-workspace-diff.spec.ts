import { describe, expect, it } from 'vitest'

import { parseUnifiedPatchForMonaco } from '#~/components/chat/messages/session-workspace-diff'

describe('session workspace diff parser', () => {
  it('restores original and modified hunk bodies from a unified patch', () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      'index 1111111..2222222 100644',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      ' export { a }'
    ].join('\n')

    expect(parseUnifiedPatchForMonaco(patch)).toEqual({
      original: [
        '@@ -1,3 +1,3 @@',
        'const a = 1',
        'const b = 2',
        'export { a }'
      ].join('\n'),
      modified: [
        '@@ -1,3 +1,3 @@',
        'const a = 1',
        'const b = 3',
        'export { a }'
      ].join('\n')
    })
  })

  it('keeps added-file patches renderable in Monaco diff editor', () => {
    const patch = [
      'diff --git a/README.md b/README.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/README.md',
      '@@ -0,0 +1,2 @@',
      '+# Title',
      '+Body'
    ].join('\n')

    expect(parseUnifiedPatchForMonaco(patch)).toEqual({
      original: '@@ -0,0 +1,2 @@',
      modified: ['@@ -0,0 +1,2 @@', '# Title', 'Body'].join('\n')
    })
  })

  it('returns undefined for patches without hunks', () => {
    expect(parseUnifiedPatchForMonaco('Binary files a/image.png and b/image.png differ')).toBeUndefined()
  })
})
