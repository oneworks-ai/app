import { Input } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

import { InteractionPanelMobileDebugTargetGroup } from './InteractionPanelMobileDebugTargetGroup'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'

const allAppsKey = '__all__'
interface MobileDebugTargetGroup {
  appKey: string
  appLabel: string
  targets: DesktopMobileDebugTarget[]
}
const normalizeSearchText = (value: string) => value.trim().toLowerCase()
const getWebViewSocketLabel = (target: DesktopMobileDebugTarget, webViewLabel: string) => {
  const suffix = target.socketName.replace(/^webview_devtools_remote_?/u, '')
  return suffix === '' || suffix === target.socketName ? webViewLabel : `${webViewLabel} ${suffix}`
}
const getTargetAppLabel = (target: DesktopMobileDebugTarget, t: (key: string) => string) => {
  if (target.appName != null && target.appName.trim() !== '') return target.appName.trim()
  if (target.source === 'network') return target.networkAddress ?? t('chat.interactionPanel.mobileDebugNetwork')
  if (target.socketType === 'webview') {
    return getWebViewSocketLabel(target, t('chat.interactionPanel.mobileDebugWebView'))
  }
  if (target.socketType === 'chrome') return t('chat.interactionPanel.mobileDebugChrome')
  return target.socketName || t('chat.interactionPanel.mobileDebugOther')
}
const getTargetAppKey = (target: DesktopMobileDebugTarget, appLabel: string) => {
  const appName = target.appName?.trim()
  return appName != null && appName !== ''
    ? `app:${target.source}:${target.deviceId}:${appName}`
    : `${target.source}:${target.deviceId}:${target.socketType}:${
      target.networkAddress ?? target.socketName
    }:${appLabel}`
}
const buildTargetGroups = (targets: DesktopMobileDebugTarget[], t: (key: string) => string) => {
  const groupByKey = new Map<string, MobileDebugTargetGroup>()
  for (const target of targets) {
    const appLabel = getTargetAppLabel(target, t)
    const appKey = getTargetAppKey(target, appLabel)
    const group = groupByKey.get(appKey)
    if (group == null) {
      groupByKey.set(appKey, { appKey, appLabel, targets: [target] })
    } else {
      group.targets.push(target)
    }
  }
  return Array.from(groupByKey.values()).sort((left, right) => left.appLabel.localeCompare(right.appLabel))
}
const targetMatchesQuery = (target: DesktopMobileDebugTarget, appLabel: string, query: string) => (
  query === '' ||
  normalizeSearchText(
    [appLabel, target.title, target.url, target.type, target.deviceLabel, target.socketName].join(' ')
  )
    .includes(query)
)
export function InteractionPanelMobileDebugTargetList({
  onOpenDebugUrl,
  targets
}: {
  onOpenDebugUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  targets: DesktopMobileDebugTarget[]
}) {
  const { t } = useTranslation()
  const [selectedAppKey, setSelectedAppKey] = useState(allAppsKey)
  const [expandedAppKey, setExpandedAppKey] = useState<string>()
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = normalizeSearchText(searchQuery)
  const groups = useMemo(() => buildTargetGroups(targets, t), [targets, t])
  const filteredGroups = useMemo(() =>
    groups
      .filter(group => selectedAppKey === allAppsKey || group.appKey === selectedAppKey)
      .map(group => ({
        ...group,
        targets: group.targets.filter(target => targetMatchesQuery(target, group.appLabel, normalizedQuery))
      }))
      .filter(group => group.targets.length > 0), [groups, normalizedQuery, selectedAppKey])
  const filteredGroupKeySignature = filteredGroups.map(group => group.appKey).join('\n')

  useEffect(() => {
    const firstGroupKey = filteredGroups[0]?.appKey
    if (firstGroupKey == null) {
      setExpandedAppKey(undefined)
      return
    }
    if (selectedAppKey !== allAppsKey) {
      setExpandedAppKey(selectedAppKey)
      return
    }
    setExpandedAppKey(current =>
      current == null || !filteredGroups.some(group => group.appKey === current)
        ? firstGroupKey
        : current
    )
  }, [filteredGroupKeySignature, filteredGroups, selectedAppKey])

  return (
    <section className='chat-interaction-panel-mobile-debug__section'>
      <div className='chat-interaction-panel-mobile-debug__filters'>
        <Select
          size='small'
          className='chat-interaction-panel-mobile-debug__app-select'
          popupClassName='chat-interaction-panel-mobile-debug__app-select-popup'
          mobileTitle={t('chat.interactionPanel.mobileDebugAllApps')}
          value={selectedAppKey}
          options={[
            { value: allAppsKey, label: t('chat.interactionPanel.mobileDebugAllApps') },
            ...groups.map(group => ({ value: group.appKey, label: group.appLabel }))
          ]}
          suffixIcon={<span className='material-symbols-rounded'>keyboard_arrow_down</span>}
          onChange={setSelectedAppKey}
        />
        <Input
          size='small'
          allowClear
          className='chat-interaction-panel-mobile-debug__search'
          value={searchQuery}
          placeholder={t('chat.interactionPanel.mobileDebugSearchPlaceholder')}
          prefix={<span className='material-symbols-rounded' aria-hidden='true'>search</span>}
          onChange={event => setSearchQuery(event.target.value)}
        />
      </div>
      {filteredGroups.length === 0
        ? (
          <div className='chat-interaction-panel-mobile-debug__empty'>
            {t('chat.interactionPanel.mobileDebugNoMatchingTargets')}
          </div>
        )
        : (
          <div className='chat-interaction-panel-mobile-debug__target-accordion'>
            {filteredGroups.map(group => (
              <InteractionPanelMobileDebugTargetGroup
                key={group.appKey}
                group={group}
                isOpen={expandedAppKey === group.appKey}
                onOpenDebugUrl={onOpenDebugUrl}
                onToggle={() => setExpandedAppKey(current => current === group.appKey ? undefined : group.appKey)}
              />
            ))}
          </div>
        )}
    </section>
  )
}
