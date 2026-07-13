import { describe, expect, it } from 'vitest'

import { KNOWLEDGE_PATHS, resolveKnowledgeLocation } from '#~/components/knowledge-base/knowledge-routes'

describe('knowledge path routing', () => {
  it('maps the legacy skill market query to the store path and preserves filters', () => {
    expect(resolveKnowledgeLocation(
      '/knowledge',
      '?kbTab=skills&skillView=market&skillSource=Anthropic'
    )).toEqual({
      pathname: KNOWLEDGE_PATHS.skillsStore,
      search: '?skillSource=Anthropic',
      sectionKey: 'skills',
      skillPage: 'store',
      shouldReplace: true
    })
  })

  it('maps legacy section queries to their paths', () => {
    expect(resolveKnowledgeLocation('/knowledge', '?kbTab=entities').pathname).toBe(KNOWLEDGE_PATHS.entities)
    expect(resolveKnowledgeLocation('/knowledge', '?kbTab=flows').pathname).toBe(KNOWLEDGE_PATHS.flows)
    expect(resolveKnowledgeLocation('/knowledge', '?kbTab=rules').pathname).toBe(KNOWLEDGE_PATHS.rules)
  })

  it('keeps canonical settings paths without page query params', () => {
    expect(resolveKnowledgeLocation(
      KNOWLEDGE_PATHS.skillsSettings,
      '?kbTab=skills&skillView=market&debug=1'
    )).toEqual({
      pathname: KNOWLEDGE_PATHS.skillsSettings,
      search: '?debug=1',
      sectionKey: 'skills',
      skillPage: 'settings',
      shouldReplace: true
    })
  })

  it('canonicalizes unknown knowledge paths to project skills', () => {
    expect(resolveKnowledgeLocation('/knowledge/unknown', '')).toMatchObject({
      pathname: KNOWLEDGE_PATHS.skillsProject,
      sectionKey: 'skills',
      skillPage: 'project',
      shouldReplace: true
    })
  })
})
