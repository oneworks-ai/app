/* eslint-disable max-lines -- relay client entry wires plugin lifecycle, status polling, and session groups. */
import {
  createRelayClientI18n,
  relayClientLauncherStatusTitleI18n,
  relayClientSessionGroupCreateTitleI18n
} from './i18n.js'
import { openRelayLogin } from './login-action.js'
import { relayClientCss } from './styles.js'
import type { Disposable, PluginClientContext, RelayStatus } from './types.js'
import { renderRelayView } from './view.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const toCleanString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const slugify = (value: string, fallback = 'item', maxLength = 48) => {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return (slug === '' ? fallback : slug).slice(0, maxLength)
}

export const createRelaySessionGroupTag = (scope: string, serverId: string) =>
  `oneworks:plugin:${scope}:relay-server:${serverId}`

export const createRelayDeviceSessionGroupTagPrefix = (scope: string, serverId: string) =>
  `${createRelaySessionGroupTag(scope, serverId)}:device:`

export const createRelayDeviceSessionGroupTag = (scope: string, serverId: string, deviceId: string) =>
  `${createRelayDeviceSessionGroupTagPrefix(scope, serverId)}${deviceId}`

const getConfiguredServers = (options?: Record<string, unknown>) => {
  const servers = Array.isArray(options?.servers) ? options.servers : []
  return servers
    .filter(isRecord)
    .map((server, index) => {
      const id = toCleanString(server.id) ?? `server-${index + 1}`
      return {
        id,
        name: toCleanString(server.name) ?? toCleanString(server.server) ?? id
      }
    })
}

interface RelaySessionGroupDevice {
  id: string
  name: string
}

interface RelaySessionGroupServer {
  active: boolean
  devices: RelaySessionGroupDevice[]
  id: string
  name: string
}

const normalizeStatusDevice = (value: unknown, index: number): RelaySessionGroupDevice | undefined => {
  if (!isRecord(value)) return undefined
  const id = toCleanString(value.id) ?? `device-${index + 1}`
  return {
    id,
    name: toCleanString(value.name) ?? id
  }
}

const getStatusServers = (status: RelayStatus | null): RelaySessionGroupServer[] => {
  const servers = Array.isArray(status?.servers) ? status.servers : []
  return servers
    .filter(isRecord)
    .map((server, index) => {
      const id = toCleanString(server.id) ?? `server-${index + 1}`
      const devices = (Array.isArray(server.devices) ? server.devices : [])
        .map(normalizeStatusDevice)
        .filter((device): device is RelaySessionGroupDevice => device != null)
      return {
        active: server.active === true,
        devices,
        id,
        name: toCleanString(server.name) ?? toCleanString(server.remoteBaseUrl) ?? toCleanString(server.server) ?? id
      }
    })
}

const fetchRelayStatus = async (ctx: PluginClientContext): Promise<RelayStatus | null> => {
  try {
    const response = await ctx.api.fetch('relay/status')
    if (!response.ok) return null
    const value = await response.json()
    return isRecord(value) ? value as RelayStatus : null
  } catch {
    return null
  }
}

const createSessionGroupAction = (
  title: string,
  tags: string[]
) => ({
  id: 'new-session',
  title,
  titleI18n: relayClientSessionGroupCreateTitleI18n,
  icon: 'add',
  createSession: {
    tags
  }
})

const sortDevicesForSessionGroups = (
  devices: RelaySessionGroupDevice[],
  currentDeviceId: string | undefined
) =>
  [...devices].sort((left, right) => {
    if (left.id === currentDeviceId && right.id !== currentDeviceId) return -1
    if (right.id === currentDeviceId && left.id !== currentDeviceId) return 1
    return left.name.localeCompare(right.name)
  })

const registerRelaySessionGroups = async (ctx: PluginClientContext) => {
  const registerSlot = ctx.slots?.register
  if (registerSlot == null) return []

  const t = createRelayClientI18n(ctx.i18n)
  const status = await fetchRelayStatus(ctx)
  const activeServerId = toCleanString(status?.connection?.activeServerId)
  const currentDeviceId = toCleanString(status?.device?.id)
  const statusServers = getStatusServers(status)
  const deviceGroupDisposables = statusServers.flatMap((server) => {
    if (server.devices.length === 0) return []

    const serverTag = createRelaySessionGroupTag(ctx.scope, server.id)
    const deviceTagPrefix = createRelayDeviceSessionGroupTagPrefix(ctx.scope, server.id)
    const isActiveServer = server.active || server.id === activeServerId
    return sortDevicesForSessionGroups(server.devices, isActiveServer ? currentDeviceId : undefined).map((device) => {
      const deviceTag = createRelayDeviceSessionGroupTag(ctx.scope, server.id, device.id)
      const isCurrentDevice = isActiveServer && device.id === currentDeviceId
      return registerSlot('sessions.groups', {
        id: `device-${slugify(server.id, 'server', 18)}-${slugify(device.id, 'device', 32)}`,
        title: device.name,
        icon: 'computer',
        match: isCurrentDevice
          ? {
            anyOf: [
              { tags: [deviceTag] },
              {
                excludedTagPrefixes: [deviceTagPrefix],
                tags: [serverTag]
              }
            ]
          }
          : {
            tags: [deviceTag]
          },
        showWhenEmpty: true,
        actions: [createSessionGroupAction(t.sessionGroups.createSession, [serverTag, deviceTag])]
      })
    })
  })

  if (deviceGroupDisposables.length > 0) return deviceGroupDisposables

  return getConfiguredServers(ctx.options).map((server) => {
    const tag = createRelaySessionGroupTag(ctx.scope, server.id)
    return registerSlot('sessions.groups', {
      id: `server-${slugify(server.id)}`,
      title: server.name,
      icon: 'hub',
      match: {
        tags: [tag]
      },
      showWhenEmpty: true,
      actions: [createSessionGroupAction(t.sessionGroups.createSession, [tag])]
    })
  })
}

export async function activatePlugin(ctx: PluginClientContext) {
  const style = document.createElement('style')
  style.textContent = relayClientCss
  document.head.appendChild(style)

  const disposables: Disposable[] = [
    ...(await registerRelaySessionGroups(ctx)),
    ctx.views.register('home', (container, view) => renderRelayView(container, ctx, view)),
    ctx.commands.register('connect', async () => {
      const response = await ctx.api.fetch('relay/connect', { method: 'POST' })
      return await response.json()
    }),
    ctx.commands.register('disconnect', async () => {
      const response = await ctx.api.fetch('relay/disconnect', { method: 'POST' })
      return await response.json()
    }),
    ctx.commands.register('config-refresh', async () => {
      const response = await ctx.api.fetch('relay/config-refresh', { method: 'POST' })
      if (response.ok) return await response.json()
      if (response.status === 404 || response.status === 405) {
        const statusResponse = await ctx.api.fetch('relay/status')
        return await statusResponse.json()
      }
      const text = await response.text()
      throw new Error(
        text || createRelayClientI18n(ctx.i18n).errors.relayActionFailed('config-refresh', response.status)
      )
    }),
    ctx.commands.register('login', async () => {
      try {
        return await openRelayLogin(ctx, { forcePluginHomeRedirect: true })
      } catch (error) {
        ctx.notifications?.show?.({
          description: error instanceof Error ? error.message : String(error),
          level: 'error',
          title: createRelayClientI18n(ctx.i18n).errors.loginUrlMissing
        })
        throw error
      }
    }),
    ctx.commands.register('search', () => [{
      id: 'status',
      title: createRelayClientI18n(ctx.i18n).launcher.statusTitle,
      titleI18n: relayClientLauncherStatusTitleI18n,
      icon: 'account_circle'
    }])
  ]

  return {
    dispose() {
      disposables.forEach(disposable => disposable.dispose())
      style.remove()
    }
  }
}
