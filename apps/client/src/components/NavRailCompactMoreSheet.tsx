import { ShortcutDisplay } from '@oneworks/components/route-layout'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { NavRailMoreMenuItem, NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'

import { useMobileBottomSheetGesture } from './use-mobile-bottom-sheet-gesture'

interface NavRailCompactMoreAction {
  active?: boolean
  activeIcon?: IconAsset
  danger?: boolean
  disabled?: boolean
  icon?: IconAsset
  key: string
  label: ReactNode
  onSelect: () => void
  selected?: boolean
  shortcut?: string
  title?: string
}

interface NavRailCompactChoiceAction {
  active: boolean
  icon?: string
  key: string
  label: string
  onSelect: () => void
}

/**
 * Mobile/compact More sheet for NavRail.
 *
 * Keep `actions` for compact-only shortcut actions such as opening the sidebar.
 * Route/plugin menu contributions must stay in `moreMenuSections` so submenus,
 * custom rows, selected state, danger state, and shortcuts preserve the same
 * semantics as the desktop More menu. Context-menu-only sections intentionally
 * do not flow into this component.
 */
export function NavRailCompactMoreSheet({
  actions,
  isOpen,
  languageActions,
  languageLabel,
  moreFooterAfter,
  moreFooterBefore,
  moreLabel,
  moreMenuSections = [],
  onClose,
  onActionSelect,
  themeActions,
  themeLabel
}: {
  actions: NavRailCompactMoreAction[]
  isOpen: boolean
  languageActions: NavRailCompactChoiceAction[]
  languageLabel: string
  moreFooterAfter?: ReactNode
  moreFooterBefore?: ReactNode
  moreLabel: string
  moreMenuSections?: NavRailMoreMenuSection[]
  onClose: () => void
  onActionSelect?: () => void
  themeActions: NavRailCompactChoiceAction[]
  themeLabel: string
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const gestureHandlers = useMobileBottomSheetGesture({ isOpen, onClose, sheetRef })
  const activeLanguageKey = languageActions.find((action) => action.active)?.key ?? languageActions[0]?.key ?? ''

  useEffect(() => {
    setPortalHost(document.body)
  }, [])

  const handleActionSelect = (action: { disabled?: boolean; onSelect: () => void }) => {
    if (action.disabled === true) return
    action.onSelect()
    onActionSelect?.()
    onClose()
  }

  const handleChoiceSelect = (action: NavRailCompactChoiceAction) => {
    action.onSelect()
  }

  const renderBaseAction = (action: NavRailCompactMoreAction) => {
    const isActive = action.active === true || action.selected === true
    const labelText = typeof action.label === 'string' ? action.label : action.title ?? action.key

    return (
      <button
        key={action.key}
        type='button'
        className={[
          'nav-rail-compact-sheet__action',
          isActive ? 'is-active' : '',
          action.danger === true ? 'is-danger' : ''
        ].filter(Boolean).join(' ')}
        disabled={action.disabled}
        title={action.title ?? labelText}
        aria-label={labelText}
        onClick={() => handleActionSelect(action)}
      >
        {renderIconAsset({
          active: isActive,
          className: 'nav-rail-compact-sheet__action-icon',
          icon: isActive && action.activeIcon != null ? action.activeIcon : action.icon
        })}
        <span className='nav-rail-compact-sheet__action-label'>{action.label}</span>
        {action.shortcut != null && (
          <ShortcutDisplay
            className='nav-rail-compact-sheet__action-shortcut'
            isMac={navigator.platform.includes('Mac')}
            shortcut={action.shortcut}
          />
        )}
      </button>
    )
  }

  const isCustomMenuItem = (
    item: NavRailMoreMenuItem
  ): item is Extract<NavRailMoreMenuItem, { type: 'custom' }> => (
    'type' in item && item.type === 'custom'
  )

  const menuItemToAction = (item: Exclude<NavRailMoreMenuItem, { type: 'custom' }>): NavRailCompactMoreAction => ({
    active: item.active,
    activeIcon: item.activeIcon,
    danger: item.danger,
    disabled: item.disabled,
    icon: item.icon,
    key: item.key,
    label: item.label,
    onSelect: item.onSelect ?? (() => {}),
    selected: item.selected,
    shortcut: item.shortcut,
    title: item.title
  })

  const renderMenuItem = (item: NavRailMoreMenuItem): ReactNode => {
    if (isCustomMenuItem(item)) {
      return (
        <div
          key={item.key}
          className={[
            'nav-rail-compact-sheet__custom',
            item.className ?? ''
          ].filter(Boolean).join(' ')}
          onClick={item.onClick}
        >
          {item.content}
        </div>
      )
    }

    const children = item.children ?? []
    if (children.length === 0) {
      return renderBaseAction(menuItemToAction(item))
    }

    return (
      <div key={item.key} className='nav-rail-compact-sheet__submenu'>
        <div className='nav-rail-compact-sheet__submenu-title'>
          {renderIconAsset({
            active: item.active === true,
            className: 'nav-rail-compact-sheet__submenu-icon',
            icon: item.active === true && item.activeIcon != null ? item.activeIcon : item.icon
          })}
          <span className='nav-rail-compact-sheet__submenu-label'>{item.label}</span>
        </div>
        <div className='nav-rail-compact-sheet__actions'>
          {children.map(renderMenuItem)}
        </div>
      </div>
    )
  }

  const sheet = (
    <>
      <button
        type='button'
        className={`nav-rail-compact-sheet-backdrop ${isOpen ? 'is-open' : ''}`}
        aria-hidden={!isOpen}
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={`nav-rail-compact-sheet ${isOpen ? 'is-open' : ''}`}
        role='dialog'
        aria-modal={isOpen ? 'true' : undefined}
        aria-hidden={!isOpen}
        aria-label={moreLabel}
        {...gestureHandlers}
      >
        <div className='nav-rail-compact-sheet__handle' />

        {moreFooterBefore != null && (
          <div className='nav-rail-compact-sheet__slot nav-rail-compact-sheet__slot--before'>
            {moreFooterBefore}
          </div>
        )}

        {actions.length > 0 && (
          <div className='nav-rail-compact-sheet__section'>
            <div className='nav-rail-compact-sheet__section-title'>
              <MaterialSymbol className='nav-rail-compact-sheet__section-title-icon' name='tune' />
              <span>{moreLabel}</span>
            </div>
            <div className='nav-rail-compact-sheet__actions'>
              {actions.map(renderBaseAction)}
            </div>
          </div>
        )}

        {moreMenuSections.filter(section => section.items.length > 0).map(section => (
          <div key={section.key} className='nav-rail-compact-sheet__section'>
            <div className='nav-rail-compact-sheet__actions'>
              {section.items.map(renderMenuItem)}
            </div>
          </div>
        ))}

        <div className='nav-rail-compact-sheet__section'>
          <div className='nav-rail-compact-sheet__section-title'>
            <MaterialSymbol className='nav-rail-compact-sheet__section-title-icon' name='palette' />
            <span>{themeLabel}</span>
          </div>
          <div className='nav-rail-compact-sheet__segmented'>
            {themeActions.map((action) => (
              <button
                key={action.key}
                type='button'
                className={`nav-rail-compact-sheet__segment ${action.active ? 'is-active' : ''}`}
                onClick={() => handleChoiceSelect(action)}
              >
                {action.icon != null && (
                  <MaterialSymbol className='nav-rail-compact-sheet__segment-icon' name={action.icon} />
                )}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className='nav-rail-compact-sheet__section'>
          <div className='nav-rail-compact-sheet__section-title'>
            <MaterialSymbol className='nav-rail-compact-sheet__section-title-icon' name='language' />
            <span>{languageLabel}</span>
          </div>
          <label className='nav-rail-compact-sheet__select-shell'>
            <MaterialSymbol className='nav-rail-compact-sheet__select-icon' name='translate' />
            <select
              className='nav-rail-compact-sheet__select'
              value={activeLanguageKey}
              aria-label={languageLabel}
              onChange={(event) => {
                const selectedAction = languageActions.find((action) => action.key === event.target.value)
                if (selectedAction != null) {
                  handleChoiceSelect(selectedAction)
                }
              }}
            >
              {languageActions.map((action) => (
                <option key={action.key} value={action.key}>
                  {action.label}
                </option>
              ))}
            </select>
            <MaterialSymbol className='nav-rail-compact-sheet__select-chevron' name='expand_more' />
          </label>
        </div>

        {moreFooterAfter != null && (
          <div className='nav-rail-compact-sheet__slot nav-rail-compact-sheet__slot--after'>
            {moreFooterAfter}
          </div>
        )}
      </div>
    </>
  )

  return portalHost == null ? null : createPortal(sheet, portalHost)
}
