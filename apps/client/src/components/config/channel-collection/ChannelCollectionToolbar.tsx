import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'

import type { TranslationFn } from '../configUtils'

import type { ChannelCollectionFilter } from './channel-collection-model'

export const ChannelCollectionToolbar = ({
  addDisabled,
  filter,
  onAdd,
  onFilterChange,
  onQueryChange,
  query,
  t
}: {
  addDisabled: boolean
  filter: ChannelCollectionFilter
  onAdd: () => void
  onFilterChange: (filter: Exclude<ChannelCollectionFilter, 'all'>) => void
  onQueryChange: (query: string) => void
  query: string
  t: TranslationFn
}) => (
  <ActionSearchToolbar
    className='channel-collection__toolbar'
    placeholder={t('config.channels.searchPlaceholder')}
    query={query}
    onQueryChange={onQueryChange}
    actions={[
      {
        active: filter === 'configured',
        ariaLabel: t('config.channels.filters.configured'),
        icon: 'check_circle',
        key: 'configured',
        pressed: filter === 'configured',
        title: t('config.channels.filters.configured'),
        onClick: () => onFilterChange('configured')
      },
      {
        active: filter === 'unconfigured',
        ariaLabel: t('config.channels.filters.unconfigured'),
        icon: 'pending',
        key: 'unconfigured',
        pressed: filter === 'unconfigured',
        title: t('config.channels.filters.unconfigured'),
        onClick: () => onFilterChange('unconfigured')
      },
      {
        ariaLabel: t('config.channels.add'),
        disabled: addDisabled,
        icon: 'add',
        key: 'add',
        title: t('config.channels.add'),
        onClick: onAdd
      }
    ]}
  />
)
