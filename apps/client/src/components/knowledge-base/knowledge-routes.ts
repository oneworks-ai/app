export type KnowledgeSectionKey = 'skills' | 'entities' | 'flows' | 'rules'
export type KnowledgeSkillPage = 'project' | 'store' | 'settings'

export interface KnowledgeLocationState {
  pathname: string
  search: string
  sectionKey: KnowledgeSectionKey
  skillPage: KnowledgeSkillPage
  shouldReplace: boolean
}

export const KNOWLEDGE_PATHS = {
  entities: '/knowledge/entities',
  flows: '/knowledge/flows',
  rules: '/knowledge/rules',
  skillsProject: '/knowledge/skills/project',
  skillsSettings: '/knowledge/skills/settings',
  skillsStore: '/knowledge/skills/store'
} as const

const SECTION_PATHS: Record<Exclude<KnowledgeSectionKey, 'skills'>, string> = {
  entities: KNOWLEDGE_PATHS.entities,
  flows: KNOWLEDGE_PATHS.flows,
  rules: KNOWLEDGE_PATHS.rules
}

export const getKnowledgeSectionPath = (sectionKey: KnowledgeSectionKey) => (
  sectionKey === 'skills' ? KNOWLEDGE_PATHS.skillsProject : SECTION_PATHS[sectionKey]
)

export const getKnowledgeSkillPath = (skillPage: KnowledgeSkillPage) => {
  switch (skillPage) {
    case 'project':
      return KNOWLEDGE_PATHS.skillsProject
    case 'store':
      return KNOWLEDGE_PATHS.skillsStore
    case 'settings':
      return KNOWLEDGE_PATHS.skillsSettings
  }
}

const normalizePathname = (pathname: string) => {
  if (pathname === '') return '/'
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

const stripLegacyPageParams = (search: string) => {
  const params = new URLSearchParams(search)
  params.delete('kbTab')
  params.delete('skillView')
  const value = params.toString()
  return value === '' ? '' : `?${value}`
}

const resolveLegacyPath = (search: string) => {
  const params = new URLSearchParams(search)
  const section = params.get('kbTab')

  if (section === 'entities' || section === 'flows' || section === 'rules') {
    return getKnowledgeSectionPath(section)
  }

  return params.get('skillView') === 'market'
    ? KNOWLEDGE_PATHS.skillsStore
    : KNOWLEDGE_PATHS.skillsProject
}

export const resolveKnowledgeLocation = (pathname: string, search: string): KnowledgeLocationState => {
  const normalizedPathname = normalizePathname(pathname)
  const nextSearch = stripLegacyPageParams(search)
  let nextPathname = normalizedPathname
  let sectionKey: KnowledgeSectionKey = 'skills'
  let skillPage: KnowledgeSkillPage = 'project'

  switch (normalizedPathname) {
    case '/knowledge':
    case '/knowledge/skills':
      nextPathname = resolveLegacyPath(search)
      break
    case KNOWLEDGE_PATHS.skillsProject:
      break
    case KNOWLEDGE_PATHS.skillsStore:
      skillPage = 'store'
      break
    case KNOWLEDGE_PATHS.skillsSettings:
      skillPage = 'settings'
      break
    case KNOWLEDGE_PATHS.entities:
      sectionKey = 'entities'
      break
    case KNOWLEDGE_PATHS.flows:
      sectionKey = 'flows'
      break
    case KNOWLEDGE_PATHS.rules:
      sectionKey = 'rules'
      break
    default:
      nextPathname = KNOWLEDGE_PATHS.skillsProject
      break
  }

  if (nextPathname === KNOWLEDGE_PATHS.skillsStore) skillPage = 'store'
  if (nextPathname === KNOWLEDGE_PATHS.skillsSettings) skillPage = 'settings'
  if (nextPathname === KNOWLEDGE_PATHS.entities) sectionKey = 'entities'
  if (nextPathname === KNOWLEDGE_PATHS.flows) sectionKey = 'flows'
  if (nextPathname === KNOWLEDGE_PATHS.rules) sectionKey = 'rules'

  return {
    pathname: nextPathname,
    search: nextSearch,
    sectionKey,
    skillPage,
    shouldReplace: nextPathname !== normalizedPathname || nextSearch !== search
  }
}
