import './NativePluginDetailPanel.scss'

import { Tooltip } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import type { NativeHostPlugin, NativeHostPluginAssetGroup, NativeHostPluginAssetKind } from '@oneworks/types'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { getNativeHostPluginAssets } from '#~/plugins/api'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { PluginAssetSection } from './PluginAssetSection'
import { PluginDetailView } from './PluginDetailView'

const NATIVE_DETAIL_TAB_QUERY_PARAM = 'tab'

const NativeTabLabel = ({ icon, label }: { icon: string; label: string }) => (
  <Tooltip title={label}>
    <span className='plugin-detail-route__tab-label' aria-label={label}>
      <MaterialSymbol name={icon} aria-hidden='true' />
      <span>{label}</span>
    </span>
  </Tooltip>
)

const DATA_ASSET_PRESENTATION: Array<{
  icon: string
  kind: NativeHostPluginAssetKind
  labelKey: string
}> = [
  { icon: 'psychology', kind: 'skills', labelKey: 'knowledge.tabs.skills' },
  { icon: 'terminal', kind: 'commands', labelKey: 'pluginDetail.commands' },
  { icon: 'groups', kind: 'agents', labelKey: 'pluginDetail.agents' },
  { icon: 'group_work', kind: 'entities', labelKey: 'knowledge.tabs.entities' },
  { icon: 'account_tree', kind: 'specs', labelKey: 'knowledge.tabs.flows' },
  { icon: 'gavel', kind: 'rules', labelKey: 'knowledge.tabs.rules' },
  { icon: 'code_blocks', kind: 'scripts', labelKey: 'pluginDetail.scripts' },
  { icon: 'description', kind: 'docs', labelKey: 'pluginDetail.docs' },
  { icon: 'apps', kind: 'apps', labelKey: 'pluginDetail.apps' }
]

export function NativePluginDetailPanel({
  plugin,
  pluginServerBaseUrl
}: {
  plugin: NativeHostPlugin
  pluginServerBaseUrl?: string
}) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: assetGroups = [], error, isLoading } = useSWR(
    ['native-plugin-assets', plugin.id, pluginServerBaseUrl ?? ''],
    () => getNativeHostPluginAssets(plugin.id, { serverBaseUrl: pluginServerBaseUrl })
  )
  const assetsByKind = useMemo(
    () => new Map(assetGroups.map(group => [group.kind, group])),
    [assetGroups]
  )
  const dataAssetGroups = DATA_ASSET_PRESENTATION
    .map(item => ({ ...item, group: assetsByKind.get(item.kind) }))
    .filter((item): item is typeof item & { group: NativeHostPluginAssetGroup } => item.group != null)
  const diagnostics = plugin.diagnostics ?? []
  const displayName = plugin.displayName ?? plugin.name
  const overviewPlugin = useMemo<PluginRuntimeInstance>(() => ({
    packageId: plugin.marketplace,
    requestId: plugin.adapter,
    requestedVersion: plugin.source.kind,
    rootDir: plugin.source.displayPath,
    scope: plugin.id,
    version: plugin.version
  }), [plugin])
  const items = [
    {
      key: 'readme',
      label: <NativeTabLabel icon='article' label='README' />,
      children: (
        <section className='native-plugin-detail__body'>
          <h2>{displayName}</h2>
          <p>{plugin.description ?? t('pluginStore.nativeReadOnly')}</p>
          <p className='native-plugin-detail__source'>{plugin.source.displayPath}</p>
        </section>
      )
    },
    ...(dataAssetGroups.length === 0
      ? []
      : [{
        key: 'data-assets',
        label: <NativeTabLabel icon='database' label={t('pluginDetail.dataAssets')} />,
        children: (
          <div className='plugin-detail-route__data-assets'>
            {dataAssetGroups.map(item => (
              <PluginAssetSection
                key={item.kind}
                emptyText={t('pluginDetail.assetsEmpty')}
                error={error instanceof Error ? error.message : undefined}
                group={item.group}
                icon={item.icon}
                loading={isLoading}
                showHeading
                title={t(item.labelKey)}
              />
            ))}
          </div>
        )
      }]),
    ...(['mcp', 'hooks'] as const).flatMap(kind => {
      const group = assetsByKind.get(kind)
      if (group == null) return []
      const label = t(`pluginDetail.${kind}`)
      return [{
        key: kind,
        label: <NativeTabLabel icon={kind === 'mcp' ? 'deployed_code' : 'tune'} label={label} />,
        children: (
          <PluginAssetSection
            emptyText={t('pluginDetail.assetsEmpty')}
            error={error instanceof Error ? error.message : undefined}
            group={group}
            loading={isLoading}
            title={label}
          />
        )
      }]
    }),
    {
      key: 'diagnostics',
      label: <NativeTabLabel icon='bug_report' label={t('pluginStore.diagnostics')} />,
      children: (
        <section className='native-plugin-detail__body'>
          {diagnostics.length === 0
            ? <p>{t('pluginDetail.diagnosticsEmpty')}</p>
            : diagnostics.map(item => (
              <div key={`${item.code}:${item.message}`} className={`native-plugin-detail__diagnostic is-${item.level}`}>
                <MaterialSymbol
                  name={item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'info'}
                />
                <span>{item.message}</span>
              </div>
            ))}
        </section>
      )
    }
  ]
  const requestedTab = searchParams.get(NATIVE_DETAIL_TAB_QUERY_PARAM)
  const activeTabKey = items.some(item => item.key === requestedTab) ? requestedTab! : 'readme'
  const handleTabChange = useCallback((key: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (key === 'readme') next.delete(NATIVE_DETAIL_TAB_QUERY_PARAM)
      else next.set(NATIVE_DETAIL_TAB_QUERY_PARAM, key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  return (
    <PluginDetailView
      activeTabKey={activeTabKey}
      items={items}
      onTabChange={handleTabChange}
      overviewLabels={{
        clientDevEntry: t('pluginDetail.clientDevEntry'),
        clientEntry: t('pluginDetail.clientEntry'),
        disabled: t('pluginStore.disabled'),
        overview: t('pluginDetail.overview'),
        package: t('pluginStore.marketplaceSources'),
        request: t('pluginStore.marketplaceDetailSourceType'),
        requestedVersion: t('pluginStore.marketplaceSourceType'),
        root: t('pluginDetail.root'),
        serverEntry: t('pluginDetail.serverEntry'),
        version: t('pluginDetail.version')
      }}
      overviewPlugin={overviewPlugin}
    />
  )
}
