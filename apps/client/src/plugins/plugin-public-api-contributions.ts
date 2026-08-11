/* eslint-disable max-lines -- contribution wire shapes are intentionally explicit and colocated. */
import type { PublicParseState } from './plugin-public-api-values'

import {
  isCredentialPublicFieldName,
  isPrivatePublicFieldName,
  parsePublicJsonValue
} from './plugin-public-api-generic'
import {
  getPublicValue,
  hasUnsafePublicUrlMetadata,
  hasUnsafePublicUrlWhitespace,
  isFilesystemShapedPublicValue,
  isPublicRecord,
  parsePublicArray,
  parsePublicAssetString
} from './plugin-public-api-values'

type PublicJsonShape =
  | 'asset'
  | 'generic'
  | 'json'
  | 'route'
  | 'schema'
  | { fields: Record<string, PublicJsonShape>; unknown?: PublicJsonShape }
  | { items: PublicJsonShape }

const json = 'json' as const
const asset = 'asset' as const
const generic = 'generic' as const
const route = 'route' as const
const schema = 'schema' as const
const array = (items: PublicJsonShape): PublicJsonShape => ({ items })
const object = (
  fields: Record<string, PublicJsonShape>,
  unknown?: PublicJsonShape
): PublicJsonShape => ({ fields, unknown })
const jsonFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, json]))
const assetFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, asset]))
const routeFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, route]))
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
  'id',
  'payload',
  'shortcut',
  'title'
)
Object.assign(ACTION_FIELDS, assetFields('icon'), routeFields('href', 'route'))

const MENU_SHAPE = object(mergeFields(
  BASE_FIELDS,
  ACTION_FIELDS,
  jsonFields('selected')
)) as Extract<PublicJsonShape, { fields: Record<string, PublicJsonShape> }>
MENU_SHAPE.fields.children = array(MENU_SHAPE)

const NAV_FOOTER_ACCOUNT_ACTION_SHAPE = object(mergeFields(
  jsonFields('command', 'danger', 'disabled', 'id', 'payload', 'title'),
  assetFields('icon'),
  routeFields('href', 'route')
))
const NAV_FOOTER_ACCOUNT_SHAPE = object(mergeFields(
  jsonFields(
    'command',
    'description',
    'disabled',
    'id',
    'initials',
    'name',
    'payload',
    'status'
  ),
  assetFields('avatarUrl'),
  routeFields('href', 'route'),
  { actions: array(NAV_FOOTER_ACCOUNT_ACTION_SHAPE) }
))
const NAV_FOOTER_ACCOUNT_GROUP_SHAPE = object({
  ...jsonFields('collapsed', 'id', 'initials', 'title'),
  ...assetFields('avatarUrl'),
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
    'activeLabel',
    'activeTitle',
    'command',
    'danger',
    'disabled',
    'id',
    'shortcut',
    'title'
  ),
  assetFields('activeIcon', 'icon'),
  routeFields('targetRoute', 'targetRoutes')
))
const ROUTE_MENU_SHAPE = object({
  ...MENU_SHAPE.fields,
  ...jsonFields('active'),
  ...assetFields('activeIcon'),
  ...routeFields('targetRoute', 'targetRoutes')
})
const TAB_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('clientView', 'command', 'id', 'placement', 'title'),
  assetFields('icon')
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
    'id',
    'shortcut',
    'title'
  ),
  ...assetFields('icon'),
  ...routeFields('href', 'route'),
  createSession: object(jsonFields('tags', 'title'))
})
const SESSION_GROUP_SHAPE = object({
  ...BASE_FIELDS,
  ...jsonFields('id', 'showWhenEmpty', 'title'),
  ...assetFields('icon'),
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
  ...jsonFields('id', 'origin', 'target', 'title', 'tools'),
  ...assetFields('icon'),
  input: TOOL_INPUT_SHAPE,
  result: TOOL_RESULT_SHAPE
})

const SETTINGS_PAGE_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('clientView', 'group', 'id', 'title'),
  { pluginConfig: schema, schema, uiSchema: schema },
  assetFields('icon')
))
const EXTENSION_POINT_SHAPE = object(mergeFields(
  BASE_FIELDS,
  jsonFields('id', 'title'),
  { contributionSchema: schema }
))
const EXTENSION_CONTRIBUTION_SHAPE = object(
  mergeFields(BASE_FIELDS, jsonFields('id', 'target', 'title')),
  generic
)

const CONTRIBUTION_SHAPES: Record<string, PublicJsonShape> = {
  channelNavigation: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('id', 'optionsKey', 'priority')
  ))),
  chatHeaderActions: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('command', 'id', 'title'),
    assetFields('icon')
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
    jsonFields('command', 'id', 'payload', 'title'),
    assetFields('icon'),
    routeFields('route')
  ))),
  navMoreMenu: array(MENU_SHAPE),
  roles: json,
  routeHeaderActions: array(ROUTE_HEADER_SHAPE),
  routeMoreMenu: array(ROUTE_MENU_SHAPE),
  routeMoreMenuItems: array(ROUTE_MENU_SHAPE),
  routes: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('clientView', 'id', 'routeId', 'title'),
    assetFields('icon')
  ))),
  routeSidebarContextMenu: array(ROUTE_MENU_SHAPE),
  routeWindowBarActions: array(ROUTE_HEADER_SHAPE),
  sessionGroups: array(SESSION_GROUP_SHAPE),
  settingsPages: array(SETTINGS_PAGE_SHAPE),
  surfaces: json,
  toolUsePresentations: array(TOOL_PRESENTATION_SHAPE),
  usageSources: array(object(mergeFields(
    BASE_FIELDS,
    jsonFields('command', 'id', 'kind', 'title')
  ))),
  workbenchAddMenu: array(WORKBENCH_ADD_SHAPE),
  workbenchTabs: array(TAB_SHAPE),
  workspaceDrawerTabs: array(TAB_SHAPE)
}

const isSafePublicContributionRoute = (value: string) => {
  if (hasUnsafePublicUrlWhitespace(value)) return false
  if (/^https?:\/\//iu.test(value)) return !isFilesystemShapedPublicValue(value)
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    if (
      hasUnsafePublicUrlWhitespace(candidate) ||
      candidate.includes('\\') ||
      candidate.startsWith('//') ||
      /^[a-z][a-z\d+.-]*:/iu.test(candidate) ||
      candidate.split(/[?#]/u)[0]?.split('/').includes('..')
    ) return false
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) {
        if (candidate.startsWith('/')) {
          return !hasUnsafePublicUrlMetadata(new URL(candidate, 'https://public.invalid/'))
        }
        return !isFilesystemShapedPublicValue(candidate)
      }
      candidate = decoded
    } catch {
      return false
    }
  }
  return false
}

const projectPublicJsonShape = (
  value: unknown,
  state: PublicParseState,
  shape: PublicJsonShape
): unknown => {
  if (shape === 'asset') return parsePublicAssetString(value, state)
  if (shape === 'schema') return parsePublicJsonValue(value, state, 0, 'schema')
  if (shape === 'route') {
    const parsed = parsePublicJsonValue(value, state, 0, true)
    if (typeof parsed === 'string') return isSafePublicContributionRoute(parsed) ? parsed : undefined
    if (!Array.isArray(parsed)) return undefined
    return parsed.every(item => typeof item === 'string' && isSafePublicContributionRoute(item))
      ? parsed
      : undefined
  }
  if (shape === 'generic') return parsePublicJsonValue(value, state)
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
    if (isPrivatePublicFieldName(key) || isCredentialPublicFieldName(key)) return undefined
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
