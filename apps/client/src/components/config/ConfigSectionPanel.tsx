/* eslint-disable max-lines -- section panel keeps route sync and focus management together for now. */
import '../ConfigView.scss'

import { Button, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'

import type { ConfigSource, ConfigUiSection } from '@oneworks/types'

import { SectionForm } from './ConfigSectionForm'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import type { ModelServiceProviderPortalRequest } from './ModelServiceProviderPortalBottomPanel'
import type { ConfigDetailRoute } from './configDetail'
import {
  getConfigDetailRouteKey,
  getSectionFields,
  parseConfigDetailRoute,
  resolveConfigDetailRouteMeta,
  serializeConfigDetailRoute
} from './configDetail'
import type { FieldSpec } from './configSchema'
import type { TranslationFn } from './configUtils'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'
import { toLabel } from './record-editors/schemaRecordUtils'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getModelServiceProfile = (
  item: unknown,
  profileKey: string
): Record<string, unknown> | undefined => {
  if (!isRecord(item)) return undefined
  const profiles = item.profiles
  if (isRecord(profiles) && isRecord(profiles[profileKey])) return profiles[profileKey]
  const legacyServices = item.services
  if (isRecord(legacyServices) && isRecord(legacyServices[profileKey])) return legacyServices[profileKey]
  return undefined
}

const getModelServiceProfileLabel = (
  item: unknown,
  resolvedItem: unknown,
  profileKey: string
) => {
  const profile = getModelServiceProfile(item, profileKey) ?? getModelServiceProfile(resolvedItem, profileKey)
  const title = profile?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : toLabel(profileKey)
}

export function ConfigSectionPanel({
  sectionKey,
  title,
  icon,
  headerLeading,
  fields,
  uiSection,
  value,
  resolvedValue,
  source = 'project',
  onChange,
  mergedModelServices,
  mergedAdapters,
  selectedModelService,
  worktreeEnvironmentOptions,
  workspaceFileOpenerOptions,
  detailQuery = '',
  onDetailQueryChange,
  onOpenModelServicePortal,
  creatingModelServiceSessionKey,
  onCreateModelServiceSession,
  headerExtra,
  showHeader = true,
  t,
  className
}: {
  sectionKey: string
  title?: ReactNode
  icon?: ReactNode
  headerLeading?: ReactNode
  fields?: FieldSpec[]
  uiSection?: ConfigUiSection
  value: unknown
  resolvedValue?: unknown
  source?: ConfigSource
  onChange: (nextValue: unknown) => void
  mergedModelServices: Record<string, unknown>
  mergedAdapters: Record<string, unknown>
  selectedModelService?: string
  worktreeEnvironmentOptions?: Array<{ value: string; label: ReactNode }>
  workspaceFileOpenerOptions?: Array<{ value: string; label: ReactNode }>
  detailQuery?: string
  onDetailQueryChange?: (nextQuery: string) => void
  onOpenModelServicePortal?: (request: ModelServiceProviderPortalRequest) => void
  creatingModelServiceSessionKey?: string | null
  onCreateModelServiceSession?: (request: ModelServiceConfigSessionRequest) => void | Promise<void>
  headerExtra?: ReactNode
  showHeader?: boolean
  t: TranslationFn
  className?: string
}) {
  const hasHeading = title != null || icon != null
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollPositionsRef = useRef<Record<string, number>>({})
  const resolvedFields = getSectionFields(sectionKey, fields)
  const detailRoute = parseConfigDetailRoute({
    fields: resolvedFields,
    raw: detailQuery
  })
  const detailMeta = resolveConfigDetailRouteMeta({
    sectionKey,
    fields: resolvedFields,
    value,
    resolvedValue,
    route: detailRoute,
    detailContext: {
      mergedModelServices,
      mergedAdapters,
      t
    },
    t
  })
  const currentViewKey = getConfigDetailRouteKey(detailRoute)

  const storeCurrentScroll = () => {
    const node = scrollRef.current
    if (node == null) return
    scrollPositionsRef.current[currentViewKey] = node.scrollTop
  }

  const handleOpenDetail = (nextRoute: ConfigDetailRoute) => {
    storeCurrentScroll()
    onDetailQueryChange?.(serializeConfigDetailRoute(nextRoute))
  }

  const handleCloseDetail = () => {
    storeCurrentScroll()
    if (detailRoute?.nestedPath?.[0] === 'profiles' && detailRoute.nestedPath.length === 1) {
      onDetailQueryChange?.(serializeConfigDetailRoute({
        ...detailRoute,
        nestedPath: []
      }))
      return
    }
    if ((detailRoute?.nestedPath?.length ?? 0) > 0 && detailRoute != null) {
      onDetailQueryChange?.(serializeConfigDetailRoute({
        ...detailRoute,
        nestedPath: detailRoute.nestedPath?.slice(0, -1) ?? []
      }))
      return
    }
    onDetailQueryChange?.('')
  }

  const rawNestedSegments = detailRoute?.nestedPath ?? []
  const nestedSegments = rawNestedSegments.length === 1 && rawNestedSegments[0] === 'profiles'
    ? []
    : rawNestedSegments
  const nestedBreadcrumbs = nestedSegments.map((segment, index) => {
    const label = index === 0 && segment === 'accounts'
      ? t('config.accounts.title')
      : index === 0 && segment === 'profiles'
      ? t('config.sectionGroups.profiles')
      : index === 1 && nestedSegments[0] === 'profiles' && sectionKey === 'modelServices' && detailMeta != null
      ? getModelServiceProfileLabel(detailMeta.item, detailMeta.resolvedItem, segment)
      : toLabel(segment)
    const isCurrent = index === nestedSegments.length - 1
    return {
      key: `${segment}:${index}`,
      label,
      isCurrent,
      onClick: isCurrent
        ? undefined
        : () => {
          if (detailRoute == null) return
          storeCurrentScroll()
          onDetailQueryChange?.(serializeConfigDetailRoute({
            ...detailRoute,
            nestedPath: nestedSegments.slice(0, index + 1)
          }))
        }
    }
  })
  const breadcrumbItems = (() => {
    if (detailMeta == null) return []

    const items: Array<{ key: string; label: ReactNode; isCurrent?: boolean; onClick?: () => void }> = [
      {
        key: 'section',
        label: title
      },
      {
        key: 'item',
        label: detailMeta.itemLabel,
        isCurrent: nestedBreadcrumbs.length === 0,
        ...(nestedBreadcrumbs.length > 0
          ? {
            onClick: () => {
              storeCurrentScroll()
              onDetailQueryChange?.(serializeConfigDetailRoute({
                ...detailRoute!,
                nestedPath: []
              }))
            }
          }
          : {})
      }
    ]

    return [...items, ...nestedBreadcrumbs]
  })()

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (node == null) return
    node.scrollTop = scrollPositionsRef.current[currentViewKey] ?? 0
  }, [currentViewKey])

  const headerContent = hasHeading
    ? detailMeta == null
      ? undefined
      : (
        <div className='config-view__detail-trail'>
          {headerLeading}
          <Tooltip title={t('config.detail.back')}>
            <Button
              size='small'
              type='text'
              className='config-view__detail-back'
              aria-label={t('config.detail.back')}
              icon={<span className='material-symbols-rounded'>chevron_left</span>}
              onClick={handleCloseDetail}
            />
          </Tooltip>
          <div className='config-view__detail-breadcrumb'>
            {breadcrumbItems.map((item, index) => (
              <span key={item.key} className='config-view__detail-breadcrumb-item'>
                {index > 0 && (
                  <span className='config-view__detail-separator' aria-hidden='true'>
                    <span className='material-symbols-rounded'>chevron_right</span>
                  </span>
                )}
                <span
                  className={`config-view__detail-crumb ${
                    item.isCurrent === true
                      ? 'config-view__detail-crumb--current'
                      : 'config-view__detail-crumb--static'
                  }`}
                >
                  {item.label}
                </span>
              </span>
            ))}
          </div>
        </div>
      )
    : null

  return (
    <ConfigSectionFrame
      ref={scrollRef}
      className={className}
      headerContent={showHeader ? headerContent : undefined}
      headerExtra={showHeader ? headerExtra : undefined}
      headerLeading={showHeader && headerContent == null ? headerLeading : undefined}
      icon={showHeader && headerContent == null ? icon : undefined}
      title={showHeader && headerContent == null ? title : undefined}
    >
      <SectionForm
        sectionKey={sectionKey}
        fields={resolvedFields}
        uiSection={uiSection}
        value={value}
        resolvedValue={resolvedValue}
        source={source}
        onChange={onChange}
        mergedModelServices={mergedModelServices}
        mergedAdapters={mergedAdapters}
        selectedModelService={selectedModelService}
        worktreeEnvironmentOptions={worktreeEnvironmentOptions}
        workspaceFileOpenerOptions={workspaceFileOpenerOptions}
        detailRoute={detailRoute}
        onOpenDetailRoute={handleOpenDetail}
        onOpenModelServicePortal={onOpenModelServicePortal}
        creatingModelServiceSessionKey={creatingModelServiceSessionKey}
        onCreateModelServiceSession={onCreateModelServiceSession}
        t={t}
      />
    </ConfigSectionFrame>
  )
}
