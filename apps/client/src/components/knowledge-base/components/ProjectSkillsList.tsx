import { Empty, List, Pagination, Spin, Tag } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { SkillSummary } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { EmptyState } from './EmptyState'
import { KnowledgeScopeTabs } from './KnowledgeScopeTabs'
import {
  PROJECT_SKILLS_PAGE_SIZE,
  filterProjectSkills,
  filterProjectSkillsByScope,
  paginateProjectSkills
} from './skill-hub-utils'
import type { ProjectSkillScope } from './skill-hub-utils'

interface ProjectSkillsListProps {
  isLoading: boolean
  importing: boolean
  query: string
  skills: SkillSummary[]
  onCreate: () => void
  onImport: (scope: Exclude<ProjectSkillScope, 'all'>) => void
  onQueryChange: (value: string) => void
}

const SKILL_SOURCE_LABEL_KEYS = {
  globalConfig: 'knowledge.skills.sourceGlobalConfig',
  projectConfig: 'knowledge.skills.sourceProjectConfig',
  userConfig: 'knowledge.skills.sourceUserConfig',
  projectDefault: 'knowledge.skills.sourceProject',
  plugin: 'knowledge.skills.sourcePlugin',
  home: 'knowledge.skills.sourceHome'
} as const

export function ProjectSkillsList({
  isLoading,
  importing,
  query,
  skills,
  onCreate,
  onImport,
  onQueryChange
}: ProjectSkillsListProps) {
  const { t } = useTranslation()
  const [scope, setScope] = React.useState<ProjectSkillScope>('all')
  const [page, setPage] = React.useState(1)

  const scopedSkills = React.useMemo(
    () => filterProjectSkillsByScope(skills, scope),
    [scope, skills]
  )
  const filteredSkills = React.useMemo(
    () => filterProjectSkills(scopedSkills, query),
    [query, scopedSkills]
  )
  const maxPage = Math.max(1, Math.ceil(filteredSkills.length / PROJECT_SKILLS_PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visibleSkills = React.useMemo(
    () => paginateProjectSkills(filteredSkills, currentPage),
    [currentPage, filteredSkills]
  )

  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [currentPage, page])

  React.useEffect(() => {
    setPage(1)
  }, [query])

  if (isLoading) {
    return (
      <div className='knowledge-base-view__loading'>
        <Spin />
      </div>
    )
  }

  return (
    <>
      <KnowledgeScopeTabs
        activeKey={scope}
        items={[
          {
            icon: 'apps',
            key: 'all',
            label: t('knowledge.skills.allScope')
          },
          {
            icon: 'folder',
            key: 'project',
            label: t('knowledge.skills.projectScope')
          },
          {
            icon: 'public',
            key: 'global',
            label: t('knowledge.skills.globalScope')
          }
        ]}
        actionItems={scope === 'all' ? [] : [{
          icon: 'download',
          key: 'knowledge-skills-import',
          label: t('knowledge.actions.import'),
          loading: importing,
          onSelect: () => onImport(scope)
        }]}
        onChange={(value) => {
          setScope(value)
          setPage(1)
        }}
      />
      <ActionSearchToolbar
        inset={false}
        placeholder={scope === 'all'
          ? t('knowledge.skills.searchAll')
          : scope === 'global'
          ? t('knowledge.skills.searchGlobal')
          : t('knowledge.skills.searchProject')}
        query={query}
        onQueryChange={(value) => {
          setPage(1)
          onQueryChange(value)
        }}
      />
      {skills.length === 0
        ? (
          <EmptyState
            description={t('knowledge.skills.empty')}
            actionLabel={t('knowledge.skills.create')}
            onAction={onCreate}
          />
        )
        : filteredSkills.length === 0
        ? (
          <div className='knowledge-base-view__empty-simple'>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={query.trim() === ''
                ? t('knowledge.skills.emptyScope')
                : t('knowledge.filters.noResults')}
            />
          </div>
        )
        : (
          <div className='knowledge-base-view__skill-results'>
            <div className='knowledge-base-view__skill-results-scroll'>
              <List
                className='knowledge-base-view__list knowledge-base-view__project-skill-list'
                dataSource={visibleSkills}
                renderItem={(skill) => (
                  <List.Item className='knowledge-base-view__list-item'>
                    <div className='knowledge-base-view__skill-result'>
                      <div className='knowledge-base-view__skill-result-main'>
                        <div className='knowledge-base-view__item-title'>
                          <span className='material-symbols-rounded knowledge-base-view__item-icon'>psychology</span>
                          <span>{skill.name}</span>
                          <Tag className='knowledge-base-view__skill-source'>
                            {skill.sourceDetail.configLabel ?? t(SKILL_SOURCE_LABEL_KEYS[skill.sourceDetail.kind])}
                          </Tag>
                        </div>
                        {skill.description.trim() !== '' && (
                          <div className='knowledge-base-view__item-desc'>{skill.description}</div>
                        )}
                        <div className='knowledge-base-view__skill-subtitle'>{skill.id}</div>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
            <div className='knowledge-base-view__skill-pagination'>
              <Pagination
                current={currentPage}
                pageSize={PROJECT_SKILLS_PAGE_SIZE}
                showSizeChanger={false}
                total={filteredSkills.length}
                onChange={setPage}
              />
            </div>
          </div>
        )}
    </>
  )
}
