/* eslint-disable max-lines -- plugin host components wire shared host UI into plugin views */
import Editor from '@monaco-editor/react'
import { Button, Dropdown, Input, Segmented, Switch } from 'antd'
import type { editor as MonacoEditorNamespace } from 'monaco-editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import useSWR from 'swr'

import type { ChatMessageContent, SessionQueuedMessageMode } from '@oneworks/core'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api.js'
import { Sender } from '#~/components/chat/sender/Sender'
import { ChatStatusBar } from '#~/components/chat/status-bar/ChatStatusBar'
import { InteractionList } from '#~/components/interaction-list'
import type { InteractionListAction, InteractionListItem } from '#~/components/interaction-list'
import { ListSearchInput } from '#~/components/list-search-input'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { useMonacoTheme } from '#~/components/monaco/use-monaco-theme'
import { NativeTabs } from '#~/components/native-tabs'
import {
  OverlayIcon,
  OverlayMenu,
  OverlayPanel,
  OverlaySearchMenu,
  OverlaySearchRow,
  OverlaySegmentedControl,
  OverlaySelectLabel,
  OverlayTree
} from '#~/components/overlay'
import type { OverlayMenuItem, OverlayTreeNode } from '#~/components/overlay'
import { ProjectFileTree } from '#~/components/workspace/project-file-tree/ProjectFileTree'
import type { ProjectFileTreeNode } from '#~/components/workspace/project-file-tree/project-file-tree-types'
import {
  DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT,
  getChatSessionWorkspaceDraftFromConfig
} from '#~/hooks/chat/chat-session-workspace-draft'
import { useChatAdapterAccountSelection } from '#~/hooks/chat/use-chat-adapter-account-selection'
import { useChatEffort } from '#~/hooks/chat/use-chat-effort'
import { useChatModelAdapterSelection } from '#~/hooks/chat/use-chat-model-adapter-selection'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'

import type {
  PluginHostActionItem,
  PluginHostComponentId,
  PluginHostComponentPropsById,
  PluginHostComponentReactApi,
  PluginHostControlOption,
  PluginHostIconComponentProps,
  PluginHostInputComponentProps,
  PluginHostInteractionListAction,
  PluginHostInteractionListComponentProps,
  PluginHostInteractionListItem,
  PluginHostOverlayMenuActionItem,
  PluginHostOverlayMenuItem,
  PluginHostOverlayTreeNode,
  PluginHostProjectFileTreeNode,
  PluginHostSearchInputComponentProps,
  PluginHostSegmentedComponentProps,
  PluginHostSenderComponentProps,
  PluginViewSurface
} from './plugin-manifest'

export interface PluginHostComponentEntry {
  component: PluginHostComponentId
  container: HTMLElement
  id: string
  props?: PluginHostComponentPropsById[PluginHostComponentId]
}

const noop = () => {}

const PLUGIN_HOST_CODE_EDITOR_OPTIONS: MonacoEditorNamespace.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  contextmenu: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
  folding: true,
  glyphMargin: false,
  lineDecorationsWidth: 18,
  lineHeight: 18,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  padding: { bottom: 10, top: 0 },
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  scrollbar: {
    alwaysConsumeMouseWheel: false,
    useShadows: false
  },
  showFoldingControls: 'always',
  tabSize: 2,
  wordWrap: 'on'
}

const getIconSizeClass = (size: PluginHostIconComponentProps['size']) => {
  if (typeof size === 'number') return ''
  return size == null ? 'plugin-host-icon--middle' : `plugin-host-icon--${size}`
}

const renderMaterialIcon = (
  icon?: string,
  className?: string,
  props: Omit<PluginHostIconComponentProps, 'name'> = {}
) => {
  if (icon == null || icon.trim() === '') return undefined
  const ariaLabel = props.ariaLabel?.trim()
  const style: CSSProperties | undefined = typeof props.size === 'number'
    ? { '--plugin-host-icon-size': `${props.size}px` } as CSSProperties
    : undefined

  return (
    <span
      aria-hidden={ariaLabel == null || ariaLabel === '' ? true : undefined}
      aria-label={ariaLabel == null || ariaLabel === '' ? undefined : ariaLabel}
      className={[
        'material-symbols-rounded',
        'plugin-host-icon',
        getIconSizeClass(props.size),
        `plugin-host-icon--tone-${props.tone ?? 'default'}`,
        className
      ].filter(Boolean).join(' ')}
      role={ariaLabel == null || ariaLabel === '' ? undefined : 'img'}
      style={style}
      title={props.title}
    >
      {icon}
    </span>
  )
}

const renderControlOptionLabel = (
  option: PluginHostControlOption,
  iconOnly: boolean | undefined
): ReactNode => {
  const iconNode = renderMaterialIcon(option.icon, 'plugin-host-control__icon')
  const label = option.label ?? option.value
  if (iconOnly) {
    return (
      <span
        className='plugin-host-control__option plugin-host-control__option--icon-only'
        aria-label={label}
        title={label}
      >
        {iconNode ?? <span className='plugin-host-control__fallback-dot' aria-hidden='true' />}
      </span>
    )
  }

  return (
    <span className='plugin-host-control__option' title={label}>
      {iconNode}
      <span className='plugin-host-control__label'>{label}</span>
    </span>
  )
}

function PluginHostIcon(props: PluginHostIconComponentProps) {
  return renderMaterialIcon(props.name, undefined, props)
}

function PluginHostCodeEditor(props: PluginHostComponentPropsById['codeEditor']) {
  const themeName = useMonacoTheme()

  return (
    <div
      aria-label={props.ariaLabel}
      className={[
        'plugin-host-code-editor',
        props.className
      ].filter(Boolean).join(' ')}
      role={props.ariaLabel == null ? undefined : 'region'}
    >
      <Editor
        language={props.language ?? 'plaintext'}
        loading={null}
        onChange={value => props.onChange?.(value ?? '')}
        path={props.path}
        theme={themeName}
        value={props.value}
        options={{
          ...PLUGIN_HOST_CODE_EDITOR_OPTIONS,
          ariaLabel: props.ariaLabel,
          readOnly: props.readOnly ?? false
        }}
      />
    </div>
  )
}

const getPluginHostStringProp = (
  props: PluginHostComponentPropsById['button'],
  key: string
) => {
  const value = (props as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function PluginHostButton(props: PluginHostComponentPropsById['button']) {
  const iconNode = renderMaterialIcon(props.icon, 'plugin-host-control__icon')
  const isIconOnly = props.shape === 'circle' || (iconNode != null && (props.label == null || props.label === ''))
  const iconOnlyStyle: CSSProperties | undefined = isIconOnly
    ? {
      background: 'transparent',
      border: 0,
      boxShadow: 'none',
      height: 'var(--app-chrome-icon-size, 18px)',
      minWidth: 'var(--app-chrome-icon-size, 18px)',
      padding: 0,
      width: 'var(--app-chrome-icon-size, 18px)'
    }
    : undefined

  return (
    <Button
      className={[
        'plugin-host-control',
        'plugin-host-control-button',
        props.className
      ].filter(Boolean).join(' ')}
      aria-label={props.ariaLabel}
      danger={props.danger}
      data-primary={getPluginHostStringProp(props, 'data-primary')}
      data-tooltip={getPluginHostStringProp(props, 'data-tooltip')}
      disabled={props.disabled}
      icon={iconNode}
      onClick={props.onClick}
      shape={isIconOnly ? undefined : props.shape}
      size={props.size}
      style={iconOnlyStyle}
      title={props.title ?? props.label}
      type={props.type}
    >
      {isIconOnly ? null : props.label}
    </Button>
  )
}

const renderActionButton = (
  action: PluginHostActionItem,
  size: PluginHostComponentPropsById['actionBar']['size']
) => (
  <PluginHostButton
    key={action.key}
    danger={action.danger}
    disabled={action.disabled}
    icon={action.icon}
    ariaLabel={action.label}
    onClick={action.onSelect}
    shape='circle'
    size={size ?? 'small'}
    title={action.title ?? action.label}
    type={action.primary === true ? 'primary' : 'text'}
  />
)

function PluginHostActionBar(props: PluginHostComponentPropsById['actionBar']) {
  const actions = props.actions ?? []
  const revealedActions = props.revealedActions ?? []
  const primaryActions = props.primaryActions ?? []
  const style: CSSProperties | undefined = revealedActions.length === 0
    ? undefined
    : {
      '--plugin-host-action-bar-revealed-width': `${revealedActions.length * 34}px`
    } as CSSProperties

  if (actions.length === 0 && revealedActions.length === 0 && primaryActions.length === 0) {
    return null
  }

  return (
    <div
      className={[
        'plugin-host-action-bar',
        revealedActions.length > 0 ? 'has-revealed-actions' : ''
      ].filter(Boolean).join(' ')}
      role='toolbar'
      aria-label={props.ariaLabel}
      style={style}
    >
      {revealedActions.length === 0 ? null : (
        <div className='plugin-host-action-bar__group plugin-host-action-bar__group--revealed'>
          {revealedActions.map(action => renderActionButton(action, props.size))}
        </div>
      )}
      {actions.length === 0 ? null : (
        <div className='plugin-host-action-bar__group'>
          {actions.map(action => renderActionButton(action, props.size))}
        </div>
      )}
      {primaryActions.length === 0 ? null : (
        <div className='plugin-host-action-bar__group plugin-host-action-bar__group--primary'>
          {primaryActions.map(action => renderActionButton(action, props.size))}
        </div>
      )}
    </div>
  )
}

function PluginHostInput(props: PluginHostInputComponentProps) {
  const [value, setValue] = useState(props.value ?? '')

  useEffect(() => {
    setValue(props.value ?? '')
  }, [props.value])

  const handleChange = (nextValue: string) => {
    setValue(nextValue)
    props.onChange?.(nextValue)
  }

  const sharedProps = {
    allowClear: props.allowClear,
    'aria-label': props.ariaLabel,
    autoFocus: props.autoFocus,
    className: 'plugin-host-control plugin-host-control-input',
    disabled: props.disabled,
    onBlur: () => props.onCommit?.(value),
    onPressEnter: () => props.onCommit?.(value),
    placeholder: props.placeholder,
    size: props.size,
    value
  }

  if (props.type === 'textarea') {
    return (
      <Input.TextArea
        {...sharedProps}
        autoSize={props.rows == null ? { minRows: 2, maxRows: 6 } : undefined}
        onChange={event => handleChange(event.target.value)}
        rows={props.rows}
      />
    )
  }

  if (props.type === 'password') {
    return (
      <Input.Password
        {...sharedProps}
        onChange={event => handleChange(event.target.value)}
      />
    )
  }

  return (
    <Input
      {...sharedProps}
      onChange={event => handleChange(event.target.value)}
    />
  )
}

function PluginHostSearchInput(props: PluginHostSearchInputComponentProps) {
  const [value, setValue] = useState(props.value ?? props.defaultValue ?? '')

  useEffect(() => {
    if (props.value !== undefined) {
      setValue(props.value)
    }
  }, [props.value])

  const handleChange = (nextValue: string) => {
    if (props.value === undefined) {
      setValue(nextValue)
    }
    props.onChange?.(nextValue)
  }

  const currentValue = props.value ?? value

  return (
    <ListSearchInput
      allowClear={props.allowClear}
      ariaLabel={props.ariaLabel}
      autoFocus={props.autoFocus}
      className={props.className}
      disabled={props.disabled}
      onChange={handleChange}
      onCommit={props.onCommit}
      placeholder={props.placeholder}
      suffix={props.suffix}
      value={currentValue}
    />
  )
}

const normalizeSelectValue = (
  value: PluginHostComponentPropsById['select']['value'],
  mode: PluginHostComponentPropsById['select']['mode']
) => {
  if (mode === 'multiple') {
    return Array.isArray(value) ? value : []
  }
  return Array.isArray(value) ? value[0] : value
}

function PluginHostSelect(props: PluginHostComponentPropsById['select']) {
  const [value, setValue] = useState<string | string[] | undefined>(() => normalizeSelectValue(props.value, props.mode))
  const options = useMemo(() =>
    props.options.map(option => ({
      disabled: option.disabled,
      label: renderControlOptionLabel(option, false),
      title: option.label ?? option.value,
      value: option.value
    })), [props.options])

  useEffect(() => {
    setValue(normalizeSelectValue(props.value, props.mode))
  }, [props.mode, props.value])

  const handleChange = (nextValue: string | string[] | undefined) => {
    const normalizedValue = props.mode === 'multiple'
      ? (Array.isArray(nextValue) ? nextValue.map(item => String(item)) : [])
      : Array.isArray(nextValue)
      ? String(nextValue[0] ?? '')
      : String(nextValue ?? '')
    setValue(normalizedValue)
    props.onChange?.(normalizedValue)
  }

  return (
    <MobileAwareSelect<string | string[]>
      allowClear={props.allowClear}
      aria-label={props.ariaLabel}
      className='plugin-host-control plugin-host-control-select'
      disabled={props.disabled}
      mobileTitle={props.placeholder ?? props.ariaLabel}
      mode={props.mode}
      onChange={handleChange}
      options={options}
      placeholder={props.placeholder}
      popupMatchSelectWidth={false}
      size={props.size}
      value={value}
    />
  )
}

function PluginHostList(props: PluginHostComponentPropsById['list']) {
  if (props.items.length === 0) {
    return props.empty == null ? null : <div className='plugin-host-list-empty'>{props.empty}</div>
  }

  return (
    <ul className='plugin-host-list' aria-label={props.ariaLabel}>
      {props.items.map(item => (
        <li
          key={item.key}
          className={[
            'plugin-host-list__item',
            item.active === true ? 'is-active' : ''
          ].filter(Boolean).join(' ')}
        >
          <div className='plugin-host-list__content'>{item.content}</div>
          {item.actions == null ? null : (
            <div className='plugin-host-list__actions'>
              {item.actions}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

const renderPluginHostInteractionListAvatar = (
  avatar: NonNullable<PluginHostInteractionListItem['avatar']>
) => (
  <span className='plugin-host-interaction-list-avatar' aria-hidden={avatar.alt == null ? true : undefined}>
    {avatar.src == null || avatar.src.trim() === ''
      ? <span>{avatar.fallback ?? 'AC'}</span>
      : (
        <img
          alt={avatar.alt ?? ''}
          draggable={false}
          src={avatar.src}
        />
      )}
  </span>
)

const toPluginHostInteractionListItem = (
  item: PluginHostInteractionListItem
): InteractionListItem => ({
  badge: item.badge,
  children: item.children?.map(child => toPluginHostInteractionListItem(child)),
  description: item.description,
  disabled: item.disabled,
  icon: item.avatar == null ? item.icon : renderPluginHostInteractionListAvatar(item.avatar),
  iconFilled: item.iconFilled,
  iconState: item.iconState,
  itemType: item.itemType,
  key: item.key,
  meta: item.meta,
  searchText: item.searchText,
  tags: item.tags,
  title: item.title,
  tooltip: item.tooltip
})

const toPluginHostInteractionListAction = (
  action: PluginHostInteractionListAction,
  item: PluginHostInteractionListItem
): InteractionListAction => ({
  confirmLabel: action.confirmLabel,
  danger: action.danger,
  disabled: action.disabled,
  icon: action.icon,
  key: action.key,
  label: action.label,
  onSelect: () => action.onSelect?.(item),
  type: action.type
})

const getPluginHostInteractionListSearchText = (item: PluginHostInteractionListItem): string => {
  if (item.searchText != null) return item.searchText
  return [
    typeof item.title === 'string' ? item.title : '',
    typeof item.description === 'string' ? item.description : ''
  ].join(' ')
}

const filterPluginHostInteractionListItems = (
  items: PluginHostInteractionListItem[],
  query: string
): PluginHostInteractionListItem[] => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return items

  return items.flatMap((item) => {
    if (
      getPluginHostInteractionListSearchText(item).toLowerCase().includes(normalizedQuery)
    ) {
      return [item]
    }

    const filteredChildren = item.children == null
      ? undefined
      : filterPluginHostInteractionListItems(item.children, query)
    if ((filteredChildren?.length ?? 0) > 0) {
      return [{
        ...item,
        ...(filteredChildren == null ? {} : { children: filteredChildren })
      }]
    }
    return []
  })
}

type PluginHostInteractionListInternalProps = PluginHostInteractionListComponentProps & {
  launcherSearchValue?: string
  surface?: PluginViewSurface
}

function PluginHostInteractionList(props: PluginHostInteractionListInternalProps) {
  const isLauncherSurface = props.surface === 'launcher'
  const usesLauncherSearch = isLauncherSurface && props.search != null
  const descriptionPlacement = props.descriptionPlacement ?? (isLauncherSurface ? 'titleHover' : 'content')
  const actionDisplay = isLauncherSurface ? 'menu' : props.actionDisplay ?? 'menu'
  const mode = isLauncherSurface ? 'launcher' : props.mode
  const showItemDescription = props.showItemDescription ?? !isLauncherSurface
  const [uncontrolledSearchValue, setUncontrolledSearchValue] = useState(
    () => props.search?.value ?? props.search?.defaultValue ?? ''
  )
  const searchValue = usesLauncherSearch
    ? props.launcherSearchValue ?? ''
    : props.search?.value ?? uncontrolledSearchValue
  const sourceItems = useMemo(
    () =>
      props.search?.filterItems === false
        ? props.items
        : filterPluginHostInteractionListItems(props.items, searchValue),
    [props.items, props.search?.filterItems, searchValue]
  )
  const items = useMemo(
    () => sourceItems.map(item => toPluginHostInteractionListItem(item)),
    [sourceItems]
  )
  const itemsByKey = useMemo(() => {
    const next = new Map<string, PluginHostInteractionListItem>()
    const visit = (item: PluginHostInteractionListItem) => {
      next.set(item.key, item)
      item.children?.forEach(visit)
    }
    props.items.forEach(visit)
    return next
  }, [props.items])
  const search = props.search == null
    ? undefined
    : {
      filterPanel: undefined,
      placeholder: props.search.placeholder,
      renderInput: usesLauncherSearch ? false : props.search.renderInput,
      suffix: props.search.suffix,
      value: searchValue,
      onChange: (value: string) => {
        if (usesLauncherSearch) return
        setUncontrolledSearchValue(value)
        props.search?.onChange(value)
      }
    }

  return (
    <InteractionList
      actionDisplay={actionDisplay}
      actions={props.actions == null
        ? undefined
        : item => {
          const sourceItem = itemsByKey.get(item.key) ?? (item as PluginHostInteractionListItem)
          return props.actions?.(sourceItem).map(action => toPluginHostInteractionListAction(action, sourceItem)) ?? []
        }}
      activeKey={props.activeKey}
      border={props.border}
      className={[
        'plugin-host-interaction-list',
        props.className
      ].filter(Boolean).join(' ')}
      descriptionPlacement={descriptionPlacement}
      emptyText={props.emptyText}
      iconSize={props.iconSize ?? (isLauncherSurface ? 20 : undefined)}
      inlineActionLimit={props.inlineActionLimit ?? (isLauncherSurface ? 1 : undefined)}
      items={items}
      padding={props.padding ?? (isLauncherSurface ? 'none' : undefined)}
      search={search}
      showItemDescription={showItemDescription}
      splitActionHover={isLauncherSurface ? false : props.splitActionHover ?? true}
      mode={mode}
      onSelect={item => props.onSelect?.(itemsByKey.get(item.key) ?? (item as PluginHostInteractionListItem))}
    />
  )
}

function PluginHostNativeTabs(
  props: PluginHostComponentPropsById['nativeTabs'] & { surface?: PluginViewSurface }
) {
  return (
    <NativeTabs
      activeKey={props.activeKey}
      actions={props.actions}
      ariaLabel={props.ariaLabel}
      className={props.className}
      iconSize={props.iconSize}
      items={props.items}
      onChange={props.onChange}
    />
  )
}

function PluginHostSegmented(props: PluginHostSegmentedComponentProps) {
  const options = props.options.map(option => ({
    disabled: option.disabled,
    label: renderControlOptionLabel(option, props.iconOnly),
    value: option.value
  }))

  return (
    <Segmented
      aria-label={props.ariaLabel}
      block={props.block}
      className={[
        'plugin-host-control',
        'plugin-host-control-segmented',
        props.iconOnly === true ? 'plugin-host-control-segmented--icon-only' : ''
      ].filter(Boolean).join(' ')}
      disabled={props.disabled}
      onChange={(nextValue) => props.onChange?.(String(nextValue))}
      options={options}
      size={props.size}
      value={props.value}
    />
  )
}

function PluginHostSwitch(props: PluginHostComponentPropsById['switch']) {
  return (
    <Switch
      checked={props.checked}
      checkedChildren={props.checkedLabel}
      className='plugin-host-control plugin-host-control-switch'
      disabled={props.disabled}
      onChange={props.onChange}
      size={props.size}
      unCheckedChildren={props.uncheckedLabel}
    />
  )
}

const isPluginOverlayActionItem = (item: PluginHostOverlayMenuItem): item is PluginHostOverlayMenuActionItem =>
  !('type' in item)

const findPluginOverlayActionItem = (
  items: PluginHostOverlayMenuItem[],
  key: string
): PluginHostOverlayMenuActionItem | undefined => {
  for (const item of items) {
    if (isPluginOverlayActionItem(item)) {
      if (item.key === key) return item
      const child = item.children == null ? undefined : findPluginOverlayActionItem(item.children, key)
      if (child != null) return child
    }
  }
  return undefined
}

const toOverlayTrailingIcon = (icon?: string) => (
  icon == null || icon.trim() === ''
    ? undefined
    : <OverlayIcon className='oneworks-overlay-icon--trailing' icon={icon} />
)

const toOverlayMenuItem = (item: PluginHostOverlayMenuItem): OverlayMenuItem => {
  if ('type' in item) {
    return item
  }

  return {
    children: item.children?.map(toOverlayMenuItem),
    confirmLabel: item.confirmLabel,
    description: item.description,
    disabled: item.disabled,
    icon: item.icon,
    key: item.key,
    label: item.label,
    selected: item.selected,
    shortcut: item.shortcut,
    submenuPlacement: item.submenuPlacement,
    tone: item.tone,
    trailing: toOverlayTrailingIcon(item.trailingIcon)
  }
}

const toOverlayMenuItems = (items: PluginHostOverlayMenuItem[]) => items.map(toOverlayMenuItem)

function PluginHostOverlayMenu(props: PluginHostComponentPropsById['overlayMenu']) {
  const items = useMemo(() => toOverlayMenuItems(props.items), [props.items])
  return (
    <OverlayMenu
      alignSubmenus={props.alignSubmenus}
      defaultOpenKeys={props.defaultOpenKeys}
      items={items}
      multi={props.multi}
      openKeys={props.openKeys}
      selectedKeys={props.selectedKeys}
      submenuPlacement={props.submenuPlacement}
      submenuTrigger={props.submenuTrigger}
      surface={props.surface}
      width={props.width}
      onItemClick={(item) => {
        const pluginItem = findPluginOverlayActionItem(props.items, item.key)
        if (pluginItem != null) {
          props.onItemClick?.(pluginItem)
        }
      }}
      onOpenKeysChange={props.onOpenKeysChange}
    />
  )
}

function PluginHostOverlaySearchMenu(props: PluginHostComponentPropsById['overlaySearchMenu']) {
  const [searchValue, setSearchValue] = useState(props.searchValue ?? '')
  const items = useMemo(() => toOverlayMenuItems(props.items), [props.items])

  useEffect(() => {
    setSearchValue(props.searchValue ?? '')
  }, [props.searchValue])

  const handleSearchChange = (nextValue: string) => {
    setSearchValue(nextValue)
    props.onSearchChange?.(nextValue)
  }

  return (
    <OverlaySearchMenu
      emptyLabel={props.emptyLabel}
      items={items}
      placeholder={props.placeholder}
      searchPlacement={props.searchPlacement}
      searchValue={searchValue}
      selectedKeys={props.selectedKeys}
      onItemClick={(item) => {
        const pluginItem = findPluginOverlayActionItem(props.items, item.key)
        if (pluginItem != null) {
          props.onItemClick?.(pluginItem)
        }
      }}
      onSearchChange={handleSearchChange}
    />
  )
}

function PluginHostOverlaySearchRow(props: PluginHostComponentPropsById['overlaySearchRow']) {
  const [value, setValue] = useState(props.value ?? '')

  useEffect(() => {
    setValue(props.value ?? '')
  }, [props.value])

  const handleChange = (nextValue: string) => {
    setValue(nextValue)
    props.onChange?.(nextValue)
  }

  const handleClear = () => {
    setValue('')
    props.onClear?.()
    props.onChange?.('')
  }

  return (
    <OverlaySearchRow
      autoFocus={props.autoFocus}
      clearLabel={props.clearLabel}
      placeholder={props.placeholder}
      value={value}
      onChange={handleChange}
      onClear={handleClear}
    />
  )
}

function PluginHostOverlaySegmented(props: PluginHostComponentPropsById['overlaySegmented']) {
  return (
    <OverlaySegmentedControl
      ariaLabel={props.ariaLabel}
      options={props.options}
      value={props.value ?? props.options[0]?.value ?? ''}
      onChange={(nextValue) => props.onChange?.(nextValue)}
    />
  )
}

const findPluginOverlayTreeNode = (
  nodes: PluginHostOverlayTreeNode[],
  key: string
): PluginHostOverlayTreeNode | undefined => {
  for (const node of nodes) {
    if (node.key === key) return node
    const child = node.children == null ? undefined : findPluginOverlayTreeNode(node.children, key)
    if (child != null) return child
  }
  return undefined
}

const toOverlayTreeNode = (node: PluginHostOverlayTreeNode): OverlayTreeNode<PluginHostOverlayTreeNode> => ({
  children: node.children?.map(toOverlayTreeNode),
  collapsedIcon: node.collapsedIcon,
  confirmLabel: node.confirmLabel,
  data: node,
  disabled: node.disabled,
  expandedIcon: node.expandedIcon,
  icon: node.icon,
  key: node.key,
  label: node.label,
  meta: node.meta,
  selected: node.selected,
  title: node.title,
  trailing: toOverlayTrailingIcon(node.trailingIcon)
})

function PluginHostOverlayTree(props: PluginHostComponentPropsById['overlayTree']) {
  const [collapsedKeys, setCollapsedKeys] = useState(() => props.collapsedKeys ?? props.defaultCollapsedKeys ?? [])
  const nodes = useMemo(() => props.nodes.map(toOverlayTreeNode), [props.nodes])
  const activeCollapsedKeys = props.collapsedKeys ?? collapsedKeys

  useEffect(() => {
    if (props.collapsedKeys != null) {
      setCollapsedKeys(props.collapsedKeys)
    }
  }, [props.collapsedKeys])

  const handleNodeToggle = (key: string) => {
    if (props.collapsedKeys == null) {
      setCollapsedKeys(current => (
        current.includes(key)
          ? current.filter(item => item !== key)
          : [...current, key]
      ))
    }
    props.onNodeToggle?.(key)
  }

  const tree = (
    <OverlayTree
      collapsedKeys={activeCollapsedKeys}
      expandAll={props.expandAll}
      nodes={nodes}
      onNodeActivate={(node) => {
        const pluginNode = node.data ?? findPluginOverlayTreeNode(props.nodes, node.key)
        if (pluginNode != null) {
          props.onNodeActivate?.(pluginNode)
        }
      }}
      onNodeToggle={handleNodeToggle}
    />
  )

  if (props.surface === true) {
    return <OverlayPanel>{tree}</OverlayPanel>
  }

  return tree
}

function PluginHostOverlayDropdown(props: PluginHostComponentPropsById['overlayDropdown']) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? false)
  const activeOpen = props.open ?? uncontrolledOpen
  const closeOnSelect = props.closeOnSelect ?? true

  const setOpen = (nextOpen: boolean) => {
    if (props.open == null) {
      setUncontrolledOpen(nextOpen)
    }
    props.onOpenChange?.(nextOpen)
  }
  const closeAfterSelect = () => {
    if (closeOnSelect) {
      setOpen(false)
    }
  }
  const renderOverlayContent = () => {
    if (props.content.type === 'menu') {
      const contentProps = props.content.props
      return (
        <PluginHostOverlayMenu
          {...contentProps}
          surface={contentProps.surface ?? true}
          onItemClick={(item) => {
            contentProps.onItemClick?.(item)
            closeAfterSelect()
          }}
        />
      )
    }

    if (props.content.type === 'searchMenu') {
      const contentProps = props.content.props
      return (
        <PluginHostOverlaySearchMenu
          {...contentProps}
          onItemClick={(item) => {
            contentProps.onItemClick?.(item)
            closeAfterSelect()
          }}
        />
      )
    }

    const contentProps = props.content.props
    return (
      <PluginHostOverlayTree
        {...contentProps}
        surface={contentProps.surface ?? true}
        onNodeActivate={(node) => {
          contentProps.onNodeActivate?.(node)
          closeAfterSelect()
        }}
      />
    )
  }

  return (
    <Dropdown
      destroyOnHidden
      menu={{ items: [] }}
      open={activeOpen}
      overlayClassName='plugin-host-overlay-dropdown'
      placement={props.placement ?? 'bottomLeft'}
      popupRender={renderOverlayContent}
      trigger={['click']}
      transitionName=''
      onOpenChange={setOpen}
    >
      <Button
        className={[
          'plugin-host-control',
          'plugin-host-control-button',
          'plugin-host-overlay-trigger',
          activeOpen ? 'is-open' : ''
        ].filter(Boolean).join(' ')}
        disabled={props.disabled}
        title={props.title ?? props.label}
      >
        <span className='plugin-host-overlay-trigger__main'>
          {renderMaterialIcon(props.icon ?? 'select_window', 'plugin-host-control__icon')}
          <span className='plugin-host-control__label'>{props.label}</span>
        </span>
        {renderMaterialIcon('expand_more', 'plugin-host-overlay-trigger__chevron')}
      </Button>
    </Dropdown>
  )
}

function PluginHostOverlaySelectLabel(props: PluginHostComponentPropsById['overlaySelectLabel']) {
  return (
    <OverlaySelectLabel
      icon={props.icon}
      label={props.label}
      meta={props.meta}
    />
  )
}

const toSenderSubmitResult = async (result: unknown) => {
  const value = await result
  return typeof value === 'boolean' ? value : undefined
}

function PluginSenderHost(props: PluginHostSenderComponentProps) {
  const workspaceDraftDirtyRef = useRef(false)
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const defaultWorkspaceDraft = useMemo(() => (
    configRes == null ? DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT : getChatSessionWorkspaceDraftFromConfig(configRes)
  ), [configRes])
  const [workspaceDraft, setWorkspaceDraft] = useState(() => ({ ...DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT }))
  const {
    adapterOptions,
    hasAvailableModels,
    hiddenBuiltinAdapterOptions,
    builtinPreviewModelOptions,
    modelMenuGroups,
    modelSearchOptions,
    recommendedModelOptions,
    selectedAdapter,
    selectedModel,
    selectedModelWithService,
    applySessionSelection,
    servicePreviewModelOptions,
    setSelectedAdapter,
    setSelectedModel,
    toggleRecommendedModel,
    updatingRecommendedModelValue
  } = useChatModelAdapterSelection({ adapterLocked: props.adapterLocked === true })
  const {
    accountOptions,
    selectedAccount,
    setSelectedAccount,
    showAccountSelector
  } = useChatAdapterAccountSelection({
    adapter: selectedAdapter,
    model: selectedModelWithService
  })
  const { effort, setEffort, effortOptions } = useChatEffort({
    adapter: selectedAdapter,
    model: selectedModelWithService
  })
  const { permissionMode, setPermissionMode, permissionModeOptions } = useChatPermissionMode()
  const modelUnavailable = props.modelUnavailable ?? !hasAvailableModels
  const showStatusBar = props.showStatusBar ?? props.hideSelectionControls !== true
  const defaultSelectionKeyRef = useRef<string | null>(null)
  const density = props.density === 'compact' ? 'compact' : 'default'
  const surface = props.surface === 'plain' ? 'plain' : 'chat'
  const className = [
    'sender-container',
    surface === 'chat' ? 'sender-container--chat-surface' : '',
    density === 'compact' ? 'sender-container--density-compact' : '',
    'plugin-host-component-sender'
  ].filter(Boolean).join(' ')

  useEffect(() => {
    if (workspaceDraftDirtyRef.current) return
    setWorkspaceDraft({ ...defaultWorkspaceDraft })
  }, [defaultWorkspaceDraft])

  useEffect(() => {
    if (configRes == null) return

    const defaultAdapter = props.defaultAdapter?.trim()
    const defaultModel = props.defaultModel?.trim()
    const defaultSelectionKey = `${defaultAdapter ?? ''}\n${defaultModel ?? ''}`
    if (defaultSelectionKey === '\n' || defaultSelectionKeyRef.current === defaultSelectionKey) return

    defaultSelectionKeyRef.current = defaultSelectionKey
    applySessionSelection({
      adapter: defaultAdapter,
      model: defaultModel
    })
  }, [applySessionSelection, configRes, props.defaultAdapter, props.defaultModel])

  const handleSend = (text: string, mode?: SessionQueuedMessageMode) => toSenderSubmitResult(props.onSend?.(text, mode))
  const handleSendContent = (content: ChatMessageContent[], mode?: SessionQueuedMessageMode) =>
    toSenderSubmitResult(props.onSendContent?.(content, mode))

  return (
    <div className={className}>
      <Sender
        autoFocus={props.autoFocus}
        hideHeaderControls={props.showHeader === false}
        hideReferenceActions={props.hideReferenceActions}
        hideSelectionControls={props.hideSelectionControls}
        hideSubmitAction={props.hideSubmitAction}
        initialContent={props.initialContent}
        modelUnavailable={modelUnavailable}
        onCancel={props.onCancel}
        onClear={noop}
        onInputChange={props.onInputChange}
        onInterrupt={noop}
        onSend={handleSend}
        onSendContent={handleSendContent}
        placeholder={props.placeholder}
        adapterLocked={props.adapterLocked}
        adapterOptions={adapterOptions}
        builtinPreviewModelOptions={builtinPreviewModelOptions}
        effort={effort}
        effortOptions={effortOptions}
        hiddenBuiltinAdapterOptions={hiddenBuiltinAdapterOptions}
        modelMenuGroups={modelMenuGroups}
        modelSearchOptions={modelSearchOptions}
        onAdapterChange={setSelectedAdapter}
        onEffortChange={setEffort}
        onModelChange={setSelectedModel}
        onPermissionModeChange={setPermissionMode}
        onToggleRecommendedModel={toggleRecommendedModel}
        permissionMode={permissionMode}
        permissionModeOptions={permissionModeOptions}
        recommendedModelOptions={recommendedModelOptions}
        selectedAdapter={selectedAdapter}
        selectedModel={selectedModel}
        servicePreviewModelOptions={servicePreviewModelOptions}
        stopLoading={props.stopLoading}
        submitLabel={props.submitLabel}
        submitLoading={props.submitLoading}
        updatingRecommendedModelValue={updatingRecommendedModelValue}
      />
      {showStatusBar && (
        <ChatStatusBar
          adapterLocked={props.adapterLocked}
          adapterOptions={adapterOptions}
          draftWorkspace={workspaceDraft}
          hiddenBuiltinAdapterOptions={hiddenBuiltinAdapterOptions}
          isCreating={props.submitLoading === true}
          modelUnavailable={modelUnavailable}
          collapsible={surface === 'chat'}
          selectedAccount={selectedAccount}
          selectedAdapter={selectedAdapter}
          accountOptions={accountOptions}
          showAccountSelector={showAccountSelector}
          onAccountChange={setSelectedAccount}
          onAdapterChange={setSelectedAdapter}
          onDraftWorkspaceChange={(nextDraft) => {
            workspaceDraftDirtyRef.current = true
            setWorkspaceDraft(nextDraft)
          }}
        />
      )}
    </div>
  )
}

const toPluginProjectFileTreeNode = (node: ProjectFileTreeNode): PluginHostProjectFileTreeNode => ({
  children: node.children?.map(toPluginProjectFileTreeNode),
  isDirectory: node.type === 'directory',
  name: node.name,
  path: node.path,
  type: node.type
})

const toPluginProjectFileTreeNodes = (nodes: ProjectFileTreeNode[]) => nodes.map(toPluginProjectFileTreeNode)

function PluginHostProjectFileTree(props: PluginHostComponentPropsById['projectFileTree']) {
  return (
    <ProjectFileTree
      activePath={props.activePath}
      className='plugin-host-component-file-tree'
      onOpenFile={props.onOpenFile}
      onReferenceNodes={(nodes) => props.onReferenceNodes?.(toPluginProjectFileTreeNodes(nodes))}
      onSelectionChange={(selection) =>
        props.onSelectionChange?.({
          nodes: toPluginProjectFileTreeNodes(selection.nodes),
          paths: selection.paths
        })}
      refreshKey={props.refreshKey}
      selectableTypes={props.selectableTypes}
      selectedPaths={props.selectedPaths}
      selectionMode={props.selectionMode}
      sessionId={props.sessionId}
      showContextMenu={props.showContextMenu}
      showLoadingState={props.showLoadingState}
    />
  )
}

export const createPluginHostComponentReactApi = (
  surface: PluginViewSurface = 'route',
  options: { launcherSearchValue?: string } = {}
): PluginHostComponentReactApi => ({
  ActionBar: PluginHostActionBar,
  Button: PluginHostButton,
  CodeEditor: PluginHostCodeEditor,
  Icon: PluginHostIcon,
  Input: PluginHostInput,
  InteractionList: props => (
    <PluginHostInteractionList
      {...props}
      launcherSearchValue={options.launcherSearchValue}
      surface={surface}
    />
  ),
  List: PluginHostList,
  NativeTabs: props => <PluginHostNativeTabs {...props} surface={surface} />,
  OverlayDropdown: PluginHostOverlayDropdown,
  OverlayMenu: PluginHostOverlayMenu,
  OverlaySearchMenu: PluginHostOverlaySearchMenu,
  OverlaySearchRow: PluginHostOverlaySearchRow,
  OverlaySegmented: PluginHostOverlaySegmented,
  OverlaySelectLabel: PluginHostOverlaySelectLabel,
  OverlayTree: PluginHostOverlayTree,
  ProjectFileTree: PluginHostProjectFileTree,
  SearchInput: PluginHostSearchInput,
  Select: PluginHostSelect,
  Segmented: PluginHostSegmented,
  Sender: PluginSenderHost,
  Switch: PluginHostSwitch
})

export const pluginHostComponentReactApi = createPluginHostComponentReactApi()

export const renderPluginHostComponent = (
  component: PluginHostComponentId,
  props?: PluginHostComponentPropsById[PluginHostComponentId],
  surface: PluginViewSurface = 'route'
) => {
  if (component === 'actionBar') {
    return <PluginHostActionBar {...((props as PluginHostComponentPropsById['actionBar'] | undefined) ?? {})} />
  }

  if (component === 'button') {
    return <PluginHostButton {...((props as PluginHostComponentPropsById['button'] | undefined) ?? {})} />
  }

  if (component === 'codeEditor') {
    return (
      <PluginHostCodeEditor
        {...((props as PluginHostComponentPropsById['codeEditor'] | undefined) ?? { value: '' })}
      />
    )
  }

  if (component === 'icon') {
    const iconProps = props as PluginHostComponentPropsById['icon'] | undefined
    return <PluginHostIcon {...(iconProps ?? { name: 'extension' })} />
  }

  if (component === 'input') {
    return <PluginHostInput {...((props as PluginHostComponentPropsById['input'] | undefined) ?? {})} />
  }

  if (component === 'interactionList') {
    return (
      <PluginHostInteractionList
        {...((props as PluginHostComponentPropsById['interactionList'] | undefined) ?? {
          emptyText: null,
          items: []
        })}
        surface={surface}
      />
    )
  }

  if (component === 'list') {
    return <PluginHostList {...((props as PluginHostComponentPropsById['list'] | undefined) ?? { items: [] })} />
  }

  if (component === 'nativeTabs') {
    return (
      <PluginHostNativeTabs
        {...((props as PluginHostComponentPropsById['nativeTabs'] | undefined) ?? { items: [] })}
        surface={surface}
      />
    )
  }

  if (component === 'searchInput') {
    return <PluginHostSearchInput {...((props as PluginHostComponentPropsById['searchInput'] | undefined) ?? {})} />
  }

  if (component === 'select') {
    return <PluginHostSelect {...((props as PluginHostComponentPropsById['select'] | undefined) ?? { options: [] })} />
  }

  if (component === 'overlayDropdown') {
    return (
      <PluginHostOverlayDropdown
        {...((props as PluginHostComponentPropsById['overlayDropdown'] | undefined) ?? {
          content: { props: { items: [] }, type: 'menu' },
          label: 'Overlay'
        })}
      />
    )
  }

  if (component === 'overlayMenu') {
    return (
      <PluginHostOverlayMenu
        {...((props as PluginHostComponentPropsById['overlayMenu'] | undefined) ?? { items: [] })}
      />
    )
  }

  if (component === 'overlaySearchMenu') {
    return (
      <PluginHostOverlaySearchMenu
        {...((props as PluginHostComponentPropsById['overlaySearchMenu'] | undefined) ?? { items: [] })}
      />
    )
  }

  if (component === 'overlaySearchRow') {
    return <PluginHostOverlaySearchRow
      {...((props as PluginHostComponentPropsById['overlaySearchRow'] | undefined) ?? {})}
    />
  }

  if (component === 'overlaySegmented') {
    return (
      <PluginHostOverlaySegmented
        {...((props as PluginHostComponentPropsById['overlaySegmented'] | undefined) ?? {
          ariaLabel: 'Plugin overlay segmented',
          options: []
        })}
      />
    )
  }

  if (component === 'overlaySelectLabel') {
    return (
      <PluginHostOverlaySelectLabel
        {...((props as PluginHostComponentPropsById['overlaySelectLabel'] | undefined) ?? {
          icon: 'extension',
          label: ''
        })}
      />
    )
  }

  if (component === 'overlayTree') {
    return (
      <PluginHostOverlayTree
        {...((props as PluginHostComponentPropsById['overlayTree'] | undefined) ?? { nodes: [] })}
      />
    )
  }

  if (component === 'segmented') {
    return (
      <PluginHostSegmented
        {...((props as PluginHostComponentPropsById['segmented'] | undefined) ?? { options: [] })}
      />
    )
  }

  if (component === 'sender') {
    return <PluginSenderHost {...((props as PluginHostComponentPropsById['sender'] | undefined) ?? {})} />
  }

  if (component === 'switch') {
    return <PluginHostSwitch {...((props as PluginHostComponentPropsById['switch'] | undefined) ?? {})} />
  }

  if (component === 'projectFileTree') {
    const fileTreeProps = props as PluginHostComponentPropsById['projectFileTree'] | undefined
    return <PluginHostProjectFileTree {...(fileTreeProps ?? {})} />
  }

  throw new Error(`Unknown plugin host component "${component}".`)
}
