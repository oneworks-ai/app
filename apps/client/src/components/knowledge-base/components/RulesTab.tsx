import './RulesTab.scss'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuleSummary } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { KnowledgeScopeTabs } from './KnowledgeScopeTabs'
import { RuleList } from './RuleList'
import { SectionHeader } from './SectionHeader'
import { TabContent } from './TabContent'
import { useKnowledgeAssetList } from './use-knowledge-asset-list'

interface RulesTabProps {
  rules: RuleSummary[]
  filteredRules: RuleSummary[]
  isLoading: boolean
  leading?: ReactNode
  query: string
  onQueryChange: (value: string) => void
  onCreate: () => void
  onImport: () => void
}

export function RulesTab({
  rules,
  filteredRules,
  isLoading,
  leading,
  query,
  onQueryChange,
  onCreate,
  onImport
}: RulesTabProps) {
  const { t } = useTranslation()
  const {
    changeScope,
    currentPage,
    pageResetKey,
    scope,
    scopedItems,
    setPage,
    total,
    visibleItems
  } = useKnowledgeAssetList(rules, filteredRules, query)

  return (
    <TabContent className='knowledge-base-view__rules-tab'>
      <SectionHeader leading={scope === 'project' ? leading : undefined} />
      <KnowledgeScopeTabs
        activeKey={scope}
        items={[
          { icon: 'folder', key: 'project', label: t('knowledge.scopes.project') },
          { icon: 'extension', key: 'plugin', label: t('knowledge.scopes.plugin') }
        ]}
        actionItems={scope === 'project'
          ? [{
            icon: 'download',
            key: 'knowledge-rules-import',
            label: t('knowledge.actions.import'),
            onSelect: onImport
          }]
          : []}
        onChange={changeScope}
      />
      <ActionSearchToolbar
        inset={false}
        query={query}
        placeholder={t('knowledge.filters.search')}
        onQueryChange={onQueryChange}
      />
      <RuleList
        currentPage={currentPage}
        isLoading={isLoading}
        rules={scopedItems}
        filteredRules={visibleItems}
        resetKey={pageResetKey}
        total={total}
        onCreate={scope === 'project' ? onCreate : undefined}
        onPageChange={setPage}
      />
    </TabContent>
  )
}
