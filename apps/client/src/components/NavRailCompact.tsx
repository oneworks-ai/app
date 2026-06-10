import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { NavRailMoreMenuItem, NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'

import { NavRailCompactMoreSheet } from './NavRailCompactMoreSheet'

export interface NavRailCompactItem {
  active: boolean
  icon: IconAsset
  key: string
  label: string
  path: string
}

export interface NavRailCompactMoreAction {
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

export interface NavRailCompactChoiceAction {
  active: boolean
  icon?: string
  key: string
  label: string
  onSelect: () => void
}

const isCustomMoreMenuItem = (
  item: NavRailMoreMenuItem
): item is Extract<NavRailMoreMenuItem, { type: 'custom' }> => (
  'type' in item && item.type === 'custom'
)

const isMoreMenuItemActive = (item: NavRailMoreMenuItem): boolean => {
  if (isCustomMoreMenuItem(item)) return false

  return item.active === true || item.selected === true || (item.children ?? []).some(isMoreMenuItemActive)
}

export function NavRailCompact({
  ariaHidden = false,
  currentPath,
  languageActions,
  languageLabel,
  moreFooterAfter,
  moreFooterBefore,
  moreLabel,
  moreMenuSections,
  moreSheetActions,
  navItems,
  placement = 'bottom',
  themeActions,
  themeLabel,
  onAction,
  onNavClick
}: {
  ariaHidden?: boolean
  currentPath: string
  languageActions: NavRailCompactChoiceAction[]
  languageLabel: string
  moreFooterAfter?: ReactNode
  moreFooterBefore?: ReactNode
  moreLabel: string
  moreMenuSections?: NavRailMoreMenuSection[]
  moreSheetActions: NavRailCompactMoreAction[]
  navItems: NavRailCompactItem[]
  placement?: 'bottom' | 'drawer'
  themeActions: NavRailCompactChoiceAction[]
  themeLabel: string
  onAction?: () => void
  onNavClick: (key: string, path: string) => void
}) {
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false)
  const isMoreActive = isMoreSheetOpen || moreSheetActions.some((action) => action.active) ||
    (moreMenuSections ?? []).some(section => section.items.some(isMoreMenuItemActive))

  useEffect(() => {
    setIsMoreSheetOpen(false)
  }, [currentPath])

  useEffect(() => {
    if (ariaHidden) {
      setIsMoreSheetOpen(false)
    }
  }, [ariaHidden])

  return (
    <div
      className={`nav-rail nav-rail--compact nav-rail--compact-${placement}`}
      aria-hidden={ariaHidden || undefined}
    >
      <div className='nav-rail-compact-list'>
        {navItems.map((item) => (
          <Button
            key={item.key}
            type='text'
            className={`nav-item nav-item--compact ${item.active ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
            onClick={() => {
              setIsMoreSheetOpen(false)
              onNavClick(item.key, item.path)
              onAction?.()
            }}
            icon={renderIconAsset({
              active: item.active,
              className: 'nav-item-icon',
              icon: item.icon
            })}
          />
        ))}

        <Button
          type='text'
          className={`nav-item nav-item--compact ${isMoreActive ? 'active' : ''}`}
          title={moreLabel}
          aria-expanded={isMoreSheetOpen}
          aria-haspopup='dialog'
          aria-label={moreLabel}
          onClick={() => setIsMoreSheetOpen((prev) => !prev)}
          icon={<MaterialSymbol name='menu' />}
        />
      </div>

      <NavRailCompactMoreSheet
        actions={moreSheetActions}
        isOpen={isMoreSheetOpen}
        languageActions={languageActions}
        languageLabel={languageLabel}
        moreFooterAfter={moreFooterAfter}
        moreFooterBefore={moreFooterBefore}
        moreLabel={moreLabel}
        moreMenuSections={moreMenuSections}
        onActionSelect={onAction}
        onClose={() => setIsMoreSheetOpen(false)}
        themeActions={themeActions}
        themeLabel={themeLabel}
      />
    </div>
  )
}
