/* eslint-disable max-lines -- dev-only component lab keeps style fixtures and interaction examples together. */
import './ComponentLabRoute.scss'

import { Button, Dropdown, Popover, Radio, Switch } from 'antd'
import { useAtom } from 'jotai'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import type { RouteContainerHeaderActionItem } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { themeAtom } from '#~/store'

import { ChatHistoryTimelineLab } from './component-lab-timeline/ChatHistoryTimelineLab'

interface LabMenuActionItem {
  confirmLabel?: string
  description?: string
  hasSubmenu?: boolean
  icon: string
  key: string
  label: string
  selected?: boolean
  shortcut?: string
  submenuPlacement?: 'left' | 'right'
  tone?: 'danger'
}

interface LabMenuDividerItem {
  key: string
  type: 'divider'
}

type LabMenuItem = LabMenuActionItem | LabMenuDividerItem
type LabDropdownKey = 'edge-click' | 'edge-context' | 'main-click' | 'main-context' | 'nested-click'
type NestedMenuLevel = 1 | 2 | 3 | 4

interface NestedMenuKeys {
  level1: string | null
  level2: string | null
  level3: string | null
  level4: string | null
}

interface LabDirectoryGroup {
  items: LabDirectoryItem[]
  label: string
}

interface LabDirectoryItem {
  disabled?: boolean
  icon: string
  key: string
  label: string
}

interface LabTreeNode {
  children?: LabTreeNode[]
  collapsedIcon?: string
  confirmLabel?: string
  contextMenuItems?: LabMenuItem[]
  expandedIcon?: string
  icon?: string
  key: string
  label: string
  meta?: string
}

const isDividerItem = (item: LabMenuItem): item is LabMenuDividerItem => 'type' in item && item.type === 'divider'

const iconNode = (icon: string, className = 'overlay-lab-menu-icon') => (
  <span className={`material-symbols-rounded ${className}`}>{icon}</span>
)

function Shortcut({ value }: { value?: string }) {
  if (value == null) return null
  return <span className='overlay-lab-menu-shortcut'>{value}</span>
}

function Scenario({
  children,
  surfaceClassName,
  title
}: {
  children: ReactNode
  surfaceClassName?: string
  title: string
}) {
  return (
    <section className='overlay-lab__scenario'>
      <div className='overlay-lab__scenario-title'>{title}</div>
      <div
        className={['overlay-lab__surface', surfaceClassName].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </section>
  )
}

function LabDirectoryTree({
  activeKey,
  onSelect
}: {
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <aside className='overlay-lab__directory' aria-label='Component directory'>
      {labDirectoryGroups.map(group => (
        <div key={group.label} className='overlay-lab__directory-group'>
          <div className='overlay-lab__directory-group-title'>{group.label}</div>
          <div className='overlay-lab__directory-items'>
            {group.items.map(item => {
              const active = item.key === activeKey

              return (
                <button
                  key={item.key}
                  type='button'
                  className={[
                    'overlay-lab__directory-item',
                    active ? 'is-active' : '',
                    item.disabled === true ? 'is-disabled' : ''
                  ].filter(Boolean).join(' ')}
                  disabled={item.disabled}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    if (item.disabled !== true) {
                      onSelect(item.key)
                    }
                  }}
                >
                  {iconNode(item.icon, 'overlay-lab__directory-item-icon')}
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </aside>
  )
}

function LabSegmentedIconControl<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string
  className?: string
  onChange: (value: T) => void
  options: Array<{ icon: string; label: string; value: T }>
  value: T
}) {
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value))

  return (
    <div
      className={['overlay-lab-segmented', className].filter(Boolean).join(' ')}
      role='radiogroup'
      aria-label={ariaLabel}
      style={{ '--overlay-lab-segmented-index': activeIndex } as CSSProperties}
    >
      {options.map(option => (
        <button
          key={option.value}
          type='button'
          className={[
            'overlay-lab-segmented__button',
            option.value === value ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
          role='radio'
          aria-label={option.label}
          aria-checked={option.value === value}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {iconNode(option.icon, 'overlay-lab-segmented__icon')}
        </button>
      ))}
    </div>
  )
}

function filterLabTreeNodes(nodes: LabTreeNode[], query: string): LabTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery === '') return nodes

  return nodes.flatMap(node => {
    const filteredChildren = node.children == null
      ? undefined
      : filterLabTreeNodes(node.children, query)
    const selfMatched = node.label.toLocaleLowerCase().includes(normalizedQuery) ||
      node.meta?.toLocaleLowerCase().includes(normalizedQuery) === true

    if (!selfMatched && (filteredChildren == null || filteredChildren.length === 0)) {
      return []
    }

    return [{ ...node, children: filteredChildren }]
  })
}

function LabSinglePanelTree() {
  const [activeKey, setActiveKey] = useState('codex/global-select-migration')
  const [contextMenuKey, setContextMenuKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState(['local', 'codex'])
  const [pendingConfirmKey, setPendingConfirmKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('tree')
  const expandedKeySet = useMemo(() => new Set(expandedKeys), [expandedKeys])
  const visibleNodes = useMemo(() => filterLabTreeNodes(labTreeNodes, query), [query])
  const queryActive = query.trim() !== ''
  const toggleNode = (key: string) => {
    setExpandedKeys(keys =>
      keys.includes(key)
        ? keys.filter(currentKey => currentKey !== key)
        : [...keys, key]
    )
  }
  const renderNode = (node: LabTreeNode, depth = 0): ReactNode => {
    const hasChildren = node.children != null && node.children.length > 0
    const expanded = queryActive || expandedKeySet.has(node.key)
    const active = node.key === activeKey
    const contextMenuItems = node.contextMenuItems
    const isConfirming = pendingConfirmKey === node.key
    const stateIcon = hasChildren
      ? expanded
        ? node.expandedIcon ?? node.icon ?? node.collapsedIcon
        : node.collapsedIcon ?? node.icon ?? node.expandedIcon
      : undefined
    const icon = stateIcon ?? node.icon

    const rowButton = (
      <div
        role='treeitem'
        tabIndex={0}
        className={[
          'overlay-lab-tree-row',
          active ? 'is-active' : '',
          hasChildren ? 'has-children' : '',
          isConfirming ? 'is-confirming' : '',
          contextMenuItems != null ? 'has-context-menu' : ''
        ].filter(Boolean).join(' ')}
        style={{ '--overlay-lab-tree-depth': depth } as CSSProperties}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-haspopup={contextMenuItems == null ? undefined : 'menu'}
        onClick={() => {
          if (hasChildren) {
            setPendingConfirmKey(null)
            setActiveKey(node.key)
            toggleNode(node.key)
            return
          }

          if (node.confirmLabel != null) {
            setPendingConfirmKey(currentKey => currentKey === node.key ? null : node.key)
            return
          }

          setPendingConfirmKey(null)
          setActiveKey(node.key)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.currentTarget.click()
        }}
      >
        {icon != null && iconNode(icon, 'overlay-lab-tree-row__icon')}
        <span className='overlay-lab-tree-row__content'>
          <span className='overlay-lab-tree-row__label'>
            {isConfirming ? node.confirmLabel : node.label}
          </span>
          {node.meta != null && !isConfirming && (
            <span className='overlay-lab-tree-row__meta'>{node.meta}</span>
          )}
        </span>
        {isConfirming && (
          <span className='overlay-lab-tree-confirm-actions'>
            <button
              type='button'
              className='overlay-lab-menu-confirm-btn is-accept'
              aria-label={`Confirm ${node.label}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setActiveKey(node.key)
                setPendingConfirmKey(null)
              }}
            >
              {iconNode('check', 'overlay-lab-menu-confirm-icon')}
            </button>
            <button
              type='button'
              className='overlay-lab-menu-confirm-btn is-cancel'
              aria-label={`Cancel ${node.label}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setPendingConfirmKey(null)
              }}
            >
              {iconNode('close', 'overlay-lab-menu-confirm-icon')}
            </button>
          </span>
        )}
      </div>
    )
    const row = contextMenuItems == null
      ? rowButton
      : (
        <Dropdown
          trigger={['contextMenu']}
          destroyOnHidden
          open={contextMenuKey === node.key}
          overlayClassName='overlay-lab-ant-dropdown'
          popupRender={() => (
            <LabMenu
              items={contextMenuItems}
              onItemClick={(item) => {
                if (item.key === 'checkout') {
                  setActiveKey(node.key)
                }
                setContextMenuKey(null)
              }}
            />
          )}
          onOpenChange={(open) => {
            setContextMenuKey(open ? node.key : null)
            if (open) {
              setPendingConfirmKey(null)
            }
          }}
          transitionName=''
          menu={{ items: [] }}
        >
          {rowButton}
        </Dropdown>
      )

    return (
      <div key={node.key} className='overlay-lab-tree-node'>
        {row}
        {hasChildren && (
          <div
            className={[
              'overlay-lab-tree-children-collapse',
              expanded ? '' : 'is-collapsed'
            ].filter(Boolean).join(' ')}
            aria-hidden={!expanded}
          >
            <div className='overlay-lab-tree-children-collapse__inner'>
              <div className='overlay-lab-tree-children'>
                {node.children?.map(child => renderNode(child, depth + 1))}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='overlay-lab-tree-panel'>
      <div className='overlay-lab-search-row overlay-lab-tree-toolbar'>
        <label className='overlay-lab-search-field'>
          {iconNode('search', 'overlay-lab-search-field__icon')}
          <input
            className='overlay-lab-search-input'
            value={query}
            placeholder='Search branches'
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <div className='overlay-lab-search-accessory'>
          <LabSegmentedIconControl
            ariaLabel='Tree display mode'
            className='overlay-lab-search-segmented'
            value={viewMode}
            onChange={setViewMode}
            options={[
              { icon: 'account_tree', label: 'Tree', value: 'tree' },
              { icon: 'format_list_bulleted', label: 'List', value: 'list' }
            ]}
          />
        </div>
      </div>
      <div className='overlay-lab-tree-list' role='tree'>
        {visibleNodes.map(node => renderNode(node))}
      </div>
    </div>
  )
}

function LabMenu({
  items,
  multi = false,
  onItemClick
}: {
  items: LabMenuItem[]
  multi?: boolean
  onItemClick?: (item: LabMenuActionItem) => void
}) {
  const [pendingConfirmKey, setPendingConfirmKey] = useState<string | null>(null)
  const selectedIndexes = items
    .map((item, index) => isDividerItem(item) || item.selected !== true ? -1 : index)
    .filter(index => index >= 0)
  const selectedIndexSet = new Set(selectedIndexes)
  const firstSelectedIndex = selectedIndexes[0]
  const lastSelectedIndex = selectedIndexes[selectedIndexes.length - 1]
  const activateItem = (item: LabMenuActionItem) => {
    if (item.confirmLabel != null) {
      setPendingConfirmKey(currentKey => currentKey === item.key ? null : item.key)
      return
    }

    setPendingConfirmKey(null)
    onItemClick?.(item)
  }
  const confirmItem = (item: LabMenuActionItem) => {
    setPendingConfirmKey(null)
    onItemClick?.(item)
  }
  const handleItemKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: LabMenuActionItem
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    activateItem(item)
  }

  return (
    <div className={`overlay-lab-menu ${multi ? 'overlay-lab-menu--multi' : ''}`} role='menu'>
      {items.map((item, index) => {
        if (isDividerItem(item)) {
          return <div key={item.key} className='overlay-lab-menu-divider' role='separator' />
        }

        const selected = selectedIndexSet.has(index)
        const isConfirming = pendingConfirmKey === item.key
        const isSubmenuLeft = item.hasSubmenu === true && item.submenuPlacement === 'left'
        const selectedClassName = selected
          ? [
            'is-selected',
            multi ? 'is-selected-chain' : '',
            index === firstSelectedIndex ? 'is-chain-start' : '',
            index === lastSelectedIndex ? 'is-chain-end' : ''
          ].filter(Boolean).join(' ')
          : ''

        return (
          <div
            key={item.key}
            className={[
              'overlay-lab-menu-item',
              item.hasSubmenu === true ? 'has-submenu' : '',
              item.description != null ? 'has-description' : '',
              isSubmenuLeft ? 'is-submenu-left' : '',
              isConfirming ? 'is-confirming' : '',
              selectedClassName,
              item.tone === 'danger' ? 'is-danger' : ''
            ].filter(Boolean).join(' ')}
            tabIndex={0}
            role={multi ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={multi ? selected : undefined}
            aria-haspopup={item.hasSubmenu === true ? 'menu' : undefined}
            onClick={() => activateItem(item)}
            onKeyDown={event => handleItemKeyDown(event, item)}
          >
            {isSubmenuLeft
              ? iconNode('chevron_left', 'overlay-lab-menu-submenu-icon')
              : iconNode(item.icon)}
            <span
              className={[
                'overlay-lab-menu-label',
                item.description != null ? 'has-description' : ''
              ].filter(Boolean).join(' ')}
            >
              <span className='overlay-lab-menu-label__title'>
                {isConfirming ? item.confirmLabel : item.label}
              </span>
              {item.description != null && !isConfirming && (
                <span className='overlay-lab-menu-label__description'>
                  {item.description}
                </span>
              )}
            </span>
            {isConfirming
              ? (
                <span className='overlay-lab-menu-confirm-actions'>
                  <button
                    type='button'
                    className='overlay-lab-menu-confirm-btn is-accept'
                    aria-label={`Confirm ${item.label}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      confirmItem(item)
                    }}
                  >
                    {iconNode('check', 'overlay-lab-menu-confirm-icon')}
                  </button>
                  <button
                    type='button'
                    className='overlay-lab-menu-confirm-btn is-cancel'
                    aria-label={`Cancel ${item.label}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setPendingConfirmKey(null)
                    }}
                  >
                    {iconNode('close', 'overlay-lab-menu-confirm-icon')}
                  </button>
                </span>
              )
              : item.hasSubmenu !== true && <Shortcut value={item.shortcut} />}
            {!isConfirming && isSubmenuLeft && (
              iconNode(item.icon, 'overlay-lab-menu-icon overlay-lab-menu-icon--trailing')
            )}
            {!isConfirming && item.hasSubmenu === true && !isSubmenuLeft && (
              iconNode(
                'chevron_right',
                'overlay-lab-menu-submenu-icon overlay-lab-menu-submenu-icon--right'
              )
            )}
          </div>
        )
      })}
    </div>
  )
}

function LabSearchMenuPanel({
  accessory,
  items,
  onItemClick,
  onSearchChange,
  searchPlacement,
  searchValue
}: {
  accessory?: ReactNode
  items: LabMenuItem[]
  onItemClick?: (item: LabMenuActionItem) => void
  onSearchChange: (value: string) => void
  searchPlacement: 'bottom' | 'top'
  searchValue: string
}) {
  const searchRow = (
    <div className='overlay-lab-search-row'>
      <label className='overlay-lab-search-field'>
        {iconNode('search', 'overlay-lab-search-field__icon')}
        <input
          className='overlay-lab-search-input'
          value={searchValue}
          placeholder='Search'
          onChange={event => onSearchChange(event.target.value)}
        />
      </label>
      {accessory != null && (
        <div className='overlay-lab-search-accessory'>
          {accessory}
        </div>
      )}
    </div>
  )

  return (
    <div className={`overlay-lab-search-menu is-search-${searchPlacement}`}>
      {searchPlacement === 'top' && searchRow}
      <div className='overlay-lab-search-menu__list'>
        {items.length > 0
          ? <LabMenu items={items} onItemClick={onItemClick} />
          : (
            <div className='overlay-lab-search-empty'>
              {iconNode('search_off', 'overlay-lab-search-empty__icon')}
              <span>No results</span>
            </div>
          )}
      </div>
      {searchPlacement === 'bottom' && searchRow}
    </div>
  )
}

function SelectLabel({
  icon,
  label,
  meta
}: {
  icon: string
  label: string
  meta?: string
}) {
  return (
    <span className='overlay-lab-select-label'>
      {iconNode(icon, 'overlay-lab-select-label__icon')}
      <span className='overlay-lab-select-label__text'>
        <span className='overlay-lab-select-label__title'>{label}</span>
        {meta != null && <span className='overlay-lab-select-label__meta'>{meta}</span>}
      </span>
    </span>
  )
}

function LabRichInteractionPanel() {
  const [autoStart, setAutoStart] = useState(false)
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'system'>('system')
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('list')

  return (
    <div className='overlay-lab-rich-panel'>
      <button type='button' className='overlay-lab-rich-row'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('settings', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Settings</span>
          </span>
        </span>
      </button>

      <button type='button' className='overlay-lab-rich-row'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('archive', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Archived sessions</span>
            <span className='overlay-lab-rich-row__description'>Recover hidden conversations</span>
          </span>
        </span>
      </button>

      <div className='overlay-lab-rich-control-block'>
        <div className='overlay-lab-rich-control-block__label'>Theme mode</div>
        <LabSegmentedIconControl
          ariaLabel='Theme mode'
          className='overlay-lab-rich-segmented'
          value={themeMode}
          onChange={setThemeMode}
          options={[
            { icon: 'desktop_windows', label: 'System', value: 'system' },
            { icon: 'light_mode', label: 'Light', value: 'light' },
            { icon: 'dark_mode', label: 'Dark', value: 'dark' }
          ]}
        />
      </div>

      <button type='button' className='overlay-lab-rich-row'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('language', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Language</span>
          </span>
        </span>
        <span className='overlay-lab-rich-row__trailing-value'>简体中文</span>
      </button>

      <div className='overlay-lab-menu-divider' role='separator' />

      <button type='button' className='overlay-lab-rich-row is-active'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('account_tree', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Worktree list</span>
            <span className='overlay-lab-rich-row__description'>Current workspace source</span>
          </span>
        </span>
        <span className='overlay-lab-rich-row__trailing'>
          <span className='overlay-lab-rich-row__trailing-value'>default</span>
          {iconNode('chevron_right', 'overlay-lab-rich-row__chevron')}
        </span>
      </button>

      <div className='overlay-lab-rich-row overlay-lab-rich-row--toggle'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('create_new_folder', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Launch in worktree</span>
            <span className='overlay-lab-rich-row__description'>Create an isolated branch workspace</span>
          </span>
        </span>
        <Switch
          className='overlay-lab-rich-switch'
          size='small'
          checked={autoStart}
          onChange={setAutoStart}
          aria-label='Launch in worktree'
        />
      </div>

      <div className='overlay-lab-rich-row overlay-lab-rich-row--control'>
        <span className='overlay-lab-rich-row__main'>
          {iconNode('schema', 'overlay-lab-rich-row__icon')}
          <span className='overlay-lab-rich-row__copy'>
            <span className='overlay-lab-rich-row__title'>Display</span>
          </span>
        </span>
        <LabSegmentedIconControl
          ariaLabel='Display mode'
          className='overlay-lab-rich-inline-segmented'
          value={viewMode}
          onChange={setViewMode}
          options={[
            { icon: 'account_tree', label: 'Tree', value: 'graph' },
            { icon: 'menu', label: 'List', value: 'list' }
          ]}
        />
      </div>
    </div>
  )
}

const labDirectoryGroups: LabDirectoryGroup[] = [
  {
    items: [
      { icon: 'layers', key: 'overlay', label: 'Overlay' },
      { disabled: true, icon: 'tune', key: 'controls', label: 'Controls' },
      { disabled: true, icon: 'space_dashboard', key: 'layout', label: 'Layout' }
    ],
    label: 'Components'
  }
]

const branchContextMenuItems: LabMenuItem[] = [
  {
    confirmLabel: 'Confirm checkout',
    icon: 'login',
    key: 'checkout',
    label: 'Checkout',
    shortcut: '↵'
  },
  { icon: 'content_copy', key: 'copy-branch', label: 'Copy branch name', shortcut: '⌘C' },
  { icon: 'folder_open', key: 'create-worktree', label: 'Create worktree', shortcut: 'W' },
  { key: 'branch-danger-divider', type: 'divider' },
  {
    confirmLabel: 'Delete branch',
    icon: 'delete',
    key: 'delete-branch',
    label: 'Delete branch',
    tone: 'danger'
  }
]

const labTreeNodes: LabTreeNode[] = [
  {
    children: [
      {
        children: [
          {
            confirmLabel: 'Checkout branch',
            contextMenuItems: branchContextMenuItems,
            icon: 'call_split',
            key: 'codex/global-select-migration',
            label: 'global-select-migration',
            meta: 'current'
          },
          {
            confirmLabel: 'Checkout branch',
            contextMenuItems: branchContextMenuItems,
            icon: 'call_split',
            key: 'codex/overlay-lab',
            label: 'overlay-lab'
          },
          {
            confirmLabel: 'Checkout branch',
            contextMenuItems: branchContextMenuItems,
            icon: 'call_split',
            key: 'codex/component-lab',
            label: 'component-lab'
          }
        ],
        collapsedIcon: 'folder',
        expandedIcon: 'folder_open',
        key: 'codex',
        label: 'codex'
      },
      {
        children: [
          {
            confirmLabel: 'Checkout branch',
            contextMenuItems: branchContextMenuItems,
            icon: 'call_split',
            key: 'feat/search-chrome',
            label: 'search-chrome'
          },
          {
            confirmLabel: 'Checkout branch',
            contextMenuItems: branchContextMenuItems,
            icon: 'call_split',
            key: 'feat/menu-polish',
            label: 'menu-polish'
          }
        ],
        collapsedIcon: 'folder',
        expandedIcon: 'folder_open',
        key: 'feat',
        label: 'feat'
      },
      {
        confirmLabel: 'Checkout branch',
        contextMenuItems: branchContextMenuItems,
        icon: 'call_split',
        key: 'main-session-35ec7d67',
        label: 'main-session-35ec7d67'
      },
      {
        confirmLabel: 'Checkout branch',
        contextMenuItems: branchContextMenuItems,
        icon: 'call_split',
        key: 'main-session-55f00852',
        label: 'main-session-55f00852'
      }
    ],
    collapsedIcon: 'folder',
    expandedIcon: 'folder_open',
    key: 'local',
    label: 'Local branches'
  },
  {
    children: [
      {
        confirmLabel: 'Checkout branch',
        contextMenuItems: branchContextMenuItems,
        icon: 'cloud_sync',
        key: 'origin/main',
        label: 'origin/main'
      },
      {
        confirmLabel: 'Checkout branch',
        contextMenuItems: branchContextMenuItems,
        icon: 'cloud_sync',
        key: 'origin/release',
        label: 'origin/release'
      }
    ],
    collapsedIcon: 'folder',
    expandedIcon: 'folder_open',
    key: 'remote',
    label: 'Remote branches'
  }
]

const baseMenuItems: LabMenuItem[] = [
  { icon: 'edit_square', key: 'rename', label: 'Rename', shortcut: 'Enter' },
  { icon: 'star', key: 'favorite', label: 'Favorite', shortcut: 'F' },
  { confirmLabel: 'Confirm archive', icon: 'archive', key: 'archive', label: 'Archive', shortcut: 'A' },
  { icon: 'content_copy', key: 'copy', label: 'Copy link', shortcut: '⌘C' },
  {
    confirmLabel: 'Confirm delete',
    icon: 'delete',
    key: 'delete',
    label: 'Delete',
    shortcut: '⌫',
    tone: 'danger'
  }
]

const multiMenuItems: LabMenuItem[] = [
  { icon: 'view_sidebar', key: 'sidebar', label: 'Sidebar', shortcut: '⌘1' },
  { icon: 'terminal', key: 'terminal', label: 'Terminal', shortcut: '⌘2' },
  { icon: 'folder_open', key: 'files', label: 'Files', shortcut: '⌘3' },
  { icon: 'language', key: 'preview', label: 'Preview', shortcut: '⌘4' }
]

const searchableMenuItems: LabMenuItem[] = [
  { icon: 'inbox', key: 'inbox', label: 'Inbox', shortcut: '⌘1' },
  { icon: 'archive', key: 'archive', label: 'Archive', shortcut: '⌘2' },
  { icon: 'folder_open', key: 'projects', label: 'Projects', shortcut: '⌘3' },
  { icon: 'group', key: 'team', label: 'Team', shortcut: '⌘4' },
  { icon: 'description', key: 'drafts', label: 'Drafts', shortcut: '⌘5' },
  { icon: 'upload', key: 'uploads', label: 'Uploads', shortcut: '⌘6' },
  { icon: 'receipt_long', key: 'billing', label: 'Billing', shortcut: '⌘7' },
  { icon: 'analytics', key: 'reports', label: 'Reports', shortcut: '⌘8' },
  { icon: 'extension', key: 'integrations', label: 'Integrations', shortcut: '⌘9' },
  { icon: 'settings', key: 'settings', label: 'Settings', shortcut: '⌘0' }
]

const dividerMenuItems: LabMenuItem[] = [
  { icon: 'edit_square', key: 'rename', label: 'Rename', shortcut: 'Enter' },
  { icon: 'star', key: 'favorite', label: 'Favorite', shortcut: 'F' },
  { key: 'primary-divider', type: 'divider' },
  { confirmLabel: 'Confirm archive', icon: 'archive', key: 'archive', label: 'Archive', shortcut: 'A' },
  { icon: 'content_copy', key: 'copy', label: 'Copy link', shortcut: '⌘C' },
  { key: 'danger-divider', type: 'divider' },
  {
    confirmLabel: 'Confirm delete',
    icon: 'delete',
    key: 'delete',
    label: 'Delete',
    shortcut: '⌫',
    tone: 'danger'
  }
]

const dropdownMenuItems: LabMenuItem[] = [
  { icon: 'edit_square', key: 'rename', label: 'Rename', shortcut: 'Enter' },
  { icon: 'archive', key: 'archive', label: 'Archive', shortcut: 'A' },
  { hasSubmenu: true, icon: 'ios_share', key: 'share', label: 'Share' },
  { key: 'dropdown-danger-divider', type: 'divider' },
  { icon: 'delete', key: 'delete', label: 'Delete', shortcut: '⌫', tone: 'danger' }
]

const dropdownShareItems: LabMenuItem[] = [
  { icon: 'content_copy', key: 'copy-link', label: 'Copy link', shortcut: '⌘C' },
  { icon: 'terminal', key: 'copy-command', label: 'Copy command', shortcut: '⌘⇧C' }
]

const dropdownPanelGap = 6
const dropdownPanelWidth = 220
const dropdownPlacementHysteresis = 16
const dropdownPlacementSyncFrameCount = 4
const dropdownSubmenuPanelWidth = 224

const submenuParentItems: LabMenuItem[] = [
  {
    hasSubmenu: true,
    icon: 'palette',
    key: 'theme',
    label: 'Theme',
    shortcut: 'T'
  },
  {
    hasSubmenu: true,
    icon: 'translate',
    key: 'language',
    label: 'Language',
    shortcut: '⌘L'
  },
  {
    icon: 'account_circle',
    key: 'profile',
    label: 'Profile',
    shortcut: 'P'
  },
  {
    hasSubmenu: true,
    icon: 'tune',
    key: 'settings',
    label: 'Settings',
    shortcut: ','
  },
  {
    icon: 'help',
    key: 'help',
    label: 'Help',
    shortcut: '?'
  }
]

const edgeSubmenuParentItems: LabMenuItem[] = submenuParentItems.map(item =>
  isDividerItem(item) || item.hasSubmenu !== true ? item : { ...item, submenuPlacement: 'left' }
)

const submenuItemsByParentKey: Record<string, LabMenuItem[]> = {
  language: [
    { icon: 'translate', key: 'language-auto', label: 'Auto detect', shortcut: 'A' },
    { icon: 'language', key: 'language-en', label: 'English', shortcut: 'E' },
    { icon: 'font_download', key: 'language-cn', label: 'Chinese', shortcut: 'C' }
  ],
  settings: [
    { icon: 'sliders', key: 'settings-general', label: 'General', shortcut: 'G' },
    { icon: 'lock', key: 'settings-privacy', label: 'Privacy', shortcut: 'P' },
    { icon: 'keyboard', key: 'settings-shortcuts', label: 'Shortcuts', shortcut: 'K' }
  ],
  theme: [
    { icon: 'light_mode', key: 'theme-light', label: 'Light', shortcut: 'L' },
    { icon: 'dark_mode', key: 'theme-dark', label: 'Dark', shortcut: 'D' },
    { icon: 'desktop_windows', key: 'theme-system', label: 'System', shortcut: 'S' }
  ]
}

const nestedRootItems: LabMenuItem[] = [
  {
    hasSubmenu: true,
    icon: 'dashboard_customize',
    key: 'workspace',
    label: 'Workspace',
    shortcut: 'W'
  },
  {
    hasSubmenu: true,
    icon: 'deployed_code',
    key: 'library',
    label: 'Library',
    shortcut: 'L'
  },
  {
    hasSubmenu: true,
    icon: 'bolt',
    key: 'automation',
    label: 'Automation',
    shortcut: 'A'
  },
  {
    icon: 'group',
    key: 'members',
    label: 'Members',
    shortcut: 'M'
  }
]

const nestedItemsByParentKey: Record<string, LabMenuItem[]> = {
  automation: [
    { hasSubmenu: true, icon: 'flash_on', key: 'automation-triggers', label: 'Triggers' },
    { hasSubmenu: true, icon: 'event_repeat', key: 'automation-schedules', label: 'Schedules' },
    { icon: 'history', key: 'automation-history', label: 'History' }
  ],
  'automation-schedules': [
    { hasSubmenu: true, icon: 'schedule', key: 'automation-schedules-nightly', label: 'Nightly' },
    { icon: 'calendar_month', key: 'automation-schedules-weekly', label: 'Weekly' },
    { icon: 'timer', key: 'automation-schedules-manual', label: 'Manual' }
  ],
  'automation-schedules-nightly': [
    { icon: 'notifications_active', key: 'automation-schedules-nightly-alerts', label: 'Alerts' },
    { icon: 'route', key: 'automation-schedules-nightly-routing', label: 'Routing' },
    { icon: 'playlist_add_check', key: 'automation-schedules-nightly-review', label: 'Review' }
  ],
  'automation-triggers': [
    { hasSubmenu: true, icon: 'webhook', key: 'automation-triggers-webhook', label: 'Webhook' },
    { icon: 'mail', key: 'automation-triggers-email', label: 'Email' },
    { icon: 'upload_file', key: 'automation-triggers-upload', label: 'Upload' }
  ],
  'automation-triggers-webhook': [
    { icon: 'key', key: 'automation-triggers-webhook-secret', label: 'Secret' },
    { icon: 'code', key: 'automation-triggers-webhook-payload', label: 'Payload' },
    { icon: 'shield', key: 'automation-triggers-webhook-rate', label: 'Rate limit' }
  ],
  library: [
    { hasSubmenu: true, icon: 'folder_open', key: 'library-assets', label: 'Assets' },
    { hasSubmenu: true, icon: 'prompt_suggestion', key: 'library-prompts', label: 'Prompts' },
    { icon: 'download', key: 'library-imports', label: 'Imports' }
  ],
  'library-assets': [
    { hasSubmenu: true, icon: 'image', key: 'library-assets-images', label: 'Images' },
    { icon: 'video_library', key: 'library-assets-video', label: 'Video' },
    { icon: 'description', key: 'library-assets-docs', label: 'Docs' }
  ],
  'library-assets-images': [
    { icon: 'palette', key: 'library-assets-images-color', label: 'Color' },
    { icon: 'crop', key: 'library-assets-images-crop', label: 'Crop' },
    { icon: 'auto_fix_high', key: 'library-assets-images-enhance', label: 'Enhance' }
  ],
  'library-prompts': [
    { hasSubmenu: true, icon: 'chat', key: 'library-prompts-chat', label: 'Chat' },
    { icon: 'article', key: 'library-prompts-writing', label: 'Writing' },
    { icon: 'data_object', key: 'library-prompts-code', label: 'Code' }
  ],
  'library-prompts-chat': [
    { icon: 'person', key: 'library-prompts-chat-tone', label: 'Tone' },
    { icon: 'rule', key: 'library-prompts-chat-rules', label: 'Rules' },
    { icon: 'translate', key: 'library-prompts-chat-locale', label: 'Locale' }
  ],
  workspace: [
    { hasSubmenu: true, icon: 'view_kanban', key: 'workspace-boards', label: 'Boards' },
    { hasSubmenu: true, icon: 'forum', key: 'workspace-rooms', label: 'Rooms' },
    { icon: 'archive', key: 'workspace-archive', label: 'Archive' }
  ],
  'workspace-boards': [
    { hasSubmenu: true, icon: 'view_column', key: 'workspace-boards-kanban', label: 'Kanban' },
    { hasSubmenu: true, icon: 'timeline', key: 'workspace-boards-timeline', label: 'Timeline' },
    { icon: 'table_chart', key: 'workspace-boards-table', label: 'Table' }
  ],
  'workspace-boards-kanban': [
    { icon: 'account_tree', key: 'workspace-boards-kanban-group', label: 'Grouping' },
    { icon: 'filter_alt', key: 'workspace-boards-kanban-filter', label: 'Filters' },
    { icon: 'view_column', key: 'workspace-boards-kanban-fields', label: 'Fields' }
  ],
  'workspace-boards-timeline': [
    { icon: 'calendar_view_week', key: 'workspace-boards-timeline-scale', label: 'Scale' },
    { icon: 'swap_horiz', key: 'workspace-boards-timeline-deps', label: 'Dependencies' },
    { icon: 'flag', key: 'workspace-boards-timeline-milestones', label: 'Milestones' }
  ],
  'workspace-rooms': [
    { hasSubmenu: true, icon: 'tag', key: 'workspace-rooms-channels', label: 'Channels' },
    { icon: 'person_add', key: 'workspace-rooms-invites', label: 'Invites' },
    { icon: 'notifications', key: 'workspace-rooms-alerts', label: 'Alerts' }
  ],
  'workspace-rooms-channels': [
    { icon: 'lock', key: 'workspace-rooms-channels-private', label: 'Private' },
    { icon: 'public', key: 'workspace-rooms-channels-public', label: 'Public' },
    { icon: 'inventory_2', key: 'workspace-rooms-channels-archived', label: 'Archived' }
  ]
}

const markSelected = (items: LabMenuItem[], selectedKeys: string[]) =>
  items.map(item => isDividerItem(item) ? item : { ...item, selected: selectedKeys.includes(item.key) })

const getFirstActionItemKey = (items: LabMenuItem[]) => items.find(item => !isDividerItem(item))?.key

const selectedKeyList = (key: string | null) => key == null ? [] : [key]

const getSelectedItemIndex = (items: LabMenuItem[] | undefined, selectedKey: string | null) => {
  if (items == null || selectedKey == null) return 0

  const selectedIndex = items.findIndex(item => !isDividerItem(item) && item.key === selectedKey)
  return selectedIndex < 0 ? 0 : selectedIndex
}

const getNestedPanelOffsetStyle = (offsetRows: number) =>
  offsetRows <= 0 ? undefined : { marginTop: `calc(${offsetRows} * var(--overlay-lab-nested-row-offset))` }

const getNestedFirstChildKey = (parentKey: string | null) =>
  parentKey == null ? null : getFirstActionItemKey(nestedItemsByParentKey[parentKey] ?? []) ?? null

const getNestedMenuKeysFrom = (
  currentKeys: NestedMenuKeys,
  itemKey: string,
  level: NestedMenuLevel
): NestedMenuKeys => {
  const nextKeys = { ...currentKeys }

  if (level <= 1) {
    nextKeys.level1 = itemKey
    nextKeys.level2 = getNestedFirstChildKey(itemKey)
    nextKeys.level3 = getNestedFirstChildKey(nextKeys.level2)
    nextKeys.level4 = getNestedFirstChildKey(nextKeys.level3)
    return nextKeys
  }

  if (level <= 2) {
    nextKeys.level2 = itemKey
    nextKeys.level3 = getNestedFirstChildKey(itemKey)
    nextKeys.level4 = getNestedFirstChildKey(nextKeys.level3)
    return nextKeys
  }

  if (level <= 3) {
    nextKeys.level3 = itemKey
    nextKeys.level4 = getNestedFirstChildKey(itemKey)
    return nextKeys
  }

  nextKeys.level4 = itemKey
  return nextKeys
}

const filterSearchableMenuItems = (
  items: LabMenuItem[],
  query: string,
  mode: 'active' | 'all'
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const activeKeys = new Set(['inbox', 'projects', 'team', 'drafts', 'reports'])

  return items.filter(item => {
    if (isDividerItem(item)) return true
    if (mode === 'active' && !activeKeys.has(item.key)) return false
    return normalizedQuery.length === 0 || item.label.toLocaleLowerCase().includes(normalizedQuery)
  })
}

function LabDropdownScenarios() {
  const [activeDropdownKey, setActiveDropdownKey] = useState<LabDropdownKey | null>(null)
  const [dropdownSelectedKey, setDropdownSelectedKey] = useState('archive')
  const [dropdownShareOpen, setDropdownShareOpen] = useState(false)
  const [dropdownSubmenuPlacement, setDropdownSubmenuPlacement] = useState<'left' | 'right'>('right')
  const [nestedDropdownKeys, setNestedDropdownKeys] = useState<NestedMenuKeys>({
    level1: 'workspace',
    level2: 'workspace-boards',
    level3: 'workspace-boards-kanban',
    level4: 'workspace-boards-kanban-group'
  })
  const dropdownCompositeRef = useRef<HTMLDivElement | null>(null)
  const dropdownShareOpenRef = useRef(dropdownShareOpen)

  const selectNestedDropdownItem = (level: NestedMenuLevel, item: LabMenuActionItem) => {
    setNestedDropdownKeys(keys => getNestedMenuKeysFrom(keys, item.key, level))
  }
  const resolveDropdownSubmenuPlacement = useCallback((
    mainPanelRight: number,
    currentPlacement?: 'left' | 'right'
  ): 'left' | 'right' => {
    const availableInlineSize = window.innerWidth - mainPanelRight
    const requiredInlineSize = dropdownPanelGap + dropdownSubmenuPanelWidth

    if (currentPlacement === 'left') {
      return availableInlineSize > requiredInlineSize + dropdownPlacementHysteresis ? 'right' : 'left'
    }

    return availableInlineSize < requiredInlineSize ? 'left' : 'right'
  }, [])
  const measureDropdownSubmenuPlacementFromElement = useCallback((
    element: HTMLDivElement | null,
    currentPlacement?: 'left' | 'right'
  ): 'left' | 'right' | null => {
    const mainPanel = element?.querySelector('.overlay-lab-dropdown-composite__panel--main')
    if (mainPanel == null) return null

    const rect = mainPanel.getBoundingClientRect()
    const style = getComputedStyle(mainPanel)
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
      return null
    }

    return resolveDropdownSubmenuPlacement(rect.right, currentPlacement)
  }, [resolveDropdownSubmenuPlacement])
  const measureDropdownSubmenuPlacement = useCallback(
    (currentPlacement?: 'left' | 'right') => {
      const visibleComposite = Array.from(
        document.querySelectorAll<HTMLDivElement>('.overlay-lab-dropdown-composite')
      ).reverse().find((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
      })

      return measureDropdownSubmenuPlacementFromElement(
        visibleComposite ?? dropdownCompositeRef.current,
        currentPlacement
      )
    },
    [measureDropdownSubmenuPlacementFromElement]
  )
  const updateDropdownPlacementFromTrigger = useCallback((
    event: ReactMouseEvent<HTMLElement>,
    alignment: 'left' | 'right'
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const mainPanelRight = alignment === 'right'
      ? rect.right
      : rect.left + dropdownPanelWidth
    setDropdownSubmenuPlacement(resolveDropdownSubmenuPlacement(mainPanelRight))
  }, [resolveDropdownSubmenuPlacement])
  const updateDropdownPlacementFromContextPoint = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setDropdownSubmenuPlacement(resolveDropdownSubmenuPlacement(event.clientX + dropdownPanelWidth))
  }, [resolveDropdownSubmenuPlacement])
  const syncDropdownSubmenuPlacement = useCallback((element: HTMLDivElement | null) => {
    dropdownCompositeRef.current = element
    if (element == null) return

    let attempts = 0

    const updatePlacement = () => {
      if (!element.isConnected || dropdownShareOpenRef.current) return

      setDropdownSubmenuPlacement((currentPlacement) => {
        const placement = measureDropdownSubmenuPlacementFromElement(element, currentPlacement)
        return placement == null || currentPlacement === placement ? currentPlacement : placement
      })

      attempts += 1
      if (attempts < dropdownPlacementSyncFrameCount) {
        window.requestAnimationFrame(updatePlacement)
      }
    }

    window.requestAnimationFrame(updatePlacement)
  }, [measureDropdownSubmenuPlacementFromElement])
  const handleControlledDropdownOpenChange = (key: LabDropdownKey) => (open: boolean) => {
    setActiveDropdownKey(currentKey => open ? key : currentKey === key ? null : currentKey)
    if (open) {
      dropdownShareOpenRef.current = false
      setDropdownShareOpen(false)
    } else {
      dropdownShareOpenRef.current = false
      setDropdownShareOpen(false)
      setDropdownSubmenuPlacement('right')
    }
  }
  const handleDropdownItemClick = (item: LabMenuActionItem) => {
    if (item.key === 'share') {
      setDropdownSubmenuPlacement((currentPlacement) => {
        const placement = measureDropdownSubmenuPlacement(currentPlacement)
        return placement ?? currentPlacement
      })
      setDropdownShareOpen(open => {
        const nextOpen = !open
        dropdownShareOpenRef.current = nextOpen
        return nextOpen
      })
      return
    }

    setDropdownSelectedKey(item.key)
    dropdownShareOpenRef.current = false
    setDropdownShareOpen(false)
  }
  const directedDropdownItems = useMemo(() =>
    dropdownMenuItems.map(item =>
      isDividerItem(item) || item.key !== 'share'
        ? item
        : { ...item, submenuPlacement: dropdownSubmenuPlacement }
    ), [dropdownSubmenuPlacement])
  const dropdownMainPanel = (
    <div className='overlay-lab-dropdown-composite__panel overlay-lab-dropdown-composite__panel--main'>
      <LabMenu
        items={markSelected(directedDropdownItems, [dropdownSelectedKey])}
        onItemClick={handleDropdownItemClick}
      />
    </div>
  )
  const dropdownSharePanel = dropdownShareOpen
    ? (
      <div
        className={[
          'overlay-lab-dropdown-composite__panel',
          'overlay-lab-dropdown-composite__panel--submenu',
          dropdownSubmenuPlacement === 'left' ? 'is-enter-from-right' : 'is-enter-from-left'
        ].join(' ')}
      >
        <LabMenu
          items={dropdownShareItems}
          onItemClick={item => {
            setDropdownSelectedKey(item.key)
            dropdownShareOpenRef.current = false
            setDropdownShareOpen(false)
          }}
        />
      </div>
    )
    : null

  const renderDropdownOverlay = () => (
    <div
      ref={syncDropdownSubmenuPlacement}
      className={[
        'overlay-lab-dropdown-composite',
        dropdownSubmenuPlacement === 'left' ? 'is-submenu-left' : ''
      ].filter(Boolean).join(' ')}
    >
      {dropdownSubmenuPlacement === 'left' && dropdownSharePanel}
      {dropdownMainPanel}
      {dropdownSubmenuPlacement !== 'left' && dropdownSharePanel}
    </div>
  )
  const nestedDropdownLevelTwoItems = nestedDropdownKeys.level1 == null
    ? undefined
    : nestedItemsByParentKey[nestedDropdownKeys.level1]
  const nestedDropdownLevelThreeItems = nestedDropdownKeys.level2 == null
    ? undefined
    : nestedItemsByParentKey[nestedDropdownKeys.level2]
  const nestedDropdownLevelFourItems = nestedDropdownKeys.level3 == null
    ? undefined
    : nestedItemsByParentKey[nestedDropdownKeys.level3]
  const nestedDropdownLevelTwoOffsetRows = getSelectedItemIndex(nestedRootItems, nestedDropdownKeys.level1)
  const nestedDropdownLevelThreeOffsetRows = nestedDropdownLevelTwoOffsetRows +
    getSelectedItemIndex(nestedDropdownLevelTwoItems, nestedDropdownKeys.level2)
  const nestedDropdownLevelFourOffsetRows = nestedDropdownLevelThreeOffsetRows +
    getSelectedItemIndex(nestedDropdownLevelThreeItems, nestedDropdownKeys.level3)
  const renderNestedDropdownOverlay = () => (
    <div className='overlay-lab-dropdown-composite overlay-lab-dropdown-composite--nested'>
      <div className='overlay-lab-dropdown-composite__panel overlay-lab-dropdown-composite__panel--nested'>
        <LabMenu
          items={markSelected(nestedRootItems, selectedKeyList(nestedDropdownKeys.level1))}
          onItemClick={item => selectNestedDropdownItem(1, item)}
        />
      </div>
      {nestedDropdownLevelTwoItems != null && (
        <div
          key={`nested-dropdown-level-2-${nestedDropdownKeys.level1}`}
          className='overlay-lab-dropdown-composite__panel overlay-lab-dropdown-composite__panel--nested is-enter-from-left'
          style={getNestedPanelOffsetStyle(nestedDropdownLevelTwoOffsetRows)}
        >
          <LabMenu
            items={markSelected(nestedDropdownLevelTwoItems, selectedKeyList(nestedDropdownKeys.level2))}
            onItemClick={item => selectNestedDropdownItem(2, item)}
          />
        </div>
      )}
      {nestedDropdownLevelThreeItems != null && (
        <div
          key={`nested-dropdown-level-3-${nestedDropdownKeys.level2}`}
          className='overlay-lab-dropdown-composite__panel overlay-lab-dropdown-composite__panel--nested is-enter-from-left'
          style={getNestedPanelOffsetStyle(nestedDropdownLevelThreeOffsetRows)}
        >
          <LabMenu
            items={markSelected(nestedDropdownLevelThreeItems, selectedKeyList(nestedDropdownKeys.level3))}
            onItemClick={item => selectNestedDropdownItem(3, item)}
          />
        </div>
      )}
      {nestedDropdownLevelFourItems != null && (
        <div
          key={`nested-dropdown-level-4-${nestedDropdownKeys.level3}`}
          className='overlay-lab-dropdown-composite__panel overlay-lab-dropdown-composite__panel--nested is-enter-from-left'
          style={getNestedPanelOffsetStyle(nestedDropdownLevelFourOffsetRows)}
        >
          <LabMenu
            items={markSelected(nestedDropdownLevelFourItems, selectedKeyList(nestedDropdownKeys.level4))}
            onItemClick={item => selectNestedDropdownItem(4, item)}
          />
        </div>
      )}
    </div>
  )
  const dropdownOpen = activeDropdownKey != null

  useEffect(() => {
    dropdownShareOpenRef.current = dropdownShareOpen
  }, [dropdownShareOpen])

  useEffect(() => {
    if (!dropdownOpen || dropdownShareOpen) {
      return
    }

    const handleResize = () => {
      setDropdownSubmenuPlacement((currentPlacement) => {
        const placement = measureDropdownSubmenuPlacement(currentPlacement)
        return placement ?? currentPlacement
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [dropdownOpen, dropdownShareOpen, measureDropdownSubmenuPlacement])

  return (
    <>
      <Scenario title='Dropdown triggers' surfaceClassName='overlay-lab__surface--actions'>
        <div className='overlay-lab__actions-row'>
          <Dropdown
            trigger={['contextMenu']}
            destroyOnHidden
            open={activeDropdownKey === 'main-context'}
            overlayClassName='overlay-lab-ant-dropdown'
            popupRender={renderDropdownOverlay}
            onOpenChange={handleControlledDropdownOpenChange('main-context')}
            transitionName=''
            menu={{ items: [] }}
          >
            <button
              type='button'
              className='overlay-lab__context-target'
              onContextMenu={updateDropdownPlacementFromContextPoint}
            >
              {iconNode('ads_click', 'overlay-lab__context-icon')}
              <span>Right click</span>
            </button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            destroyOnHidden
            open={activeDropdownKey === 'main-click'}
            overlayClassName='overlay-lab-ant-dropdown'
            popupRender={renderDropdownOverlay}
            onOpenChange={handleControlledDropdownOpenChange('main-click')}
            transitionName=''
            menu={{ items: [] }}
          >
            <Button
              type='default'
              icon={iconNode('more_horiz', 'overlay-lab__button-icon')}
              onMouseDown={event => updateDropdownPlacementFromTrigger(event, 'left')}
            >
              Dropdown
            </Button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            destroyOnHidden
            open={activeDropdownKey === 'nested-click'}
            overlayClassName='overlay-lab-ant-dropdown'
            popupRender={renderNestedDropdownOverlay}
            onOpenChange={handleControlledDropdownOpenChange('nested-click')}
            transitionName=''
            menu={{ items: [] }}
          >
            <Button
              type='default'
              icon={iconNode('account_tree', 'overlay-lab__button-icon')}
            >
              Multi-level
            </Button>
          </Dropdown>
        </div>
      </Scenario>

      <Scenario
        title='Right edge triggers'
        surfaceClassName='overlay-lab__surface--actions overlay-lab__surface--edge-actions'
      >
        <div className='overlay-lab__actions-row overlay-lab__actions-row--edge'>
          <Dropdown
            trigger={['contextMenu']}
            destroyOnHidden
            placement='bottomRight'
            open={activeDropdownKey === 'edge-context'}
            overlayClassName='overlay-lab-ant-dropdown'
            popupRender={renderDropdownOverlay}
            onOpenChange={handleControlledDropdownOpenChange('edge-context')}
            transitionName=''
            menu={{ items: [] }}
          >
            <button
              type='button'
              className='overlay-lab__context-target'
              onContextMenu={updateDropdownPlacementFromContextPoint}
            >
              {iconNode('ads_click', 'overlay-lab__context-icon')}
              <span>Right edge</span>
            </button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            destroyOnHidden
            placement='bottomRight'
            open={activeDropdownKey === 'edge-click'}
            overlayClassName='overlay-lab-ant-dropdown'
            popupRender={renderDropdownOverlay}
            onOpenChange={handleControlledDropdownOpenChange('edge-click')}
            transitionName=''
            menu={{ items: [] }}
          >
            <Button
              type='default'
              icon={iconNode('more_horiz', 'overlay-lab__button-icon')}
              onMouseDown={event => updateDropdownPlacementFromTrigger(event, 'right')}
            >
              Edge dropdown
            </Button>
          </Dropdown>
        </div>
      </Scenario>
    </>
  )
}

export function ComponentLabRoute() {
  const [activeLabKey, setActiveLabKey] = useState('timeline')
  const [dividerMenuKey, setDividerMenuKey] = useState('favorite')
  const [singleMenuKey, setSingleMenuKey] = useState('archive')
  const [multiMenuKeys, setMultiMenuKeys] = useState(['sidebar', 'terminal', 'files'])
  const [popoverOpen, setPopoverOpen] = useState(true)
  const [popoverMenuKey, setPopoverMenuKey] = useState('archive')
  const [searchBottomQuery, setSearchBottomQuery] = useState('')
  const [searchMenuKey, setSearchMenuKey] = useState('projects')
  const [searchMode, setSearchMode] = useState<'active' | 'all'>('all')
  const [searchPinnedOnly, setSearchPinnedOnly] = useState(false)
  const [searchTopQuery, setSearchTopQuery] = useState('')
  const [selectValue, setSelectValue] = useState('archive')
  const [multiSelectValue, setMultiSelectValue] = useState(['sidebar', 'terminal'])
  const [nestedMenuKeys, setNestedMenuKeys] = useState<NestedMenuKeys>({
    level1: 'workspace',
    level2: 'workspace-boards',
    level3: 'workspace-boards-kanban',
    level4: 'workspace-boards-kanban-group'
  })
  const [submenuParentKey, setSubmenuParentKey] = useState('theme')
  const [submenuValueKey, setSubmenuValueKey] = useState('theme-dark')
  const [, setThemeMode] = useAtom(themeAtom)
  const { resolvedThemeMode } = useResolvedThemeMode()
  const headerThemeMode = resolvedThemeMode
  const contentTitle = activeLabKey === 'timeline' ? 'Timeline' : 'Overlay'
  const themeActionItems = useMemo<RouteContainerHeaderActionItem[]>(() => [
    {
      active: headerThemeMode === 'light',
      activeIcon: 'light_mode',
      activeLabel: 'Light mode active',
      icon: 'light_mode',
      key: 'theme-light',
      label: 'Light mode',
      onSelect: () => setThemeMode('light')
    },
    {
      active: headerThemeMode === 'dark',
      activeIcon: 'dark_mode',
      activeLabel: 'Dark mode active',
      icon: 'dark_mode',
      key: 'theme-dark',
      label: 'Dark mode',
      onSelect: () => setThemeMode('dark')
    }
  ], [headerThemeMode, setThemeMode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', headerThemeMode === 'dark')
  }, [headerThemeMode])

  const toggleMultiMenuKey = (key: string) => {
    setMultiMenuKeys(keys =>
      keys.includes(key)
        ? keys.filter(currentKey => currentKey !== key)
        : [...keys, key]
    )
  }
  const selectSubmenuParentItem = (item: LabMenuActionItem) => {
    setSubmenuParentKey(item.key)
    const childItems = submenuItemsByParentKey[item.key]
    const firstChildKey = childItems == null ? undefined : getFirstActionItemKey(childItems)
    if (firstChildKey != null) {
      setSubmenuValueKey(firstChildKey)
    }
  }
  const selectNestedMenuItem = (level: NestedMenuLevel, item: LabMenuActionItem) => {
    setNestedMenuKeys(keys => getNestedMenuKeysFrom(keys, item.key, level))
  }
  const selectSuffixIcon = iconNode('keyboard_arrow_down', 'overlay-lab-select-arrow')

  const selectOptions = useMemo(() => [
    {
      label: <SelectLabel icon='archive' label='Archive' meta='Selected item line' />,
      value: 'archive'
    },
    {
      label: <SelectLabel icon='star' label='Favorite' meta='Pinned sessions' />,
      value: 'favorite'
    },
    {
      label: <SelectLabel icon='schedule' label='Recent' meta='Last activity' />,
      value: 'recent'
    },
    {
      label: <SelectLabel icon='delete' label='Deleted' meta='Trash view' />,
      value: 'deleted'
    }
  ], [])

  const multiSelectOptions = useMemo(() => [
    {
      label: <SelectLabel icon='view_sidebar' label='Sidebar' />,
      value: 'sidebar'
    },
    {
      label: <SelectLabel icon='terminal' label='Terminal' />,
      value: 'terminal'
    },
    {
      label: <SelectLabel icon='folder_open' label='Files' />,
      value: 'files'
    },
    {
      label: <SelectLabel icon='language' label='Preview' />,
      value: 'preview'
    }
  ], [])
  const topSearchMenuItems = useMemo(() =>
    markSelected(
      filterSearchableMenuItems(searchableMenuItems, searchTopQuery, searchMode),
      [searchMenuKey]
    ), [searchMenuKey, searchMode, searchTopQuery])
  const bottomSearchMenuItems = useMemo(() => {
    const sourceItems = searchPinnedOnly
      ? searchableMenuItems.filter(item =>
        !isDividerItem(item) && ['archive', 'projects', 'reports', 'settings'].includes(item.key)
      )
      : searchableMenuItems

    return markSelected(
      filterSearchableMenuItems(sourceItems, searchBottomQuery, 'all'),
      [searchMenuKey]
    )
  }, [searchBottomQuery, searchMenuKey, searchPinnedOnly])
  const activeSubmenuItems = submenuItemsByParentKey[submenuParentKey]
  const nestedLevelTwoItems = nestedMenuKeys.level1 == null
    ? undefined
    : nestedItemsByParentKey[nestedMenuKeys.level1]
  const nestedLevelThreeItems = nestedMenuKeys.level2 == null
    ? undefined
    : nestedItemsByParentKey[nestedMenuKeys.level2]
  const nestedLevelFourItems = nestedMenuKeys.level3 == null
    ? undefined
    : nestedItemsByParentKey[nestedMenuKeys.level3]
  const nestedLevelTwoOffsetRows = getSelectedItemIndex(nestedRootItems, nestedMenuKeys.level1)
  const nestedLevelThreeOffsetRows = nestedLevelTwoOffsetRows +
    getSelectedItemIndex(nestedLevelTwoItems, nestedMenuKeys.level2)
  const nestedLevelFourOffsetRows = nestedLevelThreeOffsetRows +
    getSelectedItemIndex(nestedLevelThreeItems, nestedMenuKeys.level3)

  return (
    <RouteContainerLayout
      className='overlay-lab'
      bodyClassName='overlay-lab__body'
      contentInset
      header={
        <RouteContainerHeader
          actionItems={themeActionItems}
          icon='widgets'
          leadingActions={false}
          title='Component Lab'
        />
      }
    >
      <section className='overlay-lab__canvas' aria-label='Component design lab'>
        <div className='overlay-lab__workspace'>
          <LabDirectoryTree activeKey={activeLabKey} onSelect={setActiveLabKey} />
          <section className='overlay-lab__content' aria-label={`${contentTitle} group`}>
            <div className='overlay-lab__content-title'>{contentTitle}</div>
            <div
              className={[
                'overlay-lab__stage',
                activeLabKey === 'timeline' ? 'is-timeline' : 'is-overlay'
              ].join(' ')}
            >
              {activeLabKey === 'timeline' ? <ChatHistoryTimelineLab /> : null}
              <LabDropdownScenarios />

              <Scenario title='No active item' surfaceClassName='overlay-lab__surface--floating'>
                <LabMenu items={baseMenuItems} />
              </Scenario>

              <Scenario title='Single selection' surfaceClassName='overlay-lab__surface--floating'>
                <LabMenu
                  items={markSelected(baseMenuItems, [singleMenuKey])}
                  onItemClick={item => setSingleMenuKey(item.key)}
                />
              </Scenario>

              <Scenario title='Multi selection' surfaceClassName='overlay-lab__surface--floating'>
                <LabMenu
                  items={markSelected(multiMenuItems, multiMenuKeys)}
                  multi
                  onItemClick={item => toggleMultiMenuKey(item.key)}
                />
              </Scenario>

              <Scenario title='Dividers' surfaceClassName='overlay-lab__surface--floating'>
                <LabMenu
                  items={markSelected(dividerMenuItems, [dividerMenuKey])}
                  onItemClick={item => setDividerMenuKey(item.key)}
                />
              </Scenario>

              <Scenario title='Search chrome' surfaceClassName='overlay-lab__surface--search'>
                <div className='overlay-lab-search-grid'>
                  <LabSearchMenuPanel
                    searchPlacement='top'
                    searchValue={searchTopQuery}
                    items={topSearchMenuItems}
                    accessory={
                      <Radio.Group
                        className={[
                          'overlay-lab-search-radio',
                          searchMode === 'active' ? 'is-active' : 'is-all'
                        ].join(' ')}
                        aria-label='Search scope'
                        size='small'
                        value={searchMode}
                        onChange={event => setSearchMode(event.target.value as 'active' | 'all')}
                        options={[
                          {
                            label: iconNode('format_list_bulleted', 'overlay-lab-search-radio-icon'),
                            value: 'all'
                          },
                          {
                            label: iconNode('bolt', 'overlay-lab-search-radio-icon'),
                            value: 'active'
                          }
                        ]}
                        optionType='button'
                      />
                    }
                    onSearchChange={setSearchTopQuery}
                    onItemClick={item => setSearchMenuKey(item.key)}
                  />
                  <LabSearchMenuPanel
                    searchPlacement='bottom'
                    searchValue={searchBottomQuery}
                    items={bottomSearchMenuItems}
                    accessory={
                      <>
                        <Button
                          className='overlay-lab-search-icon-button'
                          type='default'
                          icon={iconNode('tune', 'overlay-lab-search-action-icon')}
                          aria-label='Filter'
                        />
                        <Switch
                          className='overlay-lab-search-switch'
                          checked={searchPinnedOnly}
                          onChange={setSearchPinnedOnly}
                          aria-label='Pinned only'
                        />
                      </>
                    }
                    onSearchChange={setSearchBottomQuery}
                    onItemClick={item => setSearchMenuKey(item.key)}
                  />
                </div>
              </Scenario>

              <Scenario title='Single panel tree' surfaceClassName='overlay-lab__surface--tree'>
                <LabSinglePanelTree />
              </Scenario>

              <Scenario title='Rich row controls' surfaceClassName='overlay-lab__surface--rich'>
                <LabRichInteractionPanel />
              </Scenario>

              <Scenario title='Submenu rhythm' surfaceClassName='overlay-lab__surface--submenu'>
                <div className='overlay-lab__submenu-grid'>
                  <div className='overlay-lab-submenu-panel'>
                    <LabMenu
                      items={markSelected(submenuParentItems, [submenuParentKey])}
                      onItemClick={selectSubmenuParentItem}
                    />
                  </div>
                  {activeSubmenuItems != null && (
                    <div
                      key={`submenu-right-${submenuParentKey}`}
                      className='overlay-lab-submenu-panel is-enter-from-left'
                    >
                      <LabMenu
                        items={markSelected(activeSubmenuItems, [submenuValueKey])}
                        onItemClick={item => setSubmenuValueKey(item.key)}
                      />
                    </div>
                  )}
                </div>
              </Scenario>

              <Scenario
                title='Edge submenu'
                surfaceClassName='overlay-lab__surface--submenu overlay-lab__surface--submenu-edge'
              >
                <div className='overlay-lab__submenu-grid overlay-lab__submenu-grid--left'>
                  {activeSubmenuItems != null && (
                    <div
                      key={`submenu-left-${submenuParentKey}`}
                      className='overlay-lab-submenu-panel is-enter-from-right'
                    >
                      <LabMenu
                        items={markSelected(activeSubmenuItems, [submenuValueKey])}
                        onItemClick={item => setSubmenuValueKey(item.key)}
                      />
                    </div>
                  )}
                  <div className='overlay-lab-submenu-panel'>
                    <LabMenu
                      items={markSelected(edgeSubmenuParentItems, [submenuParentKey])}
                      onItemClick={selectSubmenuParentItem}
                    />
                  </div>
                </div>
              </Scenario>

              <Scenario title='Nested levels' surfaceClassName='overlay-lab__surface--submenu'>
                <div className='overlay-lab__submenu-grid overlay-lab__submenu-grid--nested'>
                  <div className='overlay-lab-submenu-panel'>
                    <LabMenu
                      items={markSelected(nestedRootItems, selectedKeyList(nestedMenuKeys.level1))}
                      onItemClick={item => selectNestedMenuItem(1, item)}
                    />
                  </div>
                  {nestedLevelTwoItems != null && (
                    <div
                      key={`nested-level-2-${nestedMenuKeys.level1}`}
                      className='overlay-lab-submenu-panel is-enter-from-left'
                      style={getNestedPanelOffsetStyle(nestedLevelTwoOffsetRows)}
                    >
                      <LabMenu
                        items={markSelected(nestedLevelTwoItems, selectedKeyList(nestedMenuKeys.level2))}
                        onItemClick={item => selectNestedMenuItem(2, item)}
                      />
                    </div>
                  )}
                  {nestedLevelThreeItems != null && (
                    <div
                      key={`nested-level-3-${nestedMenuKeys.level2}`}
                      className='overlay-lab-submenu-panel is-enter-from-left'
                      style={getNestedPanelOffsetStyle(nestedLevelThreeOffsetRows)}
                    >
                      <LabMenu
                        items={markSelected(nestedLevelThreeItems, selectedKeyList(nestedMenuKeys.level3))}
                        onItemClick={item => selectNestedMenuItem(3, item)}
                      />
                    </div>
                  )}
                  {nestedLevelFourItems != null && (
                    <div
                      key={`nested-level-4-${nestedMenuKeys.level3}`}
                      className='overlay-lab-submenu-panel is-enter-from-left'
                      style={getNestedPanelOffsetStyle(nestedLevelFourOffsetRows)}
                    >
                      <LabMenu
                        items={markSelected(nestedLevelFourItems, selectedKeyList(nestedMenuKeys.level4))}
                        onItemClick={item => selectNestedMenuItem(4, item)}
                      />
                    </div>
                  )}
                </div>
              </Scenario>

              <Scenario title='AntD Select' surfaceClassName='overlay-lab__surface--controls'>
                <MobileAwareSelect<string>
                  className='overlay-lab__select'
                  classNames={{ popup: { root: 'overlay-lab-ant-select' } }}
                  suffixIcon={selectSuffixIcon}
                  transitionName=''
                  value={selectValue}
                  options={selectOptions}
                  onChange={setSelectValue}
                />
                <MobileAwareSelect<string[]>
                  mode='multiple'
                  className='overlay-lab__select'
                  classNames={{ popup: { root: 'overlay-lab-ant-select overlay-lab-ant-select--multiple' } }}
                  suffixIcon={selectSuffixIcon}
                  transitionName=''
                  value={multiSelectValue}
                  options={multiSelectOptions}
                  onChange={setMultiSelectValue}
                />
              </Scenario>

              <Scenario title='Popover panel' surfaceClassName='overlay-lab__surface--trigger'>
                <Popover
                  open={popoverOpen}
                  trigger='click'
                  destroyOnHidden
                  placement='bottomLeft'
                  classNames={{ root: 'overlay-lab-ant-popover' }}
                  content={
                    <LabMenu
                      items={markSelected(baseMenuItems.slice(0, 4), [popoverMenuKey])}
                      onItemClick={item => setPopoverMenuKey(item.key)}
                    />
                  }
                  onOpenChange={setPopoverOpen}
                  transitionName=''
                >
                  <Button type='default' icon={iconNode('tooltip', 'overlay-lab__button-icon')}>
                    Popover
                  </Button>
                </Popover>
              </Scenario>
            </div>
          </section>
        </div>
      </section>
    </RouteContainerLayout>
  )
}
