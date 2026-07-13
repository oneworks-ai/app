import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ProjectSkillsList } from '#~/components/knowledge-base/components/ProjectSkillsList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('project skills list empty state', () => {
  it('keeps all scope tabs available before the first skill exists', () => {
    const html = renderToStaticMarkup(
      <ProjectSkillsList
        isLoading={false}
        importing={false}
        query=''
        skills={[]}
        onCreate={() => undefined}
        onImport={() => undefined}
        onQueryChange={() => undefined}
      />
    )

    expect(html).toContain('knowledge.skills.allScope')
    expect(html).toContain('knowledge.skills.projectScope')
    expect(html).toContain('knowledge.skills.globalScope')
    expect(html).not.toContain('aria-label="knowledge.actions.import"')
    expect(html).toContain('action-search-toolbar--flush')
    expect(html).toContain('knowledge.skills.empty')
  })
})
