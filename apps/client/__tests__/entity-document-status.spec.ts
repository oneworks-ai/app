import { describe, expect, it } from 'vitest'

import { hasEntityDocumentContent } from '../src/components/knowledge-base/components/entity-document-status'

describe('entity document status', () => {
  it('treats README role fallback content as an available document', () => {
    expect(hasEntityDocumentContent({
      body: '# Role\n\nResolved from the entity README.',
      fragments: []
    })).toBe(true)
  })

  it('keeps an empty document in the not-created state', () => {
    expect(hasEntityDocumentContent({ body: '', fragments: [] })).toBe(false)
  })
})
