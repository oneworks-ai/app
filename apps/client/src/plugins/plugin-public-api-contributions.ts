/* eslint-disable max-lines -- contribution wire shapes are intentionally explicit and colocated. */
import type { PublicParseState } from './plugin-public-api-values'

import { isPrivatePublicFieldName, parsePublicJsonValue } from './plugin-public-api-generic'
import { getPublicValue, isPublicRecord, parsePublicArray } from './plugin-public-api-values'

type PublicJsonShape =
  | 'json'
  | { fields: Record<string, PublicJsonShape>; unknown?: PublicJsonShape }
  | { items: PublicJsonShape }

const json = 'json' as const
const array = (items: PublicJsonShape): PublicJsonShape => ({ items })
const object = (
  fields: Record<string, PublicJsonShape>,
  unknown?: PublicJsonShape
): PublicJsonShape => ({ fields, unknown })
const jsonFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, json]))
const mergeFields = (...groups: Array<Record<string, PublicJsonShape>>) => Object.assign({}, ...groups)

const LOCALIZED_ENTRY_SHAPE = object(jsonFields('description', 'title'))
const BASE_FIELDS = {
  ...jsonFields('description', 'descriptionI18n', 'roles', 'surfaces', 'titleI18n'),
  i18n: object({}, LOCALIZED_ENTRY_SHAPE)
}
const ACTION_FIELDS = jsonFields(
  'command',
  'danger',
  'disabled',
  'href',
  'icon',
  'id',
  'payload',
  'route',
  'shortcut',
  'title'
)

const MENU_SHAPE = object(mergeFields(
  BASE_FIELDS,
  ACTION_FIELDS,
  jsonFields('selected')
)) as Extract<PublicJsonShape, { fields: Record<string, PublicJsonShape> }>
MENU_SHAPE.fields.children = array(MENU_SHAPE)

const NAV_FOOTER_ACCOUNT_ACTION_SHAPE = object(jsonFields(
  'command',
  'danger',
  'disabled',
  'href',
  'icon',
  'id',
  'payload',
  'route',
  'title'
))
const NAV_FOOTER_ACCOUNT_SHAPE = object({
  ...jsonFields(
    'avatarUrl',
    'command',
    'description',
    'disabled',
    'href',
    'id',
    'initials',
    'name',
    'payload',
    'route',
    'status'
  ),
  actions: array(NAV_FOOTER_ACCOUNT_ACTION_SHAPE)
})
const NAV_FOOTER_ACCOUNT_GROUP_SHAPE = object({
  ...jsonFields('avatarUrl', 'collapsed', 'id', 'initials', 'title'),
  accounts: array(NAV_FOOTER_ACCOUNT_SHAPE)
})
const NAV_FOOTER_POPOVER_SHAPE = object({
  accounts: array(NAV_FOOTER_ACCOUNT_SHAPE),
  actions: array(NAV_FOOTER_ACCOUNT_ACTION_SHAPE),
  groups: array(NAV_FOOTER_ACCOUNT_GROUP_SHAPE)
})
const NAV_FOOTER_SHAPE = object({
  ...MENU_SHAPE.fields,
  accountPopover: NAV_FOOTER_POPOVER_SHAPE
})

const ROUTE_HEADER_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields(
    'active',
    'activeIcon',
    'activeLabel',
    'activeTitle',
    'command',
    'danger',
    'disabled',
    'icon',
    'id',
    'shortcut',
    'targetRoute',
    'targetRoutes',
    'title'
  )
))
const ROUTE_MENU_SHAPE = object({
  ...MENU_SHAPE.fields,
  ...jsonFields('active', 'activeIcon', 'targetRoute', 'targetRoutes')
})
const TAB_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('clientView', 'command', 'icon', 'id', 'placement', 'title')
))
const WORKBENCH_ADD_SHAPE = object({
  ...MENU_SHAPE.fields,
  tab: json
})

const SESSION_MATCH_SHAPE = object(jsonFields(
  'accounts',
  'adapters',
  'anyTags',
  'excludedTagPrefixes',
  'excludedTags',
  'tagPrefixes',
  'tags'
)) as Extract<PublicJsonShape, { fields: Record<string, PublicJsonShape> }>
SESSION_MATCH_SHAPE.fields.anyOf = array(SESSION_MATCH_SHAPE)
const SESSION_ACTION_SHAPE = object({
  ...BASE_FIELDS,
  ...jsonFields(
    'command',
    'danger',
    'disabled',
    'href',
    'icon',
    'id',
    'route',
    'shortcut',
    'title'
  ),
  createSession: object(jsonFields('tags', 'title'))
})
const SESSION_GROUP_SHAPE = object({
  ...BASE_FIELDS,
  ...jsonFields('icon', 'id', 'showWhenEmpty', 'title'),
  actions: array(SESSION_ACTION_SHAPE),
  match: SESSION_MATCH_SHAPE
})

const TOOL_RECORD_ITEM_SHAPE = object(jsonFields(
  'detailPath',
  'metaPath',
  'statusPath',
  'subtitlePath',
  'titlePath'
))
const TOOL_FIELD_SHAPE = object({
  ...jsonFields('format', 'language', 'path', 'title', 'titleI18n'),
  item: TOOL_RECORD_ITEM_SHAPE
})
const TOOL_INPUT_SHAPE = object({
  ...jsonFields('mode'),
  fields: array(TOOL_FIELD_SHAPE)
})
const TOOL_RESULT_SHAPE = object({
  ...jsonFields('format', 'language', 'mode'),
  fields: array(TOOL_FIELD_SHAPE)
})
const TOOL_PRESENTATION_SHAPE = object({
  ...BASE_FIELDS,
  ...jsonFields('icon', 'id', 'origin', 'target', 'title', 'tools'),
  input: TOOL_INPUT_SHAPE,
  result: TOOL_RESULT_SHAPE
})

const SETTINGS_PAGE_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('clientView', 'group', 'icon', 'id', 'pluginConfig', 'schema', 'title', 'uiSchema')
))
const EXTENSION_POINT_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('contributionSchema', 'id', 'title')
))
const EXTENSION_CONTRIBUTION_SHAPE = object(
  mergeFields(BASE_FIELDS, jsonFields('id', 'target', 'title')),
  json
)

const CONTRIBUTION_SHAPES: Record<string, PublicJsonShape> = {
  chatHeaderActions: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('command', 'icon', 'id', 'title')
  ))),
  chatHeaderMoreMenu: array(MENU_SHAPE),
  chatInteractionPanelEmptyActions: array(MENU_SHAPE),
  extensionContributions: array(EXTENSION_CONTRIBUTION_SHAPE),
  extensionPoints: array(EXTENSION_POINT_SHAPE),
  launcherSearchProviders: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('command', 'id', 'title')
  ))),
  navFooterBefore: array(NAV_FOOTER_SHAPE),
  navItems: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('command', 'icon', 'id', 'payload', 'route', 'title')
  ))),
  navMoreMenu: array(MENU_SHAPE),
  roles: json,
  routeHeaderActions: array(ROUTE_HEADER_SHAPE),
  routeMoreMenu: array(ROUTE_MENU_SHAPE),
  routeMoreMenuItems: array(ROUTE_MENU_SHAPE),
  routes: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('clientView', 'icon', 'id', 'routeId', 'title')
  ))),
  routeSidebarContextMenu: array(ROUTE_MENU_SHAPE),
  routeWindowBarActions: array(ROUTE_HEADER_SHAPE),
  sessionGroups: array(SESSION_GROUP_SHAPE),
  settingsPages: array(SETTINGS_PAGE_SHAPE),
  surfaces: json,
  toolUsePresentations: array(TOOL_PRESENTATION_SHAPE),
  workbenchAddMenu: array(WORKBENCH_ADD_SHAPE),
  workbenchTabs: array(TAB_SHAPE),
  workspaceDrawerTabs: array(TAB_SHAPE)
}

const projectPublicJsonShape = (
  value: unknown,
  state: PublicParseState,
  shape: PublicJsonShape
): unknown => {
  if (shape === 'json') return parsePublicJsonValue(value, state)
  if ('items' in shape) {
    const entries = parsePublicArray(value, state, 128)
    if (entries == null) return undefined
    const result: unknown[] = []
    for (const entry of entries) {
      const parsed = projectPublicJsonShape(entry, state, shape.items)
      if (parsed === undefined) return undefined
      result.push(parsed)
    }
    return result
  }
  if (!isPublicRecord(value, state)) return undefined
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value)) {
    if (isPrivatePublicFieldName(key)) return undefined
    const fieldShape = shape.fields[key] ?? shape.unknown
    if (fieldShape == null) return undefined
    const parsed = projectPublicJsonShape(getPublicValue(value, key), state, fieldShape)
    if (parsed === undefined) return undefined
    result[key] = parsed
  }
  return result
}

export const parsePublicContributionField = (
  key: string,
  value: unknown,
  state: PublicParseState
) => {
  const shape = CONTRIBUTION_SHAPES[key]
  return shape == null ? undefined : projectPublicJsonShape(value, state, shape)
}
