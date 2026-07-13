import { requireAdvancedAccess } from './security.js'
import {
  cleanTab,
  cleanWindow,
  contentSettingNames,
  error,
  isoToMs,
  namedSetting,
  requirePermissions,
  safeFilename
} from './shared.js'

export async function windowsOperation(action, args) {
  if (action === 'list') {
    return (await chrome.windows.getAll({ populate: args.populate_tabs === true })).map(cleanWindow)
  }
  if (action === 'get') return cleanWindow(await chrome.windows.get(args.window_id, { populate: true }))
  if (action === 'create') {
    return cleanWindow(
      await chrome.windows.create({
        url: args.urls,
        focused: args.focused,
        incognito: args.incognito,
        type: args.type,
        left: args.left,
        top: args.top,
        width: args.width,
        height: args.height
      })
    )
  }
  if (action === 'update') {
    return cleanWindow(
      await chrome.windows.update(args.window_id, {
        focused: args.focused,
        state: args.state,
        left: args.left,
        top: args.top,
        width: args.width,
        height: args.height
      })
    )
  }
  if (action === 'close') {
    await chrome.windows.remove(args.window_id)
    return { closed: true, window_id: args.window_id }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported windows action: ${action}`)
}

export async function tabsOperation(action, args) {
  if (action === 'list' && Array.isArray(args.url_patterns) && args.url_patterns.length > 0) {
    await requirePermissions(['tabs'])
  }
  if (action === 'list') {
    return (await chrome.tabs.query({
      windowId: args.window_id,
      active: args.active,
      pinned: args.pinned,
      groupId: args.group_id,
      url: args.url_patterns
    })).map(cleanTab)
  }
  if (action === 'get') return cleanTab(await chrome.tabs.get(args.tab_id))
  if (action === 'get_active') {
    const [tab] = await chrome.tabs.query({ active: true, windowId: args.window_id })
    if (tab == null) throw error('TARGET_NOT_FOUND', 'No active tab exists in the requested window.')
    return cleanTab(tab)
  }
  if (action === 'create') {
    return cleanTab(
      await chrome.tabs.create({
        windowId: args.window_id,
        url: args.url,
        active: args.active,
        pinned: args.pinned,
        index: args.index,
        openerTabId: args.opener_tab_id
      })
    )
  }
  if (action === 'duplicate') return cleanTab(await chrome.tabs.duplicate(args.tab_id))
  if (action === 'update') {
    return cleanTab(
      await chrome.tabs.update(args.tab_id, {
        url: args.url,
        active: args.active,
        highlighted: args.highlighted,
        pinned: args.pinned,
        muted: args.muted,
        autoDiscardable: args.auto_discardable
      })
    )
  }
  if (action === 'move') {
    return cleanTab(await chrome.tabs.move(args.tab_id, { windowId: args.window_id, index: args.index }))
  }
  if (action === 'close') {
    await chrome.tabs.remove(args.tab_ids)
    return { closed: args.tab_ids }
  }
  if (action === 'reload') {
    await chrome.tabs.reload(args.tab_id, { bypassCache: args.bypass_cache })
    return { reloaded: true, tab_id: args.tab_id }
  }
  if (action === 'back') {
    await chrome.tabs.goBack(args.tab_id)
    return { navigated: 'back', tab_id: args.tab_id }
  }
  if (action === 'forward') {
    await chrome.tabs.goForward(args.tab_id)
    return { navigated: 'forward', tab_id: args.tab_id }
  }
  if (action === 'discard') return cleanTab(await chrome.tabs.discard(args.tab_id))
  if (action === 'group') {
    await requirePermissions(['tabGroups'])
    return {
      group_id: await chrome.tabs.group({
        tabIds: args.tab_ids,
        groupId: args.group_id,
        createProperties: args.window_id == null ? undefined : { windowId: args.window_id }
      })
    }
  }
  if (action === 'ungroup') {
    await requirePermissions(['tabGroups'])
    await chrome.tabs.ungroup(args.tab_ids)
    return { ungrouped: args.tab_ids }
  }
  if (action === 'get_zoom') return { tab_id: args.tab_id, factor: await chrome.tabs.getZoom(args.tab_id) }
  if (action === 'set_zoom') {
    await chrome.tabs.setZoom(args.tab_id, args.factor)
    return { tab_id: args.tab_id, factor: args.factor }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported tabs action: ${action}`)
}

export async function groupsOperation(action, args) {
  await requirePermissions(['tabGroups'])
  if (action === 'list') return chrome.tabGroups.query({ windowId: args.window_id })
  if (action === 'get') return chrome.tabGroups.get(args.group_id)
  if (action === 'update') {
    return chrome.tabGroups.update(args.group_id, { collapsed: args.collapsed, title: args.title, color: args.color })
  }
  if (action === 'move') return chrome.tabGroups.move(args.group_id, { windowId: args.window_id, index: args.index })
  throw error('UNSUPPORTED_ACTION', `Unsupported groups action: ${action}`)
}

export async function sessionsOperation(action, args) {
  await requirePermissions(['sessions'])
  if (action === 'recent') return chrome.sessions.getRecentlyClosed({ maxResults: args.max_results })
  if (action === 'devices') return chrome.sessions.getDevices({ maxResults: args.max_results })
  if (action === 'restore') return chrome.sessions.restore(args.session_id)
  throw error('UNSUPPORTED_ACTION', `Unsupported sessions action: ${action}`)
}

export async function historyOperation(action, args) {
  await requirePermissions(['history'])
  if (action === 'search') {
    return chrome.history.search({
      text: args.query ?? '',
      startTime: isoToMs(args.start_time),
      endTime: isoToMs(args.end_time),
      maxResults: args.max_results ?? 100
    })
  }
  if (action === 'visits') return chrome.history.getVisits({ url: args.url })
  if (action === 'add') {
    await chrome.history.addUrl({ url: args.url })
    return { added: true, url: args.url }
  }
  if (action === 'remove_url') {
    await chrome.history.deleteUrl({ url: args.url })
    return { removed: true, url: args.url }
  }
  if (action === 'remove_range') {
    await chrome.history.deleteRange({ startTime: isoToMs(args.start_time), endTime: isoToMs(args.end_time) })
    return { removed: true }
  }
  if (action === 'clear_all') {
    await chrome.history.deleteAll()
    return { removed: 'all' }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported history action: ${action}`)
}

export async function bookmarksOperation(action, args) {
  await requirePermissions(['bookmarks'])
  if (action === 'tree') return chrome.bookmarks.getTree()
  if (action === 'children') return chrome.bookmarks.getChildren(args.bookmark_id)
  if (action === 'recent') return chrome.bookmarks.getRecent(args.max_results ?? 20)
  if (action === 'search') return (await chrome.bookmarks.search(args.query)).slice(0, args.max_results ?? 100)
  if (action === 'create') {
    return chrome.bookmarks.create({ parentId: args.parent_id, index: args.index, title: args.title, url: args.url })
  }
  if (action === 'update') return chrome.bookmarks.update(args.bookmark_id, { title: args.title, url: args.url })
  if (action === 'move') return chrome.bookmarks.move(args.bookmark_id, { parentId: args.parent_id, index: args.index })
  if (action === 'remove') {
    await (args.recursive === true
      ? chrome.bookmarks.removeTree(args.bookmark_id)
      : chrome.bookmarks.remove(args.bookmark_id))
    return { removed: true, bookmark_id: args.bookmark_id }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported bookmarks action: ${action}`)
}

export async function downloadsOperation(action, args) {
  await requirePermissions(action === 'open' ? ['downloads', 'downloads.open'] : ['downloads'])
  if (action === 'search') {
    return (await chrome.downloads.search({ query: args.query, state: args.state, limit: args.max_results ?? 100 }))
      .map(item => ({
        id: item.id,
        url: item.url,
        final_url: item.finalUrl,
        filename: item.filename?.split(/[\\/]/).pop(),
        state: item.state,
        paused: item.paused,
        danger: item.danger,
        mime: item.mime,
        bytes_received: item.bytesReceived,
        total_bytes: item.totalBytes,
        start_time: item.startTime,
        end_time: item.endTime,
        exists: item.exists
      }))
  }
  if (action === 'start') {
    return {
      download_id: await chrome.downloads.download({
        url: args.url,
        filename: safeFilename(args.filename, undefined),
        saveAs: args.save_as,
        conflictAction: args.conflict_action
      })
    }
  }
  if (action === 'pause') await chrome.downloads.pause(args.download_id)
  else if (action === 'resume') await chrome.downloads.resume(args.download_id)
  else if (action === 'cancel') await chrome.downloads.cancel(args.download_id)
  else if (action === 'erase_record') return { erased_ids: await chrome.downloads.erase({ id: args.download_id }) }
  else if (action === 'remove_file') await chrome.downloads.removeFile(args.download_id)
  else if (action === 'show') await chrome.downloads.show(args.download_id)
  else if (action === 'open') {
    throw error('USER_GESTURE_REQUIRED', 'Opening a downloaded file requires a direct click in the extension popup.', {
      user_action: 'Open the OneWorks Chrome extension popup and choose the pending download action.'
    })
  } else throw error('UNSUPPORTED_ACTION', `Unsupported downloads action: ${action}`)
  return { completed: action, download_id: args.download_id }
}

export async function readingListOperation(action, args) {
  await requirePermissions(['readingList'])
  if (chrome.readingList == null) {
    throw error('UNAVAILABLE_CAPABILITY', 'Reading List is unavailable in this Chrome build.')
  }
  if (action === 'list') return chrome.readingList.query({ hasBeenRead: args.read, url: args.url, title: args.title })
  if (action === 'add') {
    await chrome.readingList.addEntry({ url: args.url, title: args.title, hasBeenRead: args.has_been_read ?? false })
    return { added: true, url: args.url }
  }
  if (action === 'update') {
    await chrome.readingList.updateEntry({ url: args.url, title: args.title, hasBeenRead: args.has_been_read })
    return { updated: true, url: args.url }
  }
  if (action === 'remove') {
    await chrome.readingList.removeEntry({ url: args.url })
    return { removed: true, url: args.url }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported reading-list action: ${action}`)
}

export async function managementOperation(action, args) {
  await requirePermissions(['management'])
  if (action === 'list') {
    return (await chrome.management.getAll()).filter(item =>
      (args.type == null || item.type === args.type) && (args.enabled == null || item.enabled === args.enabled)
    ).map(cleanExtension)
  }
  if (action === 'get') return cleanExtension(await chrome.management.get(args.extension_id))
  if (action === 'set_enabled') {
    throw error(
      'USER_GESTURE_REQUIRED',
      'Changing another extension requires a direct user gesture in the extension popup.',
      { user_action: 'Open the OneWorks Chrome extension popup and complete the pending native action.' }
    )
  }
  if (action === 'uninstall') {
    await chrome.management.uninstall(args.extension_id, { showConfirmDialog: true })
    return { extension_id: args.extension_id, uninstalled: true }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported management action: ${action}`)
}

function cleanExtension(item) {
  return {
    id: item.id,
    name: item.name,
    short_name: item.shortName,
    description: item.description,
    version: item.version,
    type: item.type,
    enabled: item.enabled,
    may_disable: item.mayDisable,
    install_type: item.installType,
    permissions: item.permissions,
    host_permissions: item.hostPermissions
  }
}

export async function devicesOperation(action, args) {
  if (action === 'displays') {
    await requirePermissions(['system.display'])
    return chrome.system.display.getInfo()
  }
  if (action === 'synced_devices') {
    await requirePermissions(['sessions'])
    return chrome.sessions.getDevices({ maxResults: args.max_results })
  }
  if (action === 'debug_targets') {
    if (chrome.debugger == null) {
      throw error('MISSING_PERMISSION', 'The privileged extension flavor is required for debugger targets.', {
        missing_permissions: ['debugger']
      })
    }
    return (await chrome.debugger.getTargets()).map(target => ({
      id: target.id,
      tab_id: target.tabId,
      type: target.type,
      title: target.title,
      url: target.url,
      attached: target.attached
    }))
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported devices action: ${action}`)
}

export async function cookiesOperation(action, args) {
  await requirePermissions(['cookies'], args.url ? [`${new URL(args.url).origin}/*`] : [])
  const cookies = async () =>
    await chrome.cookies.getAll({ url: args.url, domain: args.domain, name: args.name, storeId: args.store_id })
  if (action === 'list_metadata') {
    return (await cookies()).map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      host_only: cookie.hostOnly,
      path: cookie.path,
      secure: cookie.secure,
      http_only: cookie.httpOnly,
      same_site: cookie.sameSite,
      session: cookie.session,
      expiration_date: cookie.expirationDate,
      store_id: cookie.storeId,
      partitioned: cookie.partitionKey != null
    }))
  }
  if (action === 'list_with_values') {
    await requireAdvancedAccess('cookie_values')
    const all = await cookies()
    const maxResults = Math.min(100, Math.max(1, args.max_results ?? 100))
    return {
      cookies: all.slice(0, maxResults).map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        host_only: cookie.hostOnly,
        path: cookie.path,
        secure: cookie.secure,
        http_only: cookie.httpOnly,
        same_site: cookie.sameSite,
        session: cookie.session,
        expiration_date: cookie.expirationDate,
        store_id: cookie.storeId,
        partition_key: cookie.partitionKey
      })),
      origin: new URL(args.url).origin,
      total: all.length,
      truncated: all.length > maxResults
    }
  }
  if (action === 'set') {
    await chrome.cookies.set({
      url: args.url,
      name: args.name,
      value: args.value,
      domain: args.domain,
      path: args.path,
      secure: args.secure,
      httpOnly: args.http_only,
      sameSite: args.same_site,
      expirationDate: args.expiration_date
    })
    return { set: true, name: args.name, origin: new URL(args.url).origin }
  }
  if (action === 'remove') {
    const result = await chrome.cookies.remove({ url: args.url, name: args.name, storeId: args.store_id })
    return { removed: result != null, name: args.name, origin: new URL(args.url).origin }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported cookies action: ${action}`)
}

export async function contentSettingsOperation(action, args) {
  await requirePermissions(['contentSettings'])
  if (!contentSettingNames.has(args.setting)) {
    throw error('UNSUPPORTED_SETTING', `Unsupported content setting: ${args.setting}`)
  }
  const setting = chrome.contentSettings[args.setting]
  if (action === 'get') {
    return setting.get({ primaryUrl: args.primary_url, secondaryUrl: args.secondary_url, incognito: args.incognito })
  }
  if (action === 'set') {
    await setting.set({
      primaryPattern: args.primary_pattern,
      secondaryPattern: args.secondary_pattern,
      setting: args.value,
      scope: args.scope
    })
    return { setting: args.setting, primary_pattern: args.primary_pattern, value: args.value }
  }
  if (action === 'clear_owned') {
    await setting.clear({ scope: args.scope })
    return { cleared: args.setting }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported content-settings action: ${action}`)
}

const originScopedBrowsingDataTypes = new Set([
  'cache',
  'cacheStorage',
  'cookies',
  'fileSystems',
  'indexedDB',
  'localStorage',
  'serviceWorkers',
  'webSQL'
])
export async function browsingDataOperation(action, args) {
  await requirePermissions(['browsingData'])
  if (
    !Array.isArray(args.types) || args.types.length === 0 || !Array.isArray(args.origins) || args.origins.length === 0
  ) {
    throw error('INVALID_ARGUMENT', 'Browsing-data cleanup requires non-empty origins and data types.')
  }
  const invalid = args.types.filter(type => !originScopedBrowsingDataTypes.has(type))
  if (invalid.length > 0) {
    throw error(
      'ORIGIN_FILTER_UNSUPPORTED',
      `These browsing-data types cannot be safely limited to the supplied origins: ${invalid.join(', ')}`
    )
  }
  const options = {
    since: isoToMs(args.since) ?? 0,
    origins: args.origins,
    originTypes: {
      unprotectedWeb: true,
      protectedWeb: args.protected_web === true,
      extension: args.extension_origins === true
    }
  }
  const dataToRemove = Object.fromEntries(args.types.map(type => [type, true]))
  if (action === 'preview_removal') return { options, data_types: args.types, confirmation_required: true }
  if (action === 'remove') {
    await chrome.browsingData.remove(options, dataToRemove)
    return { removed: args.types, origins: args.origins }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported browsing-data action: ${action}`)
}

export async function proxyOperation(action, args) {
  if (chrome.proxy == null) {
    throw error('MISSING_PERMISSION', 'The privileged extension flavor is required for proxy control.', {
      missing_permissions: ['proxy']
    })
  }
  if (action === 'get') return chrome.proxy.settings.get({ incognito: args.incognito })
  if (action === 'clear') {
    await chrome.proxy.settings.clear({ scope: args.scope })
    return { cleared: true, scope: args.scope }
  }
  if (action === 'set') {
    const value = args.mode === 'fixed_servers'
      ? {
        mode: args.mode,
        rules: {
          singleProxy: { scheme: args.scheme ?? 'http', host: args.host, port: args.port },
          bypassList: args.bypass_list
        }
      }
      : args.mode === 'pac_script_url'
      ? { mode: 'pac_script', pacScript: { url: args.pac_url, mandatory: true } }
      : { mode: args.mode }
    await chrome.proxy.settings.set({ value, scope: args.scope })
    return { mode: args.mode, scope: args.scope }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported proxy action: ${action}`)
}

export async function privacyOperation(action, args) {
  await requirePermissions(['privacy'])
  const setting = namedSetting(chrome.privacy, args.setting)
  if (action === 'get') return setting.get({ incognito: args.incognito })
  if (action === 'set') {
    await setting.set({ value: args.value, scope: args.scope })
    return { setting: args.setting, value: args.value, scope: args.scope }
  }
  if (action === 'clear') {
    await setting.clear({ scope: args.scope })
    return { cleared: args.setting, scope: args.scope }
  }
  throw error('UNSUPPORTED_ACTION', `Unsupported privacy action: ${action}`)
}
