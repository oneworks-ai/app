import { describe, expect, it } from 'vitest'

import { isWorkspaceMarkdownPreviewPath } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import { resolveWorkspaceMarkdownLinkedPath } from '#~/components/chat/workspace-file-editor/workspace-markdown-links'

describe('workspace file markdown preview', () => {
  it('limits markdown rendering controls to markdown file extensions', () => {
    expect(isWorkspaceMarkdownPreviewPath('README.md')).toBe(true)
    expect(isWorkspaceMarkdownPreviewPath('docs/guide.markdown')).toBe(true)
    expect(isWorkspaceMarkdownPreviewPath('notes/todo.mkd')).toBe(true)
    expect(isWorkspaceMarkdownPreviewPath('src/App.tsx')).toBe(false)
    expect(isWorkspaceMarkdownPreviewPath('notes.txt')).toBe(false)
  })

  it('resolves relative markdown links inside the workspace', () => {
    expect(resolveWorkspaceMarkdownLinkedPath('docs/guide/intro.md', '../assets/logo.png')).toBe(
      'docs/assets/logo.png'
    )
    expect(resolveWorkspaceMarkdownLinkedPath('docs/guide/intro.md', '/README.md#setup')).toBe('README.md')
    expect(resolveWorkspaceMarkdownLinkedPath('docs/guide/intro.md', 'https://example.com')).toBeNull()
  })
})
