/* eslint-disable max-lines -- plugin runtime keeps activation, scoped APIs, React exposure, and hot reload together. */
import type {
  PluginRuntimeChannelInvocation,
  PluginRuntimeChannelResponse,
  PublicPluginRuntimeEndpoint as PluginRuntimeEndpoint
} from '@oneworks/types'
import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildApiUrl } from '#~/api/base'
import type { NotificationApi, UiNotificationHandle, UiNotificationInput } from '#~/notifications/notification-types'
import { createServerUrlFromBase, isDesktopClientMode, normalizeServerBaseUrl } from '#~/runtime-config'

import { listPluginRuntimeEndpoints } from './api'
import { createPluginI18nContext } from './plugin-i18n'
import type { PluginI18nContext } from './plugin-i18n'
import type {
  PluginCleanup,
  PluginClientApiCallOptions,
  PluginClientApiRegistration,
  PluginCommandHandler,
  PluginExtensionContributionRegistration,
  PluginExtensionPointRegistration,
  PluginExtensionPointRuntimeRegistration,
  PluginLauncherSearchProvider,
  PluginRouteRegistration,
  PluginRuntimeInstance,
  PluginSlot,
  PluginSlotContribution,
  PluginViewRegistration
} from './plugin-manifest'
import { projectPluginNotificationInput } from './plugin-notification-presentation'
import { resolvePluginDisplayName } from './plugin-presentation'
import type { PluginRegistry, PluginScopeRegistrationOwner } from './plugin-registry'
import type { PluginThemeRegistration } from './plugin-theme-contract'

export interface PluginClientContext {
  api: {
    fetch: (path: string, init?: RequestInit) => Promise<Response>
  }
  commands: {
    execute: (commandId: string, payload?: unknown) => Promise<unknown>
    register: (commandId: string, handler: PluginCommandHandler) => { dispose: () => void }
  }
  hot: {
    accept: (callback: () => void | Promise<void>) => { dispose: () => void }
    reload: () => Promise<void>
  }
  i18n: PluginI18nContext
  launcher: {
    registerSearchProvider: (provider: PluginLauncherSearchProvider) => { dispose: () => void }
  }
  notifications: {
    close: (id: string) => void
    muteCurrentPlugin: () => void
    show: (input: Omit<UiNotificationInput, 'source'>) => UiNotificationHandle
  }
  extensionPoints: {
    contribute: (
      target: string,
      contribution: PluginExtensionContributionRegistration
    ) => { dispose: () => void }
    has: (target: string) => boolean
    onAvailable: (
      target: string,
      callback: (
        point: PluginExtensionPointRuntimeRegistration
      ) => PluginCleanup | Promise<PluginCleanup>
    ) => { dispose: () => void }
    register: (point: PluginExtensionPointRegistration) => { dispose: () => void }
  }
  manifest: PluginRuntimeInstance['manifest']
  options: Record<string, unknown>
  pluginApis: {
    call: (target: string, input?: unknown, options?: PluginClientApiCallOptions) => Promise<unknown>
    register: (api: PluginClientApiRegistration) => { dispose: () => void }
  }
  react: {
    Fragment: typeof Fragment
    createElement: typeof createElement
    useCallback: typeof useCallback
    useEffect: typeof useEffect
    useMemo: typeof useMemo
    useRef: typeof useRef
    useState: typeof useState
  }
  routes: {
    register: (route: PluginRouteRegistration) => { dispose: () => void }
  }
  runtime: {
    endpoint?: PluginRuntimeEndpoint
    invokeChannel: (channelId: string, invocation?: PluginRuntimeChannelInvocation) => Promise<unknown>
    listEndpoints: () => Promise<PluginRuntimeEndpoint[]>
  }
  scope: string
  slots: {
    register: <T extends PluginSlot>(slot: T, contribution: PluginSlotContribution<T>) => { dispose: () => void }
  }
  themes: {
    register: (theme: PluginThemeRegistration) => { dispose: () => void }
  }
  views: {
    register: (
      viewId: string,
      renderer: PluginViewRegistration['render'] | PluginViewRegistration
    ) => { dispose: () => void }
  }
}

interface PluginClientModule {
  activatePlugin?: (ctx: PluginClientContext) => Promise<PluginCleanup> | PluginCleanup
}

const noopDisposable = { dispose: () => {} }
let noopNotificationRevision = 0
const createNoopNotificationHandle = () => ({
  close: () => {},
  id: `plugin-notification-noop:${++noopNotificationRevision}`
})

const noopNotificationApi: NotificationApi = {
  close: () => {},
  isSourceMuted: () => false,
  muteSource: () => {},
  show: createNoopNotificationHandle,
  unmuteSource: () => {}
}

interface PluginOwnedNotification {
  close: () => void
  id: string
  hostId: string
  owner: PluginScopeRegistrationOwner
  retire: () => void
}

const MAX_PLUGIN_NOTIFICATION_RECORDS_PER_OWNER = 24
const pluginOwnedNotifications = new WeakMap<NotificationApi, Map<string, PluginOwnedNotification>>()
const pluginNotificationOwnerNamespaces = new WeakMap<PluginScopeRegistrationOwner, string>()
let pluginNotificationOwnerRevision = 0
let pluginNotificationHostRevision = 0

const createPluginNotificationHostId = (owner: PluginScopeRegistrationOwner) => {
  let namespace = pluginNotificationOwnerNamespaces.get(owner)
  if (namespace == null) {
    namespace = `plugin-notification-owner:${++pluginNotificationOwnerRevision}`
    pluginNotificationOwnerNamespaces.set(owner, namespace)
  }
  return `${namespace}:${++pluginNotificationHostRevision}`
}

const getPluginOwnedNotifications = (notifications: NotificationApi) => {
  const current = pluginOwnedNotifications.get(notifications)
  if (current != null) return current
  const created = new Map<string, PluginOwnedNotification>()
  pluginOwnedNotifications.set(notifications, created)
  return created
}

const toDisposable = (cleanup: PluginCleanup): { dispose: () => void } | undefined => {
  if (cleanup == null) return undefined
  if (typeof cleanup === 'function') return { dispose: cleanup }
  return cleanup
}

const isAbsoluteOrProtocolRelativeUrl = (path: string) => /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(path)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const hasDotSegment = (path: string) =>
  path.split(/[/?#]/, 1)[0]?.split('/').some((part) => {
    if (part === '..') return true
    try {
      return decodeURIComponent(part) === '..'
    } catch {
      return false
    }
  }) === true

const normalizePluginApiPath = (scope: string, path: string) => {
  if (isAbsoluteOrProtocolRelativeUrl(path)) {
    throw new Error(`Plugin "${scope}" api.fetch only accepts scoped relative paths.`)
  }
  if (path.startsWith('/api/')) {
    throw new Error(`Plugin "${scope}" api.fetch cannot call top-level /api/* paths.`)
  }
  const trimmed = path.replace(/^\/+/, '')
  if (trimmed === '' || hasDotSegment(trimmed)) {
    throw new Error(`Plugin "${scope}" api.fetch only accepts scoped relative paths.`)
  }
  return `/api/plugins/${encodeURIComponent(scope)}/proxy/${trimmed}`
}

const buildPluginApiUrl = (path: string, serverBaseUrl?: string) => {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl)
  return normalizedServerBaseUrl == null
    ? buildApiUrl(path)
    : createServerUrlFromBase(normalizedServerBaseUrl, path)
}

const normalizeRuntimeChannelResponse = (value: unknown): PluginRuntimeChannelResponse => {
  if (isRecord(value) && 'ok' in value) {
    if (value.ok === true) {
      return {
        ok: true,
        ...('payload' in value ? { payload: value.payload } : {})
      }
    }
    return {
      ok: false,
      error: typeof value.error === 'string' && value.error.trim() !== ''
        ? value.error
        : 'Plugin runtime channel request failed.'
    }
  }
  return { ok: true, payload: value }
}

const parseRuntimeChannelError = async (response: Response) => {
  const fallback = `Plugin runtime channel request failed with HTTP ${response.status}.`
  const text = await response.text().catch(() => '')
  if (text.trim() === '') return fallback
  try {
    const parsed = JSON.parse(text) as unknown
    if (isRecord(parsed)) {
      const error = parsed.error
      if (typeof error === 'string' && error.trim() !== '') return error
      if (isRecord(error) && typeof error.message === 'string' && error.message.trim() !== '') return error.message
    }
  } catch {}
  return text
}

export const invokePluginRuntimeChannel = async (
  scope: string,
  channelId: string,
  invocation: PluginRuntimeChannelInvocation | undefined,
  serverBaseUrl: string | undefined,
  signal?: AbortSignal
) => {
  const response = await fetch(
    buildPluginApiUrl(
      `/api/plugins/${encodeURIComponent(scope)}/runtime/channels/${encodeURIComponent(channelId)}`,
      serverBaseUrl
    ),
    {
      body: JSON.stringify(invocation ?? {}),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal
    }
  )
  if (!response.ok) {
    throw new Error(await parseRuntimeChannelError(response))
  }
  const json = await response.json().catch(() => undefined) as unknown
  const normalized = normalizeRuntimeChannelResponse(json)
  if (!normalized.ok) {
    throw new Error(normalized.error)
  }
  return normalized.payload
}

const isLoopbackHostname = (hostname: string) => (
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]' ||
  hostname === 'localhost'
)

export const resolvePluginClientEntryUrl = ({
  clientOrigin = globalThis.location?.origin,
  instance,
  isDevelopment = import.meta.env.DEV,
  runtimeEndpoint,
  serverBaseUrl,
  useDesktopProxy = isDesktopClientMode()
}: {
  clientOrigin?: string
  instance: PluginRuntimeInstance
  isDevelopment?: boolean
  runtimeEndpoint?: PluginRuntimeEndpoint
  serverBaseUrl?: string
  useDesktopProxy?: boolean
}) => {
  const useDevelopmentEntry = (
    isDevelopment ||
    (
      instance.watch?.enabled === true &&
      instance.devClientEntryKind === 'runtime-source'
    )
  ) &&
    instance.devClientEntryUrl != null &&
    instance.devClientEntryUrl !== ''
  const entryUrl = useDevelopmentEntry
    ? instance.devClientEntryUrl
    : instance.clientEntryUrl

  if (
    entryUrl == null ||
    entryUrl === '' ||
    (useDevelopmentEntry && isDevelopment) ||
    isAbsoluteOrProtocolRelativeUrl(entryUrl) ||
    /^[a-z][a-z\d+.-]*:/i.test(entryUrl)
  ) {
    return entryUrl
  }

  const entryServerBaseUrl = normalizeServerBaseUrl(runtimeEndpoint?.serverBaseUrl) ??
    normalizeServerBaseUrl(serverBaseUrl)
  const resolvedEntryUrl = entryServerBaseUrl == null
    ? buildApiUrl(entryUrl)
    : createServerUrlFromBase(entryServerBaseUrl, entryUrl)
  if (!useDesktopProxy || entryServerBaseUrl == null || clientOrigin == null) {
    return resolvedEntryUrl
  }

  try {
    const clientUrl = new URL(clientOrigin)
    const runtimeUrl = new URL(resolvedEntryUrl)
    if (
      runtimeUrl.origin === clientUrl.origin ||
      !isLoopbackHostname(runtimeUrl.hostname)
    ) {
      return resolvedEntryUrl
    }
    return new URL(
      `/__oneworks_plugin_runtime__/${encodeURIComponent(runtimeUrl.origin)}` +
        `${runtimeUrl.pathname}${runtimeUrl.search}${runtimeUrl.hash}`,
      clientUrl.origin
    ).toString()
  } catch {
    return resolvedEntryUrl
  }
}

export const addPluginClientImportVersion = (entryUrl: string, importVersion: number) => {
  if (entryUrl.startsWith('data:')) return entryUrl
  const clientSourceMarker = '/client-source/'
  const clientSourceMarkerIndex = entryUrl.indexOf(clientSourceMarker)
  const versionedClientSourceEntryUrl = clientSourceMarkerIndex < 0
    ? entryUrl
    : `${entryUrl.slice(0, clientSourceMarkerIndex + clientSourceMarker.length)}@v/${
      encodeURIComponent(String(importVersion))
    }/${entryUrl.slice(clientSourceMarkerIndex + clientSourceMarker.length)}`
  return `${versionedClientSourceEntryUrl}${
    versionedClientSourceEntryUrl.includes('?') ? '&' : '?'
  }pluginVersion=${importVersion}`
}

export async function activatePluginClient({
  getImportVersion,
  instance,
  isActivationCurrent = () => true,
  registry,
  reloadPlugin,
  notifications = noopNotificationApi,
  runtimeEndpoint,
  serverBaseUrl
}: {
  getImportVersion: () => number
  instance: PluginRuntimeInstance
  isActivationCurrent?: () => boolean
  notifications?: NotificationApi
  registry: PluginRegistry
  reloadPlugin: (scope: string) => Promise<void>
  runtimeEndpoint?: PluginRuntimeEndpoint
  serverBaseUrl?: string
}) {
  const entryUrl = resolvePluginClientEntryUrl({
    instance,
    runtimeEndpoint,
    serverBaseUrl
  })
  if (entryUrl == null || entryUrl === '') return
  if (!isActivationCurrent()) return

  const registrationOwner = registry.createScopeRegistrationCheckpoint(instance.scope)
  const isRegistrationCurrent = () =>
    isActivationCurrent() &&
    registry.isScopeRegistrationOwnerActive(instance.scope, registrationOwner)
  const hotCallbacks = new Set<() => void | Promise<void>>()
  const rollbackActivation = () => {
    hotCallbacks.clear()
    registry.rollbackScopeRegistrations(instance.scope, registrationOwner)
  }
  const effectControllers = new Set<AbortController>()
  const createInactiveError = () => new Error(`Plugin activation "${instance.scope}" is no longer active.`)
  const runActivationEffect = async <T>(
    effect: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal
  ) => {
    if (!isRegistrationCurrent()) throw createInactiveError()
    const controller = new AbortController()
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    if (parentSignal?.aborted === true) abortFromParent()
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    effectControllers.add(controller)
    const readAbortReason = () => (
      controller.signal.reason instanceof Error ? controller.signal.reason : createInactiveError()
    )
    const aborted = controller.signal.aborted
      ? Promise.reject<never>(readAbortReason())
      : new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(readAbortReason()), { once: true })
      })
    try {
      const result = await Promise.race([effect(controller.signal), aborted])
      if (!isRegistrationCurrent()) throw createInactiveError()
      return result
    } finally {
      effectControllers.delete(controller)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
  registry.addDisposable(instance.scope, () => {
    effectControllers.forEach(controller => controller.abort(createInactiveError()))
    effectControllers.clear()
  }, registrationOwner)
  const pluginI18n = createPluginI18nContext()
  const scopedPluginI18n: PluginI18nContext = {
    get language() {
      return pluginI18n.language
    },
    get resolvedLanguage() {
      return pluginI18n.resolvedLanguage
    },
    getLanguage: pluginI18n.getLanguage,
    resolveText: pluginI18n.resolveText,
    select: pluginI18n.select,
    subscribe: listener => {
      if (!isRegistrationCurrent()) return noopDisposable
      return registry.addDisposable(
        instance.scope,
        pluginI18n.subscribe(listener),
        registrationOwner
      ) ?? noopDisposable
    },
    t: pluginI18n.t
  }
  const pluginDisplayName = resolvePluginDisplayName(instance, pluginI18n.getLanguage())
  const notificationSource = {
    icon: 'extension',
    kind: 'plugin' as const,
    name: pluginDisplayName,
    scope: instance.scope,
    title: pluginDisplayName
  }
  const activationNotifications = new Set<PluginOwnedNotification>()
  const activationNotificationsById = new Map<string, PluginOwnedNotification>()
  const retireNotification = (owned: PluginOwnedNotification) => {
    activationNotifications.delete(owned)
    if (activationNotificationsById.get(owned.id) === owned) {
      activationNotificationsById.delete(owned.id)
    }
    const current = pluginOwnedNotifications.get(notifications)
    if (current?.get(owned.hostId) === owned) current.delete(owned.hostId)
    if (current?.size === 0) pluginOwnedNotifications.delete(notifications)
  }
  const closeNotification = (owned: PluginOwnedNotification) => {
    const current = pluginOwnedNotifications.get(notifications)
    if (current?.get(owned.hostId) !== owned) {
      owned.retire()
      return
    }
    owned.retire()
    owned.close()
  }
  registry.addDisposable(instance.scope, () => {
    for (const owned of [...activationNotifications]) closeNotification(owned)
    activationNotifications.clear()
  }, registrationOwner)
  const ctx: PluginClientContext = {
    api: {
      fetch: (path, init) =>
        runActivationEffect(
          signal =>
            fetch(buildPluginApiUrl(normalizePluginApiPath(instance.scope, path), serverBaseUrl), {
              ...init,
              credentials: init?.credentials ?? 'include',
              signal
            }),
          init?.signal ?? undefined
        )
    },
    commands: {
      execute: (commandId, payload) =>
        runActivationEffect(signal =>
          registry.executeCommand(instance.scope, commandId, payload, { serverBaseUrl, signal })
        ),
      register: (commandId, handler) =>
        isRegistrationCurrent()
          ? registry.registerCommand(instance.scope, commandId, handler, registrationOwner)
          : noopDisposable
    },
    hot: {
      accept: (callback) => {
        if (!isRegistrationCurrent()) return noopDisposable
        hotCallbacks.add(callback)
        return registry.addDisposable(
          instance.scope,
          { dispose: () => hotCallbacks.delete(callback) },
          registrationOwner
        )
      },
      reload: async () => {
        if (!isRegistrationCurrent()) throw createInactiveError()
        await reloadPlugin(instance.scope)
      }
    },
    i18n: scopedPluginI18n,
    launcher: {
      registerSearchProvider: provider =>
        isRegistrationCurrent()
          ? registry.registerLauncherSearchProvider(instance.scope, provider, registrationOwner)
          : noopDisposable
    },
    notifications: {
      close: id => {
        if (!isRegistrationCurrent()) return
        const owned = activationNotificationsById.get(id)
        if (owned?.owner !== registrationOwner) return
        closeNotification(owned)
      },
      muteCurrentPlugin: () => {
        if (isRegistrationCurrent()) notifications.muteSource(notificationSource)
      },
      show: input => {
        if (!isRegistrationCurrent()) return createNoopNotificationHandle()
        const projectedInput = projectPluginNotificationInput(input)
        const sourceMuted = notifications.isSourceMuted(notificationSource)
        let ownedNotification: PluginOwnedNotification | undefined
        const isNotificationCurrent = () => {
          const owned = ownedNotification
          return owned != null &&
            isRegistrationCurrent() &&
            pluginOwnedNotifications.get(notifications)?.get(owned.hostId) === owned
        }
        const closeOwnedNotification = () => {
          const owned = ownedNotification
          if (owned != null && isNotificationCurrent()) closeNotification(owned)
        }
        const previousLocalNotification = projectedInput.id == null
          ? undefined
          : activationNotificationsById.get(projectedInput.id)
        const hostId = projectedInput.id == null
          ? undefined
          : previousLocalNotification?.hostId ?? createPluginNotificationHostId(registrationOwner)
        const handle = notifications.show({
          ...projectedInput,
          ...(hostId == null ? {} : { id: hostId }),
          actions: projectedInput.actions?.map((action) => {
            const closeOnSuccess = action.closeOnClick !== false
            return {
              ...action,
              closeOnClick: false,
              onClick: async (context) => {
                if (!isNotificationCurrent()) return
                try {
                  const result = await action.onClick?.({
                    ...context,
                    close: () => {
                      closeOwnedNotification()
                    },
                    muteSource: () => {
                      if (!isNotificationCurrent()) return
                      notifications.muteSource(notificationSource)
                      ownedNotification?.retire()
                    }
                  })
                  if (closeOnSuccess) closeOwnedNotification()
                  return result
                } catch (error) {
                  if (isNotificationCurrent()) throw error
                }
              }
            }
          }),
          source: notificationSource
        })
        const localId = projectedInput.id ?? handle.id
        if (sourceMuted || notifications === noopNotificationApi) {
          return {
            close: () => {
              if (isRegistrationCurrent()) handle.close()
            },
            id: localId
          }
        }
        const ownedNotifications = getPluginOwnedNotifications(notifications)
        const owned: PluginOwnedNotification = {
          close: handle.close,
          hostId: handle.id,
          id: localId,
          owner: registrationOwner,
          retire: () => retireNotification(owned)
        }
        ownedNotification = owned
        const replacedHostNotification = ownedNotifications.get(handle.id)
        const replacedLocalNotification = activationNotificationsById.get(localId)
        ownedNotifications.set(handle.id, owned)
        activationNotificationsById.set(localId, owned)
        replacedHostNotification?.retire()
        if (
          replacedLocalNotification != null &&
          replacedLocalNotification !== replacedHostNotification
        ) closeNotification(replacedLocalNotification)
        activationNotifications.add(owned)
        while (activationNotifications.size > MAX_PLUGIN_NOTIFICATION_RECORDS_PER_OWNER) {
          activationNotifications.values().next().value?.retire()
        }
        return {
          close: () => {
            if (isRegistrationCurrent()) closeOwnedNotification()
          },
          id: localId
        }
      }
    },
    extensionPoints: {
      contribute: (target, contribution) =>
        isRegistrationCurrent()
          ? registry.contributeExtensionPoint(instance.scope, target, contribution, registrationOwner)
          : noopDisposable,
      has: target => isRegistrationCurrent() && registry.hasExtensionPoint(instance.scope, target),
      onAvailable: (target, callback) =>
        isRegistrationCurrent()
          ? registry.onExtensionPointAvailable(instance.scope, target, callback, registrationOwner)
          : noopDisposable,
      register: point =>
        isRegistrationCurrent()
          ? registry.registerExtensionPoint(instance.scope, point, registrationOwner)
          : noopDisposable
    },
    manifest: instance.manifest,
    options: instance.options ?? {},
    pluginApis: {
      call: (target, input, options) =>
        runActivationEffect(signal =>
          registry.callPluginApi(instance.scope, target, input, {
            ...options,
            owner: registrationOwner,
            signal
          })
        ),
      register: api =>
        isRegistrationCurrent()
          ? registry.registerPluginApi(instance.scope, api, registrationOwner)
          : noopDisposable
    },
    react: {
      Fragment,
      createElement,
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState
    },
    routes: {
      register: route =>
        isRegistrationCurrent()
          ? registry.registerRoute(instance.scope, route, registrationOwner)
          : noopDisposable
    },
    runtime: {
      endpoint: runtimeEndpoint,
      invokeChannel: (channelId, invocation) =>
        runActivationEffect(signal =>
          invokePluginRuntimeChannel(instance.scope, channelId, invocation, serverBaseUrl, signal)
        ),
      listEndpoints: () => runActivationEffect(signal => listPluginRuntimeEndpoints({ serverBaseUrl }, signal))
    },
    scope: instance.scope,
    slots: {
      register: (slot, contribution) =>
        isRegistrationCurrent()
          ? registry.registerSlot(instance.scope, slot, contribution, registrationOwner)
          : noopDisposable
    },
    themes: {
      register: theme =>
        isRegistrationCurrent()
          ? registry.registerTheme(instance.scope, theme, registrationOwner)
          : noopDisposable
    },
    views: {
      register: (viewId, renderer) =>
        isRegistrationCurrent()
          ? registry.registerView(
            instance.scope,
            typeof renderer === 'function' ? { id: viewId, render: renderer } : { ...renderer, id: viewId },
            registrationOwner
          )
          : noopDisposable
    }
  }

  try {
    const versionedEntryUrl = addPluginClientImportVersion(entryUrl, getImportVersion())
    const module = await import(/* @vite-ignore */ versionedEntryUrl) as PluginClientModule
    if (!isRegistrationCurrent()) {
      rollbackActivation()
      return
    }
    const cleanup = await module.activatePlugin?.(ctx)
    registry.addDisposable(instance.scope, cleanup, registrationOwner)
    if (!isRegistrationCurrent()) {
      rollbackActivation()
      return
    }
    registry.addDisposable(instance.scope, () => {
      hotCallbacks.forEach((callback) => {
        void callback()
      })
      hotCallbacks.clear()
    }, registrationOwner)
    if (!isRegistrationCurrent()) rollbackActivation()
  } catch (error) {
    const isCurrent = isRegistrationCurrent()
    rollbackActivation()
    if (!isCurrent) return
    registry.addDiagnostic({
      level: 'error',
      message: `Failed to activate plugin "${instance.scope}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      pluginScope: instance.scope
    })
  }
}
