import accountCircleSvg from '@material-symbols/svg-400/rounded/account_circle.svg?raw'
import addSvg from '@material-symbols/svg-400/rounded/add.svg?raw'
import adminPanelSettingsSvg from '@material-symbols/svg-400/rounded/admin_panel_settings.svg?raw'
import archiveSvg from '@material-symbols/svg-400/rounded/archive.svg?raw'
import badgeSvg from '@material-symbols/svg-400/rounded/badge.svg?raw'
import checkSvg from '@material-symbols/svg-400/rounded/check.svg?raw'
import chevronLeftSvg from '@material-symbols/svg-400/rounded/chevron_left.svg?raw'
import chevronRightSvg from '@material-symbols/svg-400/rounded/chevron_right.svg?raw'
import closeSvg from '@material-symbols/svg-400/rounded/close.svg?raw'
import contentCopySvg from '@material-symbols/svg-400/rounded/content_copy.svg?raw'
import darkModeSvg from '@material-symbols/svg-400/rounded/dark_mode.svg?raw'
import deleteSvg from '@material-symbols/svg-400/rounded/delete.svg?raw'
import desktopWindowsSvg from '@material-symbols/svg-400/rounded/desktop_windows.svg?raw'
import disabledByDefaultSvg from '@material-symbols/svg-400/rounded/disabled_by_default.svg?raw'
import editSvg from '@material-symbols/svg-400/rounded/edit.svg?raw'
import factCheckSvg from '@material-symbols/svg-400/rounded/fact_check.svg?raw'
import filterListSvg from '@material-symbols/svg-400/rounded/filter_list.svg?raw'
import groupSvg from '@material-symbols/svg-400/rounded/group.svg?raw'
import homeSvg from '@material-symbols/svg-400/rounded/home.svg?raw'
import hubSvg from '@material-symbols/svg-400/rounded/hub.svg?raw'
import keySvg from '@material-symbols/svg-400/rounded/key.svg?raw'
import languageSvg from '@material-symbols/svg-400/rounded/language.svg?raw'
import leftPanelCloseFillSvg from '@material-symbols/svg-400/rounded/left_panel_close-fill.svg?raw'
import leftPanelCloseSvg from '@material-symbols/svg-400/rounded/left_panel_close.svg?raw'
import leftPanelOpenFillSvg from '@material-symbols/svg-400/rounded/left_panel_open-fill.svg?raw'
import leftPanelOpenSvg from '@material-symbols/svg-400/rounded/left_panel_open.svg?raw'
import lightModeSvg from '@material-symbols/svg-400/rounded/light_mode.svg?raw'
import linkSvg from '@material-symbols/svg-400/rounded/link.svg?raw'
import loginSvg from '@material-symbols/svg-400/rounded/login.svg?raw'
import logoutSvg from '@material-symbols/svg-400/rounded/logout.svg?raw'
import menuBookSvg from '@material-symbols/svg-400/rounded/menu_book.svg?raw'
import moreHorizSvg from '@material-symbols/svg-400/rounded/more_horiz.svg?raw'
import notificationsSvg from '@material-symbols/svg-400/rounded/notifications.svg?raw'
import personSvg from '@material-symbols/svg-400/rounded/person.svg?raw'
import refreshSvg from '@material-symbols/svg-400/rounded/refresh.svg?raw'
import restartAltSvg from '@material-symbols/svg-400/rounded/restart_alt.svg?raw'
import searchSvg from '@material-symbols/svg-400/rounded/search.svg?raw'
import sellSvg from '@material-symbols/svg-400/rounded/sell.svg?raw'
import syncSvg from '@material-symbols/svg-400/rounded/sync.svg?raw'
import unarchiveSvg from '@material-symbols/svg-400/rounded/unarchive.svg?raw'
import viewColumnSvg from '@material-symbols/svg-400/rounded/view_column.svg?raw'
import viewWeekSvg from '@material-symbols/svg-400/rounded/view_week.svg?raw'

export type AdminIconName =
  | 'account_circle'
  | 'add'
  | 'admin_panel_settings'
  | 'archive'
  | 'badge'
  | 'check'
  | 'chevron_left'
  | 'chevron_right'
  | 'close'
  | 'content_copy'
  | 'dark_mode'
  | 'delete'
  | 'desktop_windows'
  | 'disabled_by_default'
  | 'edit'
  | 'fact_check'
  | 'filter_list'
  | 'group'
  | 'home'
  | 'hub'
  | 'key'
  | 'language'
  | 'left_panel_close'
  | 'left_panel_open'
  | 'link'
  | 'light_mode'
  | 'login'
  | 'logout'
  | 'menu_book'
  | 'more_horiz'
  | 'notifications'
  | 'person'
  | 'refresh'
  | 'restart_alt'
  | 'search'
  | 'sell'
  | 'sync'
  | 'unarchive'
  | 'view_column'
  | 'view_week'

const adminIconSvgByName: Record<AdminIconName, string> = {
  account_circle: accountCircleSvg,
  add: addSvg,
  admin_panel_settings: adminPanelSettingsSvg,
  archive: archiveSvg,
  badge: badgeSvg,
  check: checkSvg,
  chevron_left: chevronLeftSvg,
  chevron_right: chevronRightSvg,
  close: closeSvg,
  content_copy: contentCopySvg,
  dark_mode: darkModeSvg,
  delete: deleteSvg,
  desktop_windows: desktopWindowsSvg,
  disabled_by_default: disabledByDefaultSvg,
  edit: editSvg,
  fact_check: factCheckSvg,
  filter_list: filterListSvg,
  group: groupSvg,
  home: homeSvg,
  hub: hubSvg,
  key: keySvg,
  language: languageSvg,
  left_panel_close: leftPanelCloseSvg,
  left_panel_open: leftPanelOpenSvg,
  link: linkSvg,
  light_mode: lightModeSvg,
  login: loginSvg,
  logout: logoutSvg,
  menu_book: menuBookSvg,
  more_horiz: moreHorizSvg,
  notifications: notificationsSvg,
  person: personSvg,
  refresh: refreshSvg,
  restart_alt: restartAltSvg,
  search: searchSvg,
  sell: sellSvg,
  sync: syncSvg,
  unarchive: unarchiveSvg,
  view_column: viewColumnSvg,
  view_week: viewWeekSvg
}

const filledAdminIconSvgByName: Partial<Record<AdminIconName, string>> = {
  left_panel_close: leftPanelCloseFillSvg,
  left_panel_open: leftPanelOpenFillSvg
}

export interface AdminIconProps {
  name: AdminIconName
  className?: string
  filled?: boolean
}

export const AdminIcon = ({ className, filled = false, name }: AdminIconProps) => (
  <span
    className={['relay-admin-icon', filled ? 'is-filled filled' : '', className].filter(Boolean).join(' ')}
    aria-hidden='true'
    dangerouslySetInnerHTML={{
      __html: filled ? filledAdminIconSvgByName[name] ?? adminIconSvgByName[name] : adminIconSvgByName[name]
    }}
  />
)
