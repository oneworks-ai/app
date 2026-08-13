import { describe, expect, it } from 'vitest'

import { normalizePath, resolvePromptPath, resolveRelativePath } from '#~/document-path.js'

describe('document path utils', () => {
  it('normalizes windows separators', () => {
    expect(normalizePath('foo\\bar\\baz.md')).toBe('foo/bar/baz.md')
  })

  it('resolves relative and prompt paths against the workspace root', () => {
    expect(resolveRelativePath('/tmp/project', '/tmp/project/.oo/rules/x.md')).toBe('.oo/rules/x.md')
    expect(resolvePromptPath('/tmp/project', '/outside/path/rule.md')).toBe('/outside/path/rule.md')
  })

  it('preserves POSIX literal backslashes in filesystem-relative prompt paths', () => {
    expect(resolveRelativePath('/tmp/project', '/tmp/project/rules\\review.md')).toBe('rules\\review.md')
    expect(resolvePromptPath('/tmp/project', '/tmp/project/rules\\review.md')).toBe('rules\\review.md')
  })

  it('keeps contained dot-dot-prefixed names relative without admitting outside siblings', () => {
    expect(resolvePromptPath('/tmp/project', '/tmp/project/..notes/rule.md')).toBe('..notes/rule.md')
    expect(resolvePromptPath('/tmp/project', '/tmp/..notes/rule.md')).toBe('/tmp/..notes/rule.md')
  })
})
