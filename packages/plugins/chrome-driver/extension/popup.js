const groups = [
  {
    name: 'Page control',
    detail: 'Semantic view, click, type, wait, frames on this site',
    permissions: ['scripting', 'webNavigation'],
    activeOrigin: true
  },
  {
    name: 'Sensitive tab metadata',
    detail: 'Read tab URLs, titles, icons and URL-filtered tab queries',
    permissions: ['tabs']
  },
  {
    name: 'Browser organization',
    detail: 'Groups, sessions, bookmarks, reading list',
    permissions: ['tabGroups', 'sessions', 'bookmarks', 'readingList']
  },
  {
    name: 'Downloads & archives',
    detail: 'Downloads and MHTML page capture',
    permissions: ['downloads', 'pageCapture']
  },
  { name: 'History', detail: 'Search and explicitly confirmed removal', permissions: ['history'] },
  {
    name: 'Site data',
    detail: 'Redacted cookies, site settings, bounded data cleanup on this site',
    permissions: ['cookies', 'contentSettings', 'browsingData'],
    activeOrigin: true
  },
  {
    name: 'Browser settings',
    detail: 'Installed extension metadata and privacy settings',
    permissions: ['management', 'privacy', 'system.display']
  }
]

const advancedGroups = [
  {
    key: 'raw_debugger',
    module: 'raw',
    name: 'Raw CDP & JavaScript',
    detail: 'Browser-session-wide CDP and Runtime.evaluate; includes complete cookies and sensitive fields'
  },
  {
    key: 'cookie_values',
    name: 'Complete cookie values',
    detail: 'Return cookie values for one explicitly supplied HTTP(S) origin'
  },
  {
    key: 'sensitive_fields',
    name: 'Sensitive page fields',
    detail: 'Read or type password, token, OTP and similar page fields'
  }
]

const send = message =>
  chrome.runtime.sendMessage(message).then(response => {
    if (response?.ok !== true) {
      throw Object.assign(new Error(response?.error?.message ?? 'Extension request failed.'), response?.error)
    }
    return response.result
  })

function showError(failure) {
  const notice = document.querySelector('#notice')
  notice.hidden = false
  notice.textContent = failure.message
}

async function render() {
  const status = await send({ type: 'oneworks:status' })
  document.querySelector('#state').textContent = status.connected
    ? `Connected to ${status.trusted_origin}`
    : status.paired
    ? 'Paired · reconnect oneWorks to continue'
    : 'Not connected'
  document.querySelector('#version').textContent = `v${status.extension_version} · protocol ${status.protocol_version}`
  const granted = status.capabilities.permissions
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeOrigin = activeTab?.url && /^https?:/.test(activeTab.url)
    ? `${new URL(activeTab.url).origin}/*`
    : undefined
  const container = document.querySelector('#permissions')
  container.replaceChildren(...groups.map(group => {
    const hasPermissions = group.permissions.every(permission => granted.permissions?.includes(permission))
    const origins = group.activeOrigin && activeOrigin ? [activeOrigin] : group.origins ?? []
    const hasOrigins = origins.every(origin => granted.origins?.includes(origin))
    const row = document.createElement('div')
    row.className = `permission ${hasPermissions && hasOrigins ? 'granted' : ''}`
    const label = document.createElement('div')
    label.innerHTML = `<strong>${group.name}</strong><span>${group.detail}</span>`
    const button = document.createElement('button')
    button.textContent = hasPermissions && hasOrigins ? 'Granted' : 'Grant'
    button.disabled = hasPermissions && hasOrigins
    button.addEventListener(
      'click',
      () =>
        send({ type: 'oneworks:grant-permissions', permissions: group.permissions, origins }).then(render, showError)
    )
    row.append(label, button)
    return row
  }))
  const advanced = document.querySelector('#advanced')
  const policy = status.capabilities.advanced_access ?? {}
  advanced.replaceChildren(...advancedGroups.map(group => {
    const enabled = policy[group.key] === true
    const includedByRaw = group.key !== 'raw_debugger' && policy.raw_debugger === true
    const available = group.module == null || status.capabilities.modules?.[group.module] === true
    const row = document.createElement('div')
    row.className = `permission advanced ${enabled ? 'granted' : ''}`
    const label = document.createElement('div')
    label.innerHTML = `<strong>${group.name}</strong><span>${
      available
        ? includedByRaw ? 'Included while Raw CDP & JavaScript is enabled.' : group.detail
        : 'Install the privileged extension flavor first.'
    }</span>`
    const button = document.createElement('button')
    button.textContent = available ? includedByRaw ? 'Included' : enabled ? 'Disable' : 'Enable' : 'Unavailable'
    button.disabled = !available || includedByRaw
    button.setAttribute('aria-pressed', String(enabled))
    button.addEventListener(
      'click',
      () => send({ type: 'oneworks:set-advanced-access', key: group.key, enabled: !enabled }).then(render, showError)
    )
    row.append(label, button)
    return row
  }))
}

document.querySelector('#connect').addEventListener(
  'click',
  () =>
    send({ type: 'oneworks:inject-bridge' }).then(result => {
      document.querySelector('#state').textContent =
        `Bridge ready in tab ${result.tab_id}. Click Connect browser in oneWorks.`
    }, showError)
)
document.querySelector('#forget').addEventListener(
  'click',
  () => send({ type: 'oneworks:forget' }).then(render, showError)
)
void render().catch(showError)
