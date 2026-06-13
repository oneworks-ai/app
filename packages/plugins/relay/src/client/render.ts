/* eslint-disable max-lines -- relay client renderer keeps account, server, and device markup together. */
import { actionButton, escapeHtml, materialIcon, valueOrDash } from './dom.js'
import type { RelayClientMessages } from './i18n.js'
import type { RelayServerStatus, RelayStatus } from './types.js'

interface RenderRelayViewMarkupOptions {
  activeRemote?: string
  activeServer?: RelayServerStatus
  connectionState: string
  device: NonNullable<RelayStatus['device']>
  editingServer: boolean
  messages: RelayClientMessages
  options: NonNullable<RelayStatus['options']>
  savingServer: boolean
  servers: RelayServerStatus[]
  serverDraft: {
    name: string
    remoteBaseUrl: string
  }
  stateError: string | null
}

const cleanText = (value?: string | number | null) => {
  if (value == null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

const getAvatarInitials = (input?: string) => {
  const source = cleanText(input)?.split('@')[0] ?? ''
  const compact = Array.from(source).filter(char => /\S/u.test(char) && !['.', '-', '_'].includes(char)).join('')
  const initials = Array.from(compact).slice(0, 2).join('')
  return (initials === '' ? 'SS' : initials).toLocaleUpperCase()
}

const getAccountConnectionState = (
  server: RelayServerStatus,
  globalConnectionState: string
) => {
  if (server.active === true) return globalConnectionState
  return server.hasToken === true ? 'registered' : 'idle'
}

const getStatusText = (connectionState: string, t: RelayClientMessages) => t.status[connectionState] ?? connectionState

const capabilityOrder = ['sessions', 'terminal', 'workspaceFiles'] as const

const getDeviceStatusText = (status: string | undefined, t: RelayClientMessages) => {
  const normalized = cleanText(status) ?? 'offline'
  return t.devices.status[normalized] ?? normalized
}

const getDeviceFeatureText = (
  capabilities: Record<string, unknown> | undefined,
  t: RelayClientMessages
) => {
  if (capabilities == null) return undefined
  const labels = capabilityOrder
    .filter(key => capabilities[key] === true)
    .map(key => t.devices.features[key])
  return labels.length === 0 ? undefined : labels.join(' / ')
}

const renderRelayDeviceRows = (
  server: RelayServerStatus,
  currentDeviceId: string | undefined,
  t: RelayClientMessages
) => {
  if (server.hasToken !== true) return ''
  if (cleanText(server.devicesError) != null) {
    return `
      <div class="oneworks-relay__account-devices" aria-label="${escapeHtml(t.devices.label)}">
        <div class="oneworks-relay__devices-summary">
          <span>${escapeHtml(t.devices.label)}</span>
          <span>${escapeHtml(t.devices.error)}</span>
        </div>
      </div>
    `
  }
  const devices = server.devices ?? []
  const rows = devices.map((device) => {
    const status = cleanText(device.status) ?? 'offline'
    const statusText = getDeviceStatusText(status, t)
    const name = cleanText(device.name) ?? t.devices.label
    const featureText = getDeviceFeatureText(device.capabilities, t)
    const isCurrentDevice = currentDeviceId != null && currentDeviceId === device.id
    return `
      <div class="oneworks-relay__device-row">
        <span class="oneworks-relay__device-status" data-state="${escapeHtml(status)}" title="${
      escapeHtml(statusText)
    }" aria-label="${escapeHtml(statusText)}"></span>
        <span class="oneworks-relay__device-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        ${isCurrentDevice ? `<span class="oneworks-relay__device-chip">${escapeHtml(t.devices.local)}</span>` : ''}
        ${
      featureText == null
        ? ''
        : `<span class="oneworks-relay__device-features" title="${escapeHtml(featureText)}">${
          escapeHtml(featureText)
        }</span>`
    }
      </div>
    `
  }).join('')
  return `
    <div class="oneworks-relay__account-devices" aria-label="${escapeHtml(t.devices.label)}">
      <div class="oneworks-relay__devices-summary">
        <span>${escapeHtml(t.devices.label)}</span>
        <span>${escapeHtml(t.devices.count(devices.length))}</span>
      </div>
      ${rows === '' ? `<div class="oneworks-relay__devices-empty">${escapeHtml(t.devices.empty)}</div>` : rows}
    </div>
  `
}

const renderRelayAccountRows = (
  servers: RelayServerStatus[],
  connectionState: string,
  currentDeviceId: string | undefined,
  t: RelayClientMessages
) =>
  servers.map((server) => {
    const serverId = server.id ?? ''
    const accountName = cleanText(server.account?.name ?? server.accountName)
    const accountEmail = cleanText(server.account?.email ?? server.accountEmail)
    const serverName = cleanText(server.name ?? server.id)
    const platformName = cleanText(server.platform) ?? valueOrDash(serverName)
    const accountTitle = accountName ?? accountEmail ?? t.labels.notSignedIn
    const accountSubtitle = accountName != null && accountEmail != null && accountEmail !== accountName
      ? accountEmail
      : undefined
    const accountConnectionState = getAccountConnectionState(server, connectionState)
    const statusText = getStatusText(accountConnectionState, t)
    const avatarSource = accountEmail ?? accountName ?? platformName
    const avatarUrl = cleanText(server.account?.avatarUrl ?? server.accountAvatarUrl)
    const remote = cleanText(server.remoteBaseUrl) ?? cleanText(server.server)
    const avatarMarkup = avatarUrl == null
      ? `<span>${escapeHtml(getAvatarInitials(avatarSource))}</span>`
      : `<img alt="" class="oneworks-relay__account-avatar-image" src="${escapeHtml(avatarUrl)}" />`

    return `
      <details class="oneworks-relay__account" data-active="${server.active === true}" ${
      server.active === true ? 'open' : ''
    }>
        <summary class="oneworks-relay__account-summary">
          <span class="oneworks-relay__account-avatar" data-state="${escapeHtml(accountConnectionState)}" title="${
      escapeHtml(statusText)
    }" aria-label="${escapeHtml(statusText)}">
            ${avatarMarkup}
            <span class="oneworks-relay__account-status"></span>
          </span>
          <div class="oneworks-relay__account-copy">
            <p class="oneworks-relay__account-name">
              <span class="oneworks-relay__account-platform">${escapeHtml(platformName)}</span>
              <span class="oneworks-relay__account-state">${escapeHtml(statusText)}</span>
            </p>
            <p class="oneworks-relay__account-subtitle">${escapeHtml(accountTitle)}</p>
            ${
      accountSubtitle == null ? '' : `<p class="oneworks-relay__account-email">${escapeHtml(accountSubtitle)}</p>`
    }
          </div>
          <span class="oneworks-relay__account-chevron">${materialIcon('expand_more')}</span>
        </summary>
        <div class="oneworks-relay__account-panel">
          <div class="oneworks-relay__account-meta">
            <div class="oneworks-relay__account-fact">
              <span class="oneworks-relay__account-fact-label">${escapeHtml(t.labels.account)}</span>
              <span class="oneworks-relay__account-fact-value">${escapeHtml(accountTitle)}</span>
            </div>
            ${
      accountSubtitle == null
        ? ''
        : `<div class="oneworks-relay__account-fact">
              <span class="oneworks-relay__account-fact-label">${escapeHtml(t.labels.email)}</span>
              <span class="oneworks-relay__account-fact-value">${escapeHtml(accountSubtitle)}</span>
            </div>`
    }
            <div class="oneworks-relay__account-fact">
              <span class="oneworks-relay__account-fact-label">${escapeHtml(t.labels.platform)}</span>
              <span class="oneworks-relay__account-fact-value">${escapeHtml(platformName)}</span>
            </div>
            <div class="oneworks-relay__account-fact">
              <span class="oneworks-relay__account-fact-label">${escapeHtml(t.labels.status)}</span>
              <span class="oneworks-relay__account-fact-value">${escapeHtml(statusText)}</span>
            </div>
            <div class="oneworks-relay__account-fact">
              <span class="oneworks-relay__account-fact-label">${escapeHtml(t.labels.remote)}</span>
              <span class="oneworks-relay__account-fact-value" title="${escapeHtml(remote ?? '')}">${
      escapeHtml(remote ?? '-')
    }</span>
            </div>
          </div>
          <div class="oneworks-relay__account-actions" aria-label="${escapeHtml(t.aria.serviceActions)}">
            ${actionButton('login', t.actions.login, 'login', { serverId })}
            ${actionButton('connect', t.actions.connect, 'cloud_sync', { primary: server.active === true, serverId })}
            ${actionButton('disconnect', t.actions.disconnect, 'link_off', { serverId })}
            ${actionButton('forget', t.actions.forgetToken, 'key_off', { serverId })}
          </div>
          ${renderRelayDeviceRows(server, currentDeviceId, t)}
        </div>
      </details>
    `
  }).join('')

export const renderRelayViewMarkup = ({
  activeRemote,
  activeServer,
  connectionState,
  device,
  editingServer,
  messages: t,
  options,
  savingServer,
  servers,
  serverDraft,
  stateError
}: RenderRelayViewMarkupOptions) => {
  const accountRows = renderRelayAccountRows(servers, connectionState, cleanText(device.id), t)
  const serviceName = valueOrDash(activeServer?.name ?? activeServer?.id ?? device.name ?? options.deviceName)
  const serviceTitle = activeRemote ?? serviceName
  const serverEditorMarkup = editingServer
    ? `
          <form class="oneworks-relay__server-editor">
            <label class="oneworks-relay__field" title="${escapeHtml(t.inputs.serverName)}">
              ${materialIcon('badge')}
              <input aria-label="${
      escapeHtml(t.inputs.serverName)
    }" class="oneworks-relay__input" data-field="server-name" placeholder="${escapeHtml(t.inputs.serverName)}" value="${
      escapeHtml(serverDraft.name)
    }" />
            </label>
            <label class="oneworks-relay__field oneworks-relay__field--url" title="${escapeHtml(t.inputs.serverUrl)}">
              ${materialIcon('link')}
              <input aria-label="${
      escapeHtml(t.inputs.serverUrl)
    }" class="oneworks-relay__input oneworks-relay__input--url" data-field="server-url" placeholder="https://relay.example.com" value="${
      escapeHtml(serverDraft.remoteBaseUrl)
    }" />
            </label>
            <div class="oneworks-relay__editor-actions">
              ${actionButton('save-server', t.actions.saveServer, 'check', { disabled: savingServer, primary: true })}
              ${actionButton('cancel-server', t.actions.cancelServer, 'close', { disabled: savingServer })}
            </div>
          </form>
        `
    : ''
  return `
    <main class="oneworks-relay">
      <div class="oneworks-relay__shell">
        <section class="oneworks-relay__surface">
          <div class="oneworks-relay__toolbar">
            <h2 class="oneworks-relay__section-title" title="${escapeHtml(serviceTitle)}">${
    materialIcon('hub')
  }<span class="oneworks-relay__server-name">${escapeHtml(serviceName)}</span>${
    activeRemote == null ? '' : `<span class="oneworks-relay__remote-inline">(${escapeHtml(activeRemote)})</span>`
  }</h2>
            <div class="oneworks-relay__actions">
              <div class="oneworks-relay__primary-actions">
                ${actionButton('edit-server', t.actions.editServer, 'edit')}
                ${actionButton('connect', t.actions.connect, 'cloud_sync', { primary: true })}
              </div>
              <div class="oneworks-relay__revealed-actions" aria-label="${escapeHtml(t.aria.moreDeviceActions)}">
                ${actionButton('refresh', t.actions.refresh, 'refresh')}
                ${actionButton('login', t.actions.login, 'login')}
                ${actionButton('disconnect', t.actions.disconnect, 'link_off')}
                ${actionButton('forget', t.actions.forgetToken, 'key_off')}
              </div>
            </div>
          </div>
          ${serverEditorMarkup}
          ${stateError == null ? '' : `<div class="oneworks-relay__notice">${escapeHtml(stateError)}</div>`}
          <div class="oneworks-relay__accounts">
            ${
    accountRows === '' ? `<div class="oneworks-relay__empty">${escapeHtml(t.emptyAccounts)}</div>` : accountRows
  }
          </div>
        </section>
      </div>
    </main>
  `
}
