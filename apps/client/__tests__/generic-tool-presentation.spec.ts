import { describe, expect, it } from 'vitest'

import { buildGenericToolPresentation } from '#~/components/chat/tools/core/generic-tool-presentation'

describe('generic tool presentation', () => {
  it('extracts a compact target and diff for codex EditFile tools', () => {
    const presentation = buildGenericToolPresentation('adapter:codex:EditFile', {
      path: '/tmp/example.tsx',
      oldString: 'const before = true\n',
      newString: 'const after = false\n'
    })

    expect(presentation.fallbackTitle).toBe('Edit File')
    expect(presentation.primary).toBe('/tmp/example.tsx')
    expect(presentation.diff).toEqual(expect.objectContaining({
      original: 'const before = true\n',
      modified: 'const after = false\n',
      language: 'tsx'
    }))
    expect(presentation.suppressSuccessResult).toBe(true)
  })

  it('uses patch targets instead of raw patch text as the summary target', () => {
    const presentation = buildGenericToolPresentation('adapter:codex:ApplyPatch', {
      patch: [
        '*** Begin Patch',
        '*** Add File: /tmp/example.ts',
        '+export const value = 1',
        '*** End Patch'
      ].join('\n')
    })

    expect(presentation.fallbackTitle).toBe('Apply Patch')
    expect(presentation.primary).toBe('/tmp/example.ts')
    expect(presentation.blockFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        labelKey: 'chat.tools.fields.patch',
        format: 'code',
        lang: 'diff'
      })
    ]))
  })

  it('renders codex file-change summaries as compact lists', () => {
    const presentation = buildGenericToolPresentation('adapter:codex:FileChange', {
      status: 'completed',
      changes: [
        { kind: 'add', path: '/tmp/a.ts' },
        { kind: 'delete', path: '/tmp/b.ts' }
      ]
    })

    expect(presentation.primary).toBe('2 files')
    expect(presentation.inlineFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        labelKey: 'chat.tools.fields.status',
        format: 'inline',
        value: 'completed'
      })
    ]))
    expect(presentation.blockFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        labelKey: 'chat.tools.fields.changes',
        format: 'list',
        value: ['add /tmp/a.ts', 'delete /tmp/b.ts']
      })
    ]))
  })

  it('renders Kimi StrReplaceFile display input as a diff', () => {
    const presentation = buildGenericToolPresentation('StrReplaceFile', {
      path: 'src/app.ts',
      edit: {
        old: 'const value = 1',
        new: 'const value = 2'
      },
      old_text: 'const value = 1',
      new_text: 'const value = 2',
      old_start: 3,
      new_start: 3,
      diffs: [{
        path: 'src/app.ts',
        old_text: 'const value = 1',
        new_text: 'const value = 2',
        old_start: 3,
        new_start: 3
      }]
    })

    expect(presentation.fallbackTitle).toBe('Edit File')
    expect(presentation.primary).toBe('src/app.ts')
    expect(presentation.diff).toEqual(expect.objectContaining({
      original: 'const value = 1',
      modified: 'const value = 2',
      language: 'typescript'
    }))
    expect(presentation.blockFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        labelKey: 'chat.tools.fields.edit',
        format: 'json'
      })
    ]))
    expect(presentation.blockFields).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ labelKey: 'chat.tools.fields.diffs' })
    ]))
  })

  it('uses Kimi native tool names for shell and web summaries', () => {
    expect(buildGenericToolPresentation('Shell', { command: 'pwd' })).toMatchObject({
      fallbackTitle: 'Bash',
      icon: 'terminal',
      primary: 'pwd'
    })
    expect(buildGenericToolPresentation('SearchWeb', { query: 'kimi wire protocol' })).toMatchObject({
      fallbackTitle: 'Web Search',
      icon: 'travel_explore',
      primary: 'kimi wire protocol'
    })
    expect(buildGenericToolPresentation('FetchURL', { url: 'https://www.kimi.com' })).toMatchObject({
      fallbackTitle: 'Web Fetch',
      icon: 'language',
      primary: 'https://www.kimi.com'
    })
  })

  it('renders Kimi SetTodoList items as a compact list', () => {
    const presentation = buildGenericToolPresentation('SetTodoList', {
      items: [
        { title: 'Read wire docs', status: 'done' },
        { title: 'Patch adapter', status: 'in_progress' }
      ]
    })

    expect(presentation.fallbackTitle).toBe('Task Planning')
    expect(presentation.primary).toBe('2 tasks')
    expect(presentation.blockFields).toEqual([
      expect.objectContaining({
        labelKey: 'chat.tools.fields.items',
        format: 'list',
        value: [
          'done: Read wire docs',
          'in_progress: Patch adapter'
        ]
      })
    ])
  })
})
