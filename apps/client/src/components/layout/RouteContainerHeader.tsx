import './RouteContainerHeader.scss'
import '@oneworks/components/route-layout.css'

import { RouteHeaderActionButton } from '@oneworks/components/route-layout'
import { useAtomValue } from 'jotai'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { emitDesktopViewShortcut, getDesktopViewShortcut } from '#~/desktop/view-shortcuts'
import { useBrowserHistoryNavigationState } from '#~/hooks/use-browser-history-navigation-state'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { isSidebarCollapsedAtom, isSidebarResizingAtom } from '#~/store/index'

/**
 * Structured action rendered in the route header chrome.
 *
 * Prefer `actionItems` over the raw `actions` slot when an action can be
 * described as icon + label + state + callback. The header owns visual sizing,
 * hover/focus behavior, tooltip wiring, and active/inactive icon switching; the
 * route/plugin layer owns which actions exist and when they are active.
 */
export interface RouteContainerHeaderActionItem {
  /** Default icon asset. SVG/image/material assets all use the shared chrome size. */
  icon: IconAsset
  /** Stable action key used by React and route-owned action registries. */
  key: string
  /** Accessible label and fallback tooltip text. */
  label: string
  /** Whether this action is currently active/pressed. */
  active?: boolean
  /** Optional icon shown when `active` is true. */
  activeIcon?: IconAsset
  /** Optional accessible label shown when `active` is true. */
  activeLabel?: string
  /** Optional tooltip shown when `active` is true. */
  activeTitle?: string
  danger?: boolean
  disabled?: boolean
  /** Optional in-flight state for route-owned commands such as save/confirm. */
  loading?: boolean
  /** Shortcut text displayed by the shared action tooltip; execution still belongs to the caller. */
  shortcut?: string
  /** Tooltip title override for the inactive state. */
  title?: string
  /** Route-owned command handler. The header does not infer business behavior. */
  onSelect?: () => void
}

export function RouteContainerHeaderActionButton({
  item
}: {
  item: RouteContainerHeaderActionItem
}) {
  const isMac = navigator.platform.includes('Mac')
  const isActive = item.active === true
  const resolvedIcon = isActive && item.activeIcon != null ? item.activeIcon : item.icon
  const resolvedLabel = isActive ? item.activeLabel ?? item.label : item.label
  const resolvedTitle = isActive
    ? item.activeTitle ?? item.activeLabel ?? item.title ?? item.label
    : item.title ?? item.label

  return (
    <RouteHeaderActionButton
      isMac={isMac}
      shortcut={item.shortcut}
      tooltipTitle={resolvedTitle}
      tooltipEnabled={resolvedTitle != null}
      active={isActive}
      danger={item.danger}
      disabled={item.disabled}
      loading={item.loading}
      label={resolvedLabel}
      pressed={item.active == null ? undefined : isActive}
      onClick={item.onSelect}
      icon={renderIconAsset({
        active: isActive,
        className: 'route-container-header__action-icon',
        icon: resolvedIcon,
        materialFilled: false
      })}
    />
  )
}

/**
 * Breadcrumb mode configuration for a secondary/detail route header.
 *
 * Use this when a selected list item or child route is shown inside the same
 * route container. The header owns the breadcrumb chrome and back affordance;
 * the route owns navigation and title resolution.
 */
export interface RouteContainerHeaderBreadcrumb {
  /** Current item title. Falls back to the top-level `title` prop. */
  currentTitle?: ReactNode
  /** Optional breadcrumb levels between parent and current item. */
  ancestors?: Array<{
    title: ReactNode
    onSelect?: () => void
  }>
  /** Called when the breadcrumb back control is selected. */
  onBack: () => void
  /** Parent route/entry title. */
  parentTitle: ReactNode
  ariaLabel?: string
  backLabel?: string
}

type RouteContainerHeaderLeadingActionsMode = 'auto' | boolean

/**
 * Route header chrome.
 *
 * The component owns header layout, collapsed/compact affordances, breadcrumb
 * rendering, icon sizing, tooltips, and structured action visuals. Routes own
 * all business state: title, active action state, plugin-provided actions, and
 * navigation callbacks. If repeated callers need new generic header behavior,
 * extend this API instead of rendering ad-hoc buttons in `actions`.
 */
export interface RouteContainerHeaderProps {
  /**
   * Structured right-side actions. Use this for normal route/plugin commands so
   * active icons, labels, tooltip placement, sizing, and hover styling stay
   * consistent across route containers.
   */
  actionItems?: RouteContainerHeaderActionItem[]
  /**
   * Escape-hatch right-side slot. Use only for UI that cannot be represented by
   * `actionItems`; if several routes need the same pattern, promote it into a
   * structured header prop instead of repeating custom chrome.
   */
  actions?: ReactNode
  /** Switches title rendering to breadcrumb mode. */
  breadcrumb?: RouteContainerHeaderBreadcrumb
  /** Override sidebar-collapsed header mode; defaults to global shell state. */
  collapsed?: boolean
  /** Override compact mode; defaults to responsive/collapsed shell behavior. */
  compact?: boolean
  /** Title icon for normal mode. Rendered through shared icon-asset sizing. */
  icon?: IconAsset
  /**
   * Leading shell actions such as sidebar/back/forward. Keep these as generic
   * chrome actions; route-specific commands belong in `actionItems`.
   */
  leadingActions?: RouteContainerHeaderLeadingActionsMode
  /** Header title or current breadcrumb title fallback. */
  title?: ReactNode
  /**
   * Full title slot for routes with richer inline title content. The header
   * still owns placement, overflow, compact sizing, and drag-region behavior.
   */
  titleContent?: ReactNode
  /** Optional class for route-specific token hooks; do not restyle header chrome. */
  className?: string
  /** Optional root ref for route-owned measurement such as action overflow decisions. */
  rootRef?: Ref<HTMLDivElement>
  /** Optional title click hook for route-owned hidden affordances/debug toggles. */
  onTitleClick?: () => void
  /** Optional generic create command used only when leading actions are visible. */
  onCreateSession?: () => void
  /** Optional sidebar open callback for compact/mobile shells. */
  onOpenSidebar?: () => void
}

export function RouteContainerHeader({
  actionItems = [],
  actions,
  breadcrumb,
  collapsed,
  compact,
  icon,
  leadingActions = 'auto',
  className,
  rootRef,
  title,
  titleContent,
  onTitleClick,
  onCreateSession,
  onOpenSidebar
}: RouteContainerHeaderProps) {
  const { t } = useTranslation()
  const { isCompactLayout } = useResponsiveLayout()
  const isSidebarCollapsed = useAtomValue(isSidebarCollapsedAtom)
  const isResizing = useAtomValue(isSidebarResizingAtom)
  const isMac = navigator.platform.includes('Mac')
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward
  } = useBrowserHistoryNavigationState()
  const resolvedCollapsed = collapsed ?? isSidebarCollapsed
  const isHeaderCompact = compact ?? (isCompactLayout || resolvedCollapsed)
  const shouldRenderLeadingActions = leadingActions === 'auto' ? isCompactLayout : leadingActions
  const resolvedTitle = breadcrumb?.currentTitle ?? title
  const titleText = typeof resolvedTitle === 'string' ? resolvedTitle : undefined
  const handleOpenSidebar = () => {
    if (!isCompactLayout && resolvedCollapsed) {
      emitDesktopViewShortcut('toggle-sidebar')
      return
    }

    onOpenSidebar?.()
  }
  const handleTitleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (onTitleClick == null) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onTitleClick()
  }
  const renderBreadcrumbSeparator = (key: string) => (
    <span key={key} className='route-container-header__breadcrumb-separator' aria-hidden='true'>
      <MaterialSymbol name='chevron_right' />
    </span>
  )
  const renderBreadcrumbAncestor = (
    ancestor: NonNullable<RouteContainerHeaderBreadcrumb['ancestors']>[number],
    index: number
  ) => {
    const title = typeof ancestor.title === 'string' ? ancestor.title : undefined
    if (ancestor.onSelect == null) {
      return (
        <span
          key={`ancestor:${index}`}
          className='route-container-header__breadcrumb-ancestor'
          title={title}
        >
          {ancestor.title}
        </span>
      )
    }

    return (
      <button
        key={`ancestor:${index}`}
        type='button'
        className='route-container-header__breadcrumb-ancestor route-container-header__breadcrumb-ancestor-button'
        title={title}
        onClick={(event) => {
          event.stopPropagation()
          ancestor.onSelect?.()
        }}
      >
        {ancestor.title}
      </button>
    )
  }
  const renderedTitleContent = breadcrumb == null
    ? (
      <span className='route-container-header__title-content'>
        {titleContent ?? (
          <>
            {icon != null && renderIconAsset({
              active: true,
              className: 'route-container-header__title-icon',
              icon
            })}
            <span
              className='route-container-header__title-text'
              title={titleText}
            >
              {resolvedTitle}
            </span>
          </>
        )}
      </span>
    )
    : (
      <div className='route-container-header__breadcrumb' aria-label={breadcrumb.ariaLabel}>
        <button
          type='button'
          className='route-container-header__breadcrumb-back'
          aria-label={breadcrumb.backLabel ?? t('common.back')}
          onClick={(event) => {
            event.stopPropagation()
            breadcrumb.onBack()
          }}
        >
          <MaterialSymbol name='chevron_left' aria-hidden='true' />
        </button>
        <span
          className='route-container-header__breadcrumb-parent'
          title={typeof breadcrumb.parentTitle === 'string' ? breadcrumb.parentTitle : undefined}
        >
          {breadcrumb.parentTitle}
        </span>
        {breadcrumb.ancestors?.flatMap((ancestor, index) => [
          renderBreadcrumbSeparator(`separator:ancestor:${index}`),
          renderBreadcrumbAncestor(ancestor, index)
        ])}
        {renderBreadcrumbSeparator('separator:current')}
        <span
          className='route-container-header__breadcrumb-current'
          title={titleText}
        >
          {resolvedTitle}
        </span>
      </div>
    )

  return (
    <div
      ref={rootRef}
      className={[
        'route-container-header',
        resolvedCollapsed ? 'is-collapsed' : '',
        breadcrumb != null ? 'is-breadcrumb' : '',
        isResizing ? 'is-resizing' : '',
        isHeaderCompact ? 'is-compact' : '',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className='route-container-header__main'>
        {shouldRenderLeadingActions && (
          <div className='route-container-header__leading-actions'>
            {onOpenSidebar != null && (
              <RouteHeaderActionButton
                isMac={isMac}
                shortcut={getDesktopViewShortcut('toggle-sidebar')}
                tooltipTitle={t('navRail.expandSidebar')}
                label={t('navRail.expandSidebar')}
                onClick={handleOpenSidebar}
                icon={<MaterialSymbol className='route-container-header__action-icon' name='left_panel_open' />}
              />
            )}
            <RouteHeaderActionButton
              isMac={isMac}
              shortcut={getDesktopViewShortcut('back')}
              tooltipTitle={t('navRail.back')}
              disabled={!canGoBack}
              label={t('navRail.back')}
              onClick={goBack}
              icon={<MaterialSymbol className='route-container-header__action-icon' name='arrow_back' />}
            />
            <RouteHeaderActionButton
              isMac={isMac}
              shortcut={getDesktopViewShortcut('forward')}
              tooltipTitle={t('navRail.forward')}
              disabled={!canGoForward}
              label={t('navRail.forward')}
              onClick={goForward}
              icon={<MaterialSymbol className='route-container-header__action-icon' name='arrow_forward' />}
            />
            {onCreateSession != null && (
              <RouteHeaderActionButton
                isMac={isMac}
                shortcut='mod+k'
                tooltipTitle={t('common.newChat')}
                label={t('common.newChat')}
                onClick={onCreateSession}
                icon={<MaterialSymbol className='route-container-header__action-icon' name='edit_square' />}
              />
            )}
          </div>
        )}
        <div className='route-container-header__info'>
          <div className='route-container-header__title'>
            <span
              className={[
                'route-container-header__title-click-target',
                onTitleClick != null ? 'is-clickable' : ''
              ].filter(Boolean).join(' ')}
              role={onTitleClick == null ? undefined : 'button'}
              tabIndex={onTitleClick == null ? undefined : 0}
              onClick={onTitleClick}
              onKeyDown={handleTitleKeyDown}
            >
              {renderedTitleContent}
            </span>
          </div>
        </div>
      </div>
      {(actionItems.length > 0 || actions != null) && (
        <div className='route-container-header__actions'>
          {actionItems.map(item => <RouteContainerHeaderActionButton key={item.key} item={item} />)}
          {actions}
        </div>
      )}
    </div>
  )
}
