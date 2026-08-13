import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  findDocumentItemByPath,
  readDocumentPanelQueryValue,
  writeDocumentPanelQuery
} from '../src/client/react-view.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay document URL path identity', () => {
  it('round-trips and selects the exact whitespace-bearing document path', () => {
    let current = new URL('http://localhost/plugins/relay?doc=rules%2Fsecret.md%20')
    vi.stubGlobal('window', {
      get location() {
        return current
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, route: string) => {
          current = new URL(route, current)
        }
      }
    })
    const documents = [
      {
        displayPath: 'rules/secret.md',
        exists: true,
        path: '/home/.oo/rules/secret.md',
        relativePath: 'rules/secret.md'
      },
      {
        displayPath: 'rules/secret.md ',
        exists: true,
        path: '/home/.oo/rules/secret.md ',
        relativePath: 'rules/secret.md '
      }
    ]

    const requested = readDocumentPanelQueryValue('doc')
    expect(requested).toBe('rules/secret.md ')
    expect(findDocumentItemByPath(documents, requested)?.path).toBe('/home/.oo/rules/secret.md ')
    writeDocumentPanelQuery({ documentPath: documents[0].relativePath, search: ' exact query ' })
    expect(current.searchParams.get('doc')).toBe('rules/secret.md')
    expect(current.searchParams.get('q')).toBe('exact query')
    writeDocumentPanelQuery({ documentPath: documents[1].relativePath, search: '' })
    expect(current.search).toBe('?doc=rules%2Fsecret.md+')
    expect(current.search).not.toBe('?doc=rules%2Fsecret.md')
    expect(findDocumentItemByPath(documents, readDocumentPanelQueryValue('doc'))?.relativePath)
      .toBe('rules/secret.md ')
  })
})
