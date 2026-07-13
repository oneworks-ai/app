/* eslint-disable max-lines -- plugin detail sections keep contribution formatting and overview facts together. */

import { Button, Collapse, Input, Switch, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { PluginContributionManifest, PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

type ContributionKey = keyof PluginContributionManifest
type ContributionStatusFilter = 'all' | 'disabled' | 'enabled'
type DetailRecord = Record<string, unknown>

export interface PluginDetailRow {
  disabled?: boolean
  icon: string
  id: string
  items: PluginDetailItem[]
  title: string
}

export interface PluginDetailItem {
  disabled?: boolean
  id: string
  value: unknown
}

interface PluginFactProps {
  icon: string
  label: string
  value?: string
}
interface PluginRowsProps {
  disabledText?: string
  disableItemText?: string
  disableText?: string
  emptyText: string
  enableItemText?: string
  enableText?: string
  fieldLabels: Record<string, string>
  itemDisabledText?: string
  language: string
  noMatchesText: string
  noDescriptionText: string
  onItemEnabledChange?: (itemId: string, enabled: boolean) => void
  onRowEnabledChange?: (rowId: string, enabled: boolean) => void
  rows: PluginDetailRow[]
  searchPlaceholder: string
  showTitle?: boolean
  title: string
}

type PluginOverviewLabelKey =
  | 'clientDevEntry'
  | 'clientEntry'
  | 'disabled'
  | 'overview'
  | 'package'
  | 'request'
  | 'requestedVersion'
  | 'root'
  | 'serverEntry'
  | 'version'

export type PluginOverviewLabels = Record<PluginOverviewLabelKey, string>

export const pluginContributionGroups: Array<{
  icon: string
  key: ContributionKey
  labelKey: string
}> = [
  { icon: 'extension', key: 'extensionPoints', labelKey: 'pluginDetail.groups.extensionPoints' },
  {
    icon: 'add_link',
    key: 'extensionContributions',
    labelKey: 'pluginDetail.groups.extensionContributions'
  },
  { icon: 'dock_to_left', key: 'navItems', labelKey: 'pluginDetail.groups.navItems' },
  { icon: 'more_horiz', key: 'navMoreMenu', labelKey: 'pluginDetail.groups.navMoreMenu' },
  { icon: 'vertical_align_top', key: 'navFooterBefore', labelKey: 'pluginDetail.groups.navFooterBefore' },
  { icon: 'add_comment', key: 'chatHeaderActions', labelKey: 'pluginDetail.groups.chatHeaderActions' },
  { icon: 'more_vert', key: 'chatHeaderMoreMenu', labelKey: 'pluginDetail.groups.chatHeaderMoreMenu' },
  {
    icon: 'dashboard_customize',
    key: 'chatInteractionPanelEmptyActions',
    labelKey: 'pluginDetail.groups.chatInteractionPanelEmptyActions'
  },
  { icon: 'web_asset', key: 'routeHeaderActions', labelKey: 'pluginDetail.groups.routeHeaderActions' },
  { icon: 'more_vert', key: 'routeMoreMenuItems', labelKey: 'pluginDetail.groups.routeMoreMenuItems' },
  { icon: 'left_click', key: 'routeSidebarContextMenu', labelKey: 'pluginDetail.groups.routeSidebarContextMenu' },
  { icon: 'dock_to_left', key: 'routeWindowBarActions', labelKey: 'pluginDetail.groups.routeWindowBarActions' },
  { icon: 'add_box', key: 'workbenchAddMenu', labelKey: 'pluginDetail.groups.workbenchAddMenu' },
  { icon: 'tab', key: 'workbenchTabs', labelKey: 'pluginDetail.groups.workbenchTabs' },
  { icon: 'view_sidebar', key: 'workspaceDrawerTabs', labelKey: 'pluginDetail.groups.workspaceDrawerTabs' },
  { icon: 'manage_search', key: 'launcherSearchProviders', labelKey: 'pluginDetail.groups.launcherSearchProviders' },
  { icon: 'route', key: 'routes', labelKey: 'pluginDetail.groups.routes' }
]

const detailFields = [
  'id',
  'title',
  'targetRoute',
  'targetRoutes',
  'route',
  'routeId',
  'command',
  'mode',
  'target',
  'proxyTarget',
  'extensionPoint',
  'contributionSchema',
  'href',
  'active',
  'activeLabel',
  'activeTitle',
  'danger',
  'disabled',
  'selected',
  'tab',
  'clientView',
  'viewId',
  'placement',
  'icon',
  'activeIcon',
  'shortcut',
  'inputSchema',
  'outputSchema',
  'headerSchema'
]

const detailFieldIcons: Record<string, string> = {
  active: 'radio_button_checked',
  activeLabel: 'label',
  activeTitle: 'tooltip',
  clientView: 'language',
  command: 'terminal',
  contributionSchema: 'schema',
  danger: 'warning',
  disabled: 'toggle_off',
  extensionPoint: 'extension',
  headerSchema: 'fact_check',
  href: 'open_in_new',
  id: 'fingerprint',
  inputSchema: 'input',
  mode: 'route',
  outputSchema: 'output',
  icon: 'symbol',
  placement: 'dock_to_right',
  proxyTarget: 'hub',
  route: 'link',
  routeId: 'link',
  shortcut: 'keyboard',
  selected: 'check_circle',
  tab: 'layers',
  target: 'api',
  targetRoute: 'filter_alt',
  targetRoutes: 'filter_alt',
  title: 'sell',
  viewId: 'language'
}

const contributionStatusFilterOptions: ContributionStatusFilter[] = ['all', 'enabled', 'disabled']
const contributionStatusFilterIcons: Record<ContributionStatusFilter, string> = {
  all: 'filter_list',
  disabled: 'toggle_off',
  enabled: 'toggle_on'
}

export const getPluginContributions = (plugin: PluginRuntimeInstance): PluginContributionManifest => {
  const contributions = plugin.plugin?.contributions ?? plugin.contributions ??
    plugin.manifest?.plugin?.contributions ?? {}
  if (contributions.routeMoreMenuItems != null || contributions.routeMoreMenu == null) return contributions
  return {
    ...contributions,
    routeMoreMenuItems: contributions.routeMoreMenu
  }
}

const formatDetailValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const values = value
      .map(item => formatDetailValue(item))
      .filter((item): item is string => item != null && item !== '')
    return values.length === 0 ? undefined : values.join(', ')
  }
  if (value != null && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return undefined
}

const normalizeLanguage = (value: string | undefined) => value?.replace(/_/g, '-').toLowerCase()

const getLanguageCandidates = (language: string) => {
  const normalized = normalizeLanguage(language)
  const base = normalized?.split('-')[0]
  return [normalized, base, 'en'].filter((item, index, list): item is string =>
    item != null && list.indexOf(item) === index
  )
}

const resolveLocalizedText = (
  value: unknown,
  language: string,
  options: { allowAnyFallback?: boolean } = {}
): string | undefined => {
  const direct = formatDetailValue(value)
  if (direct != null) return direct
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => [normalizeLanguage(key), formatDetailValue(entryValue)] as const)
    .filter((entry): entry is readonly [string, string] => entry[0] != null && entry[1] != null)
  if (entries.length === 0) return undefined

  const candidates = getLanguageCandidates(language)
  for (const candidate of candidates) {
    const exact = entries.find(([key]) => key === candidate)
    if (exact != null) return exact[1]

    const base = entries.find(([key]) => key.split('-')[0] === candidate)
    if (base != null) return base[1]
  }
  return options.allowAnyFallback === false ? undefined : entries[0][1]
}

const resolveI18nField = (record: DetailRecord, field: string, language: string) => {
  const suffixed = resolveLocalizedText(record[`${field}I18n`], language, { allowAnyFallback: false })
  if (suffixed != null) return suffixed

  const i18n = record.i18n
  if (i18n != null && typeof i18n === 'object' && !Array.isArray(i18n)) {
    const localized = resolveLocalizedText(
      Object.fromEntries(
        Object.entries(i18n as Record<string, unknown>).map(([key, value]) => [
          key,
          value != null && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)[field]
            : undefined
        ])
      ),
      language,
      { allowAnyFallback: false }
    )
    if (localized != null) return localized
  }

  return resolveLocalizedText(record[field], language)
}

const buildTooltipTitle = (label: string, value?: string) => `${label}: ${value ?? '-'}`

const toDetailRecord = (item: unknown, fallbackId: string): DetailRecord => (
  item != null && typeof item === 'object' && !Array.isArray(item)
    ? item as DetailRecord
    : { id: fallbackId, value: item }
)

const resolveContributionDescription = (
  record: DetailRecord,
  language: string,
  noDescriptionText: string
) => {
  const description = resolveI18nField(record, 'description', language)
  if (description != null) return description
  return noDescriptionText
}

const normalizeSearchText = (value: string) => value.trim().toLocaleLowerCase()

const getContributionItemSearchText = (
  item: PluginDetailItem,
  language: string,
  fieldLabels: Record<string, string>
) => {
  const record = toDetailRecord(item.value, item.id)
  return [
    item.id,
    resolveI18nField(record, 'title', language),
    resolveI18nField(record, 'description', language),
    ...detailFields.flatMap(field => [
      field,
      fieldLabels[field],
      resolveLocalizedText(record[field], language)
    ])
  ]
    .filter((value): value is string => value != null && value !== '')
    .join(' ')
    .toLocaleLowerCase()
}

const filterContributionItemsByStatus = (
  row: PluginDetailRow,
  items: PluginDetailItem[],
  statusFilter: ContributionStatusFilter
) => {
  switch (statusFilter) {
    case 'disabled':
      return row.disabled === true ? items : items.filter(item => item.disabled === true)
    case 'enabled':
      return row.disabled === true ? [] : items.filter(item => item.disabled !== true)
    case 'all':
      return items
  }
}

const renderContributionItem = ({
  disableItemText,
  enableItemText,
  fieldLabels,
  item,
  itemDisabledText,
  language,
  noDescriptionText,
  onItemEnabledChange
}: {
  disableItemText?: string
  enableItemText?: string
  fieldLabels: Record<string, string>
  item: PluginDetailItem
  itemDisabledText?: string
  language: string
  noDescriptionText: string
  onItemEnabledChange?: (itemId: string, enabled: boolean) => void
}) => {
  const record = toDetailRecord(item.value, item.id)
  const title = resolveI18nField(record, 'title', language) ?? resolveI18nField(record, 'id', language) ?? item.id
  const description = item.disabled === true
    ? itemDisabledText ?? noDescriptionText
    : resolveContributionDescription(record, language, noDescriptionText)
  const tags = detailFields
    .filter(field => field !== 'title')
    .map(field => [field, resolveLocalizedText(record[field], language)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] != null)

  return (
    <div
      key={item.id}
      className={`plugin-detail-route__contribution-item${item.disabled === true ? ' is-disabled' : ''}`}
    >
      <div className='plugin-detail-route__contribution-main'>
        <div className='plugin-detail-route__contribution-title-row'>
          <div className='plugin-detail-route__contribution-title-main'>
            <div className='plugin-detail-route__contribution-title'>{title}</div>
            <p className='plugin-detail-route__contribution-description'>{description}</p>
          </div>
          {onItemEnabledChange != null && (
            <Tooltip title={item.disabled === true ? enableItemText : disableItemText}>
              <span className='plugin-detail-route__contribution-item-toggle'>
                <Switch
                  aria-label={item.disabled === true ? enableItemText : disableItemText}
                  checked={item.disabled !== true}
                  size='small'
                  onChange={(checked) => onItemEnabledChange(item.id, checked)}
                  onClick={(checked, event) => event.stopPropagation()}
                />
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      {tags.length > 0 && (
        <div className='plugin-detail-route__contribution-tags'>
          {tags.map(([field, value]) => (
            <Tooltip key={`${field}:${value}`} title={buildTooltipTitle(fieldLabels[field] ?? field, value)}>
              <span
                className='plugin-detail-route__contribution-tag'
                aria-label={buildTooltipTitle(fieldLabels[field] ?? field, value)}
              >
                <MaterialSymbol name={detailFieldIcons[field] ?? 'info'} aria-hidden='true' />
                <span>{fieldLabels[field] ?? field}</span>
                <strong>{value}</strong>
              </span>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

export function PluginFact({ icon, label, value }: PluginFactProps) {
  const ariaLabel = buildTooltipTitle(label, value)
  const displayValue = value == null || value === '' ? '-' : value

  return (
    <div
      className={`plugin-detail-route__fact ${value == null || value === '' ? 'is-empty' : 'is-set'}`}
      aria-label={ariaLabel}
    >
      <span className='plugin-detail-route__fact-icon'>
        <MaterialSymbol name={icon} aria-hidden='true' />
      </span>
      <span className='plugin-detail-route__fact-main'>
        <span className='plugin-detail-route__fact-label'>{label}</span>
        <span className='plugin-detail-route__fact-value'>{displayValue}</span>
      </span>
    </div>
  )
}

export function PluginOverview({
  labels,
  plugin
}: {
  labels: PluginOverviewLabels
  plugin: PluginRuntimeInstance
}) {
  return (
    <section className='plugin-detail-route__overview'>
      <div className='plugin-detail-route__facts'>
        <PluginFact icon='deployed_code' label={labels.version} value={plugin.version} />
        <PluginFact icon='download' label={labels.requestedVersion} value={plugin.requestedVersion} />
        <PluginFact icon='layers' label={labels.package} value={plugin.packageId} />
        <PluginFact icon='link' label={labels.request} value={plugin.requestId} />
        <PluginFact icon='folder_open' label={labels.root} value={plugin.pluginRoot ?? plugin.rootDir} />
        <PluginFact icon='language' label={labels.clientEntry} value={plugin.clientEntryUrl ?? plugin.client?.entry} />
        <PluginFact
          icon='tune'
          label={labels.clientDevEntry}
          value={plugin.devClientEntryUrl ?? plugin.client?.devServer}
        />
        <PluginFact icon='terminal' label={labels.serverEntry} value={plugin.manifest?.plugin?.server?.entry} />
      </div>
    </section>
  )
}

export function PluginRows({
  disableText,
  disabledText,
  disableItemText,
  emptyText,
  enableItemText,
  enableText,
  fieldLabels,
  itemDisabledText,
  language,
  noMatchesText,
  noDescriptionText,
  onItemEnabledChange,
  onRowEnabledChange,
  rows,
  searchPlaceholder,
  showTitle = true,
  title
}: PluginRowsProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ContributionStatusFilter>('all')
  const normalizedSearch = normalizeSearchText(search)
  const filteredRows = useMemo(() => {
    return rows
      .map((row) => {
        const rowMatches = `${row.id} ${row.title}`.toLocaleLowerCase().includes(normalizedSearch)
        const searchedItems = normalizedSearch === '' || rowMatches
          ? row.items
          : row.items.filter(item =>
            getContributionItemSearchText(item, language, fieldLabels).includes(normalizedSearch)
          )
        const items = filterContributionItemsByStatus(row, searchedItems, statusFilter)
        return {
          ...row,
          items
        }
      })
      .filter(row => row.items.length > 0)
  }, [fieldLabels, language, normalizedSearch, rows, statusFilter])
  const defaultActiveKey = filteredRows.find(row => row.disabled !== true)?.id ?? filteredRows[0]?.id
  const emptyTextToShow = rows.length === 0 ? emptyText : noMatchesText

  return (
    <section className={`plugin-detail-route__section${showTitle ? '' : ' plugin-detail-route__section--flush-top'}`}>
      {showTitle && (
        <div className='plugin-detail-route__title-row'>
          <div className='plugin-detail-route__title-main'>
            <MaterialSymbol name='extension' />
            <h2>{title}</h2>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className='plugin-detail-route__section-toolbar'>
            <Input
              allowClear
              className='plugin-detail-route__search-input'
              placeholder={searchPlaceholder}
              prefix={<MaterialSymbol name='search' aria-hidden='true' />}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <div className='plugin-detail-route__section-toolbar-actions'>
              <Tooltip title={t('pluginDetail.filter')}>
                <Button
                  className={`plugin-detail-route__section-toolbar-button${filterExpanded ? ' is-active' : ''}`}
                  type='text'
                  aria-label={t('pluginDetail.filter')}
                  aria-pressed={filterExpanded}
                  icon={<MaterialSymbol name='filter_alt' aria-hidden='true' />}
                  onClick={() => setFilterExpanded(current => !current)}
                />
              </Tooltip>
            </div>
          </div>
          {filterExpanded && (
            <div className='plugin-detail-route__filter-panel'>
              <div className='plugin-detail-route__filter-row'>
                <span className='plugin-detail-route__filter-label'>
                  <MaterialSymbol name='toggle_on' aria-hidden='true' />
                  <span>{t('pluginDetail.filterStatus')}</span>
                </span>
                <div className='plugin-detail-route__filter-options'>
                  {contributionStatusFilterOptions.map(option => (
                    <Button
                      key={option}
                      className={`plugin-detail-route__filter-option${statusFilter === option ? ' is-active' : ''}`}
                      type='text'
                      size='small'
                      icon={<MaterialSymbol name={contributionStatusFilterIcons[option]} aria-hidden='true' />}
                      onClick={() => setStatusFilter(option)}
                    >
                      {t(`pluginDetail.filterStatus_${option}`)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {filteredRows.length === 0
        ? <p className='plugin-detail-route__empty'>{emptyTextToShow}</p>
        : (
          <Collapse
            accordion
            bordered={false}
            className='plugin-detail-route__contribution-accordion'
            defaultActiveKey={defaultActiveKey}
            key={`${normalizedSearch}:${statusFilter}`}
            items={filteredRows.map(row => ({
              children: row.disabled === true
                ? (
                  <p className='plugin-detail-route__contribution-disabled'>
                    <MaterialSymbol name='extension_off' aria-hidden='true' />
                    <span>{disabledText}</span>
                  </p>
                )
                : (
                  <div className='plugin-detail-route__contribution-list'>
                    {row.items.map(item =>
                      renderContributionItem({
                        disableItemText,
                        enableItemText,
                        fieldLabels,
                        item,
                        itemDisabledText,
                        language,
                        noDescriptionText,
                        onItemEnabledChange
                      })
                    )}
                  </div>
                ),
              className: `plugin-detail-route__contribution-group${row.disabled === true ? ' is-disabled' : ''}`,
              key: row.id,
              label: (
                <div className='plugin-detail-route__contribution-group-title'>
                  <span className='plugin-detail-route__contribution-group-main'>
                    <span className='plugin-detail-route__contribution-group-icon'>
                      <MaterialSymbol name={row.icon} aria-hidden='true' />
                    </span>
                    <span className='plugin-detail-route__contribution-group-label'>{row.title}</span>
                  </span>
                  {onRowEnabledChange != null && (
                    <Tooltip title={row.disabled === true ? enableText : disableText}>
                      <span
                        className='plugin-detail-route__contribution-group-toggle'
                        onClick={event => event.stopPropagation()}
                      >
                        <Switch
                          aria-label={row.disabled === true ? enableText : disableText}
                          checked={row.disabled !== true}
                          size='small'
                          onChange={(checked) => onRowEnabledChange(row.id, checked)}
                        />
                      </span>
                    </Tooltip>
                  )}
                </div>
              )
            }))}
          />
        )}
    </section>
  )
}
