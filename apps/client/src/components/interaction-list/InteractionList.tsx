/* eslint-disable max-lines -- generic interaction list exposes search, filtering, selection, nesting, and row actions together. */
import './InteractionList.scss'

import { Button, Checkbox, Dropdown, Input, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { AnimationEvent, CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { SessionContextMenuContent } from '#~/components/sidebar/SessionContextMenuContent'
import type { SessionContextMenuEntry } from '#~/components/sidebar/SessionContextMenuContent'

export interface InteractionListAction<TItem extends InteractionListItem = InteractionListItem> {
  confirmLabel?: ReactNode
  danger?: boolean
  disabled?: boolean
  icon: IconAsset
  key: string
  label: ReactNode
  type?: 'divider'
  onSelect?: (item: TItem) => void | Promise<void>
}

export interface InteractionListItem {
  badge?: ReactNode
  children?: InteractionListItem[]
  description?: ReactNode
  disabled?: boolean
  icon?: IconAsset
  iconFilled?: boolean
  itemType?: 'groupTitle' | 'listItem'
  key: string
  meta?: ReactNode
  searchText?: string
  tags?: ReactNode[]
  title: ReactNode
  tooltip?: ReactNode
}

export interface InteractionListSearchProps {
  expanded?: boolean
  filterPanel?: ReactNode
  filterToggleIcon?: ReactNode
  placeholder: string
  suffix?: ReactNode
  value: string
  onChange: (value: string) => void
  onExpandedChange?: (expanded: boolean) => void
}

interface InteractionListRow<TItem extends InteractionListItem> {
  ancestorKeys: string[]
  depth: number
  hasChildren: boolean
  item: TItem
  parentKey?: string
  phase?: TreeAnimationPhase
  phaseOwnerKey?: string
}

type TreeAnimationPhase = 'entering' | 'exiting'

export interface InteractionListItemRenderContext<TItem extends InteractionListItem = InteractionListItem> {
  isActive: boolean
  item: TItem
}

export interface InteractionListActionRenderContext<TItem extends InteractionListItem = InteractionListItem>
  extends InteractionListItemRenderContext<TItem>
{
  actions: InteractionListAction<TItem>[]
  defaultAction: ReactNode
  defaultDisclosure: ReactNode
  hasChildren: boolean
  isCollapsed: boolean
  isActionPending: (actionKey: string) => boolean
  runAction: (actionKey: string) => void
  toggleCollapsed: () => void
}

export interface InteractionListSelectionRenderContext<TItem extends InteractionListItem = InteractionListItem> {
  isAllSelected: boolean
  selectableItems: TItem[]
  selectedCount: number
  selectedItems: TItem[]
  selectedKeys: ReadonlySet<string>
  totalCount: number
  clearSelection: () => void
  replaceSelection: (keys: Set<string>) => void
  selectAll: () => void
  toggleSelection: (key: string) => void
}

export interface InteractionListProps<TItem extends InteractionListItem = InteractionListItem> {
  actionDisplay?: 'inline' | 'menu'
  actions?: (item: TItem) => InteractionListAction<TItem>[]
  activeKey?: string
  border?: 'bordered' | 'borderless'
  className?: string
  defaultCollapsedKeys?: string[]
  descriptionPlacement?: 'content' | 'titleHover'
  emptyText: ReactNode
  iconSize?: number | string
  inlineActionLimit?: number
  isTouchInteraction?: boolean
  items: TItem[]
  padding?: 'default' | 'none'
  search?: InteractionListSearchProps
  selectedKeys?: Set<string>
  selectionMode?: boolean
  splitActionHover?: boolean
  showItemDescription?: boolean
  renderItemAction?: (context: InteractionListActionRenderContext<TItem>) => ReactNode
  renderItemContent?: (context: InteractionListItemRenderContext<TItem>) => ReactNode
  renderItemMeta?: (context: InteractionListItemRenderContext<TItem>) => ReactNode
  renderSelectionActions?: (context: InteractionListSelectionRenderContext<TItem>) => ReactNode
  onCollapsedKeysChange?: (keys: Set<string>) => void
  onSelect: (item: TItem) => void
  onSelectionChange?: (keys: Set<string>) => void
  onToggleSelect?: (key: string) => void
}

const flattenItems = <TItem extends InteractionListItem>(
  items: TItem[],
  collapsedKeys: Set<string>,
  treeAnimationPhases: Record<string, TreeAnimationPhase | undefined>,
  depth = 0,
  parentKey?: string,
  ancestorKeys: string[] = [],
  inheritedPhase?: TreeAnimationPhase,
  inheritedPhaseOwnerKey?: string
): Array<InteractionListRow<TItem>> => {
  return items.flatMap((item) => {
    const children = (item.children ?? []) as TItem[]
    const hasChildren = children.length > 0
    const itemPhase = treeAnimationPhases[item.key]
    const row: InteractionListRow<TItem> = {
      ancestorKeys,
      depth,
      hasChildren,
      item,
      parentKey,
      phase: inheritedPhase,
      phaseOwnerKey: inheritedPhaseOwnerKey
    }

    if (!hasChildren || (collapsedKeys.has(item.key) && itemPhase !== 'exiting')) {
      return [row]
    }

    return [
      row,
      ...flattenItems(
        children,
        collapsedKeys,
        treeAnimationPhases,
        depth + 1,
        item.key,
        [...ancestorKeys, item.key],
        inheritedPhase ?? itemPhase,
        inheritedPhaseOwnerKey ?? (itemPhase == null ? undefined : item.key)
      )
    ]
  })
}

const compactInteractionListActions = <TItem extends InteractionListItem>(
  actions: InteractionListAction<TItem>[]
) => {
  const compacted: InteractionListAction<TItem>[] = []
  let previousWasDivider = true
  for (const action of actions) {
    if (action.type === 'divider') {
      if (!previousWasDivider) {
        compacted.push(action)
        previousWasDivider = true
      }
      continue
    }
    compacted.push(action)
    previousWasDivider = false
  }
  while (compacted.at(-1)?.type === 'divider') {
    compacted.pop()
  }
  return compacted
}

export function InteractionList<TItem extends InteractionListItem = InteractionListItem>({
  actionDisplay = 'menu',
  actions,
  activeKey,
  border = 'borderless',
  className,
  defaultCollapsedKeys,
  descriptionPlacement = 'content',
  emptyText,
  iconSize,
  inlineActionLimit = 2,
  isTouchInteraction = false,
  items,
  padding = 'default',
  search,
  selectedKeys = new Set<string>(),
  selectionMode = false,
  splitActionHover = false,
  showItemDescription = true,
  renderItemAction,
  renderItemContent,
  renderItemMeta,
  renderSelectionActions,
  onCollapsedKeysChange,
  onSelect,
  onSelectionChange,
  onToggleSelect
}: InteractionListProps<TItem>) {
  const { t } = useTranslation()
  const [internalSearchExpanded, setInternalSearchExpanded] = useState(false)
  const defaultCollapsedKeysRef = useState(() => new Set(defaultCollapsedKeys ?? []))[0]
  const [collapsedKeys, setCollapsedKeys] = useState(() => (
    defaultCollapsedKeys == null ? new Set<string>() : new Set(defaultCollapsedKeys)
  ))
  const [pendingAction, setPendingAction] = useState<{ actionKey: string; itemKey: string } | null>(null)
  const [treeAnimationPhases, setTreeAnimationPhases] = useState<Record<string, TreeAnimationPhase | undefined>>({})
  const searchExpanded = search?.expanded ?? internalSearchExpanded
  const rows = useMemo(
    () => flattenItems(items, collapsedKeys, treeAnimationPhases),
    [collapsedKeys, items, treeAnimationPhases]
  )
  const selectableItems = useMemo(
    () =>
      rows
        .filter(row => row.phase !== 'exiting')
        .map(row => row.item)
        .filter(item => item.disabled !== true && item.itemType !== 'groupTitle'),
    [rows]
  )
  const selectedItems = useMemo(
    () => selectableItems.filter(item => selectedKeys.has(item.key)),
    [selectableItems, selectedKeys]
  )
  const selectedCount = selectedItems.length
  const isAllSelected = selectableItems.length > 0 && selectedCount === selectableItems.length
  const resolveTooltipTitle = (title: ReactNode) => isTouchInteraction ? undefined : title
  const [openMenu, setOpenMenu] = useState<
    {
      itemKey: string
      source: 'more' | 'row'
    } | null
  >(null)
  const listStyle = iconSize == null
    ? undefined
    : {
      '--interaction-list-icon-size': typeof iconSize === 'number' ? `${iconSize}px` : iconSize
    } as CSSProperties

  useEffect(() => {
    const nextDefaultKeys = defaultCollapsedKeys == null ? new Set<string>() : defaultCollapsedKeysRef
    const missingKeys = Array.from(nextDefaultKeys).filter(key => !collapsedKeys.has(key))
    if (missingKeys.length === 0) return

    setCollapsedKeys((current) => {
      const next = new Set(current)
      missingKeys.forEach(key => next.add(key))
      onCollapsedKeysChange?.(next)
      return next
    })
  }, [collapsedKeys, defaultCollapsedKeys, defaultCollapsedKeysRef, items, onCollapsedKeysChange])

  const setTreeAnimationPhase = (key: string, phase: TreeAnimationPhase) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) {
      setTreeAnimationPhases((current) => {
        if (current[key] == null) return current
        const next = { ...current }
        delete next[key]
        return next
      })
      return
    }

    setTreeAnimationPhases(current => ({
      ...current,
      [key]: phase
    }))
  }

  const clearTreeAnimationPhase = (key: string, phase: TreeAnimationPhase) => {
    setTreeAnimationPhases((current) => {
      if (current[key] !== phase) return current

      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const setSearchExpanded = (expanded: boolean) => {
    setInternalSearchExpanded(expanded)
    search?.onExpandedChange?.(expanded)
  }

  const toggleCollapsed = (key: string) => {
    setTreeAnimationPhase(key, collapsedKeys.has(key) ? 'entering' : 'exiting')
    setCollapsedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      onCollapsedKeysChange?.(next)
      return next
    })
  }

  const runAction = (item: TItem, action: InteractionListAction<TItem>) => {
    if (action.disabled === true || action.onSelect == null) return
    setPendingAction(null)
    setOpenMenu(null)
    void action.onSelect(item)
  }

  const handleConfirmableAction = (item: TItem, action: InteractionListAction<TItem>) => {
    if (action.confirmLabel == null) {
      runAction(item, action)
      return
    }

    if (pendingAction?.itemKey === item.key && pendingAction.actionKey === action.key) {
      runAction(item, action)
      return
    }

    setPendingAction({
      actionKey: action.key,
      itemKey: item.key
    })
  }

  const replaceSelection = (keys: Set<string>) => {
    const nextKeys = new Set(keys)
    if (onSelectionChange != null) {
      onSelectionChange(nextKeys)
      return
    }

    const selectableKeys = new Set(selectableItems.map(item => item.key))
    selectableKeys.forEach((key) => {
      if (selectedKeys.has(key) !== nextKeys.has(key)) {
        onToggleSelect?.(key)
      }
    })
  }

  const toggleSelection = (key: string) => {
    const nextKeys = new Set(selectedKeys)
    if (nextKeys.has(key)) {
      nextKeys.delete(key)
    } else {
      nextKeys.add(key)
    }
    replaceSelection(nextKeys)
  }

  const selectAll = () => {
    replaceSelection(new Set(selectableItems.map(item => item.key)))
  }

  const clearSelection = () => {
    replaceSelection(new Set())
  }

  const selectionActionsNode = selectionMode && renderSelectionActions != null
    ? renderSelectionActions({
      clearSelection,
      isAllSelected,
      replaceSelection,
      selectAll,
      selectableItems,
      selectedCount,
      selectedItems,
      selectedKeys,
      toggleSelection,
      totalCount: selectableItems.length
    })
    : null

  return (
    <div
      className={[
        'interaction-list',
        border === 'bordered' ? 'interaction-list--bordered' : 'interaction-list--borderless',
        padding === 'none' ? 'interaction-list--padding-none' : 'interaction-list--padding-default',
        splitActionHover ? 'interaction-list--split-action-hover' : '',
        descriptionPlacement === 'titleHover' ? 'interaction-list--title-hover-description' : '',
        className
      ].filter(Boolean).join(' ')}
      style={listStyle}
    >
      {search != null && (
        <div className='interaction-list__search-area'>
          <Input
            className='interaction-list__search-input'
            placeholder={search.placeholder}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            prefix={<MaterialSymbol className='interaction-list__search-icon' name='search' />}
            suffix={
              <span className='interaction-list__search-suffix'>
                {search.suffix}
                {search.filterPanel != null && (
                  <Tooltip title={resolveTooltipTitle(t('common.searchActions'))}>
                    <button
                      type='button'
                      className={[
                        'interaction-list__search-toggle',
                        searchExpanded ? 'is-open' : ''
                      ].filter(Boolean).join(' ')}
                      aria-label={t('common.searchActions')}
                      aria-expanded={searchExpanded}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSearchExpanded(!searchExpanded)
                      }}
                    >
                      {search.filterToggleIcon ?? <MaterialSymbol name='tune' />}
                    </button>
                  </Tooltip>
                )}
              </span>
            }
            allowClear
          />
          {search.filterPanel != null && (
            <div
              className={[
                'interaction-list__filter-panel',
                searchExpanded ? 'is-open' : ''
              ].filter(Boolean).join(' ')}
            >
              <div className='interaction-list__filter-panel-inner'>
                {search.filterPanel}
              </div>
            </div>
          )}
        </div>
      )}
      {selectionActionsNode != null && (
        <div className='interaction-list__selection-actions'>
          {selectionActionsNode}
        </div>
      )}
      <div className='interaction-list__scroll'>
        {rows.length === 0
          ? <div className='interaction-list__empty'>{emptyText}</div>
          : (
            <div className='interaction-list__items' role='list'>
              {rows.map(({ depth, hasChildren, item, phase, phaseOwnerKey }) => {
                const isGroupTitle = item.itemType === 'groupTitle'
                const isSelectableItem = item.disabled !== true && !isGroupTitle
                const isActive = !isGroupTitle && activeKey === item.key
                const isCollapsed = collapsedKeys.has(item.key)
                const itemActions = actions?.(item).filter(action =>
                  action.type === 'divider' || action.disabled !== true
                ) ??
                  []
                const visibleActions = itemActions
                  .filter(action => action.type !== 'divider')
                  .slice(0, inlineActionLimit)
                const visibleActionKeys = new Set(visibleActions.map(action => action.key))
                const hasActions = itemActions.some(action => action.type !== 'divider')
                const runActionByKey = (actionKey: string) => {
                  const action = itemActions.find(candidate => candidate.key === actionKey)
                  if (action == null || action.type === 'divider') return
                  handleConfirmableAction(item, action)
                }
                const isActionPending = (actionKey: string) => (
                  pendingAction?.itemKey === item.key && pendingAction.actionKey === actionKey
                )
                const toggleItemCollapsed = () => {
                  if (!hasChildren) return
                  toggleCollapsed(item.key)
                }
                const toContextMenuEntries = (
                  menuActions: InteractionListAction<TItem>[]
                ): SessionContextMenuEntry[] =>
                  menuActions.map(action => {
                    if (action.type === 'divider') {
                      return {
                        icon: '',
                        key: action.key,
                        label: '',
                        onClick: () => undefined,
                        type: 'divider'
                      }
                    }

                    return {
                      confirmLabel: typeof action.confirmLabel === 'string' ? action.confirmLabel : undefined,
                      danger: action.danger,
                      icon: action.icon,
                      key: action.key,
                      label: typeof action.label === 'string' ? action.label : String(action.key),
                      onClick: () => handleConfirmableAction(item, action)
                    }
                  })
                const contextMenuEntries = toContextMenuEntries(compactInteractionListActions(itemActions))
                const moreMenuActions = actionDisplay === 'menu'
                  ? itemActions
                  : itemActions.filter(action => action.type === 'divider' || !visibleActionKeys.has(action.key))
                const moreMenuEntries = toContextMenuEntries(compactInteractionListActions(moreMenuActions))
                const hasMoreMenuActions = moreMenuEntries.some(action => action.type !== 'divider')
                const visibleActionButtons = visibleActions.map(action => {
                  const pending = isActionPending(action.key)
                  const label = pending ? action.confirmLabel ?? action.label : action.label
                  return (
                    <Tooltip key={action.key} title={resolveTooltipTitle(label)}>
                      <Button
                        type='text'
                        size='small'
                        className={[
                          'interaction-list__action',
                          action.danger === true ? 'is-danger' : '',
                          pending ? 'is-confirming' : ''
                        ].filter(Boolean).join(' ')}
                        aria-label={typeof label === 'string' ? label : action.key}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleConfirmableAction(item, action)
                        }}
                      >
                        {renderIconAsset({
                          active: pending,
                          className: 'interaction-list__action-icon',
                          icon: pending && action.confirmLabel != null ? 'check' : action.icon
                        })}
                      </Button>
                    </Tooltip>
                  )
                })
                const defaultAction = hasActions
                  ? (
                    <>
                      {visibleActionButtons}
                      {(actionDisplay === 'menu' || hasMoreMenuActions) && (
                        <Dropdown
                          trigger={['click', 'contextMenu']}
                          open={openMenu?.itemKey === item.key && openMenu.source === 'more'}
                          destroyOnHidden
                          onOpenChange={(open) => {
                            setOpenMenu(open ? { itemKey: item.key, source: 'more' } : null)
                            if (!open) setPendingAction(null)
                          }}
                          popupRender={() => (
                            <SessionContextMenuContent
                              entries={actionDisplay === 'menu' ? contextMenuEntries : moreMenuEntries}
                              pendingAction={pendingAction?.itemKey === item.key ? pendingAction.actionKey : null}
                              onCancelConfirm={() => setPendingAction(null)}
                            />
                          )}
                        >
                          <Tooltip title={resolveTooltipTitle(t('common.moreActions'))}>
                            <Button
                              type='text'
                              size='small'
                              className='interaction-list__action interaction-list__action--more'
                              aria-label={t('common.moreActions')}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MaterialSymbol name='more_horiz' />
                            </Button>
                          </Tooltip>
                        </Dropdown>
                      )}
                    </>
                  )
                  : null
                const defaultDisclosure = hasChildren
                  ? (
                    <Tooltip
                      title={resolveTooltipTitle(
                        isCollapsed ? t('common.expandItem') : t('common.collapseItem')
                      )}
                    >
                      <Button
                        type='text'
                        size='small'
                        className={[
                          'interaction-list__disclosure-action',
                          isCollapsed ? 'is-collapsed' : ''
                        ].filter(Boolean).join(' ')}
                        aria-label={isCollapsed ? t('common.expandItem') : t('common.collapseItem')}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleItemCollapsed()
                        }}
                      >
                        <MaterialSymbol name='chevron_right' />
                      </Button>
                    </Tooltip>
                  )
                  : null
                const actionNode = renderItemAction?.({
                  actions: itemActions,
                  defaultAction,
                  defaultDisclosure,
                  hasChildren,
                  isActionPending,
                  isActive,
                  isCollapsed,
                  item,
                  runAction: runActionByKey,
                  toggleCollapsed: toggleItemCollapsed
                }) ?? defaultAction
                const metaNode = renderItemMeta?.({
                  isActive,
                  item
                }) ?? item.meta
                const defaultContent = (
                  <>
                    {showItemDescription && descriptionPlacement === 'content' && item.description != null && (
                      <div className='interaction-list__description'>{item.description}</div>
                    )}
                    {(item.tags?.length ?? 0) > 0 && (
                      <div className='interaction-list__tags'>
                        {item.tags?.map((tag, index) => (
                          <Tag key={index} className='interaction-list__tag'>
                            {tag}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </>
                )
                const contentNode = renderItemContent == null
                  ? defaultContent
                  : renderItemContent({
                    isActive,
                    item
                  })
                const hasContent = contentNode !== null && contentNode !== undefined && contentNode !== false
                const rowClassName = [
                  'interaction-list__row',
                  depth > 0 ? 'is-tree-child' : '',
                  phase === 'entering' ? 'is-tree-entering' : '',
                  phase === 'exiting' ? 'is-tree-exiting' : ''
                ].filter(Boolean).join(' ')
                const rowContent = (
                  <article
                    className={[
                      'interaction-list__item',
                      isActive ? 'is-active' : '',
                      selectedKeys.has(item.key) ? 'is-selected' : '',
                      item.disabled === true ? 'is-disabled' : '',
                      isGroupTitle ? 'is-group-title' : 'is-list-item',
                      hasChildren ? 'has-children' : '',
                      hasContent ? '' : 'has-no-content'
                    ].filter(Boolean).join(' ')}
                    aria-expanded={hasChildren ? !isCollapsed : undefined}
                    role='listitem'
                    style={{ '--interaction-list-depth': depth } as CSSProperties}
                    onMouseLeave={() => setPendingAction(null)}
                    onClick={() => {
                      if (item.disabled === true) return
                      if (isGroupTitle) {
                        toggleItemCollapsed()
                        return
                      }
                      if (selectionMode) {
                        toggleSelection(item.key)
                        return
                      }
                      onSelect(item)
                    }}
                  >
                    {selectionMode && isSelectableItem && (
                      <div
                        className='interaction-list__select'
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedKeys.has(item.key)}
                          onChange={() => toggleSelection(item.key)}
                        />
                      </div>
                    )}
                    <div className='interaction-list__leading'>
                      {renderIconAsset({
                        active: isActive || item.iconFilled === true,
                        className: 'interaction-list__item-icon interaction-list__item-symbol',
                        icon: item.icon
                      })}
                    </div>
                    <div className='interaction-list__body'>
                      <div className='interaction-list__header'>
                        <div className='interaction-list__title'>
                          <span className='interaction-list__title-text'>
                            {descriptionPlacement === 'titleHover' && item.description != null
                              ? (
                                <span className='interaction-list__title-inline'>
                                  <span className='interaction-list__title-primary'>{item.title}</span>
                                  <span className='interaction-list__title-description'>{item.description}</span>
                                </span>
                              )
                              : item.title}
                          </span>
                        </div>
                        <div className='interaction-list__meta'>
                          {metaNode != null && (
                            <span className='interaction-list__meta-content'>
                              {metaNode}
                            </span>
                          )}
                          {!selectionMode && actionNode != null && (
                            <div className='interaction-list__actions'>
                              {actionNode}
                            </div>
                          )}
                          {!selectionMode && defaultDisclosure != null && (
                            <div className='interaction-list__disclosure-slot'>
                              {defaultDisclosure}
                            </div>
                          )}
                        </div>
                      </div>
                      {hasContent ? contentNode : null}
                    </div>
                    {item.badge != null && (
                      <div className='interaction-list__badge'>{item.badge}</div>
                    )}
                  </article>
                )
                const itemTooltip = item.tooltip == null || item.tooltip === ''
                  ? undefined
                  : resolveTooltipTitle(item.tooltip)
                const rowContentWithTooltip = itemTooltip == null
                  ? rowContent
                  : (
                    <Tooltip title={itemTooltip} placement='right' mouseEnterDelay={0.5}>
                      {rowContent}
                    </Tooltip>
                  )

                const handleRowAnimationEnd = phase == null || phaseOwnerKey == null
                  ? undefined
                  : (event: AnimationEvent<HTMLDivElement>) => {
                    if (event.currentTarget !== event.target) return
                    clearTreeAnimationPhase(phaseOwnerKey, phase)
                  }

                if (!hasActions) {
                  return (
                    <div
                      key={item.key}
                      className={rowClassName}
                      onAnimationEnd={handleRowAnimationEnd}
                    >
                      {rowContentWithTooltip}
                    </div>
                  )
                }

                return (
                  <Dropdown
                    key={item.key}
                    trigger={['contextMenu']}
                    open={openMenu?.itemKey === item.key && openMenu.source === 'row'}
                    destroyOnHidden
                    onOpenChange={(open) => {
                      setOpenMenu(open ? { itemKey: item.key, source: 'row' } : null)
                      if (!open) setPendingAction(null)
                    }}
                    popupRender={() => (
                      <SessionContextMenuContent
                        entries={contextMenuEntries}
                        pendingAction={pendingAction?.itemKey === item.key ? pendingAction.actionKey : null}
                        onCancelConfirm={() => setPendingAction(null)}
                      />
                    )}
                  >
                    <div className={rowClassName} onAnimationEnd={handleRowAnimationEnd}>
                      {rowContentWithTooltip}
                    </div>
                  </Dropdown>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}
