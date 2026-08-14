import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { KnowledgeBaseView } from '#~/components/knowledge-base'
import {
  getKnowledgeEntityPath,
  getKnowledgeSectionPath,
  getKnowledgeSkillPath,
  resolveKnowledgeLocation
} from '#~/components/knowledge-base/knowledge-routes'

export function KnowledgeRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = React.useMemo(
    () => resolveKnowledgeLocation(location.pathname, location.search),
    [location.pathname, location.search]
  )

  React.useEffect(() => {
    if (!route.shouldReplace) return
    void navigate({ pathname: route.pathname, search: route.search }, { replace: true })
  }, [navigate, route.pathname, route.search, route.shouldReplace])

  const navigatePreservingFilters = React.useCallback((pathname: string) => {
    const params = new URLSearchParams(location.search)
    params.delete('kbTab')
    params.delete('skillView')
    const search = params.toString()
    void navigate({ pathname, search: search === '' ? '' : `?${search}` })
  }, [location.search, navigate])

  return (
    <KnowledgeBaseView
      sectionKey={route.sectionKey}
      entityId={route.entityId}
      entityPage={route.entityPage}
      skillPage={route.skillPage}
      onBack={() => navigate(-1)}
      onNavigateSection={sectionKey => navigatePreservingFilters(getKnowledgeSectionPath(sectionKey))}
      onNavigateEntity={entityId => navigatePreservingFilters(getKnowledgeEntityPath(entityId))}
      onNavigateEntityPage={(entityId, page) => navigatePreservingFilters(getKnowledgeEntityPath(entityId, page))}
      onNavigateSkillPage={skillPage => navigatePreservingFilters(getKnowledgeSkillPath(skillPage))}
    />
  )
}
