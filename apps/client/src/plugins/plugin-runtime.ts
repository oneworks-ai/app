/* eslint-disable max-lines -- plugin runtime keeps activation, scoped APIs, React exposure, and hot reload together. */
import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PluginRuntimeChannelInvocation,
  PluginRuntimeChannelResponse,
  PluginRuntimeEndpoint
} from '@oneworks/types'

import { buildApiUrl } from '#~/api/base'
import type { NotificationApi, UiNotificationHandle, UiNotificationInput } from '#~/notifications/notification-types'
import { createServerUrlFromBase, normalizeServerBaseUrl } from '#~/runtime-config'

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
  PluginViewRegistration
} from './plugin-manifest'
import type { PluginRegistry } from './plugin-registry'

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
    register: (slot: PluginSlot, contribution: Record<string, unknown> & { id: string }) => { dispose: () => void }
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
const noopNotificationHandle = { close: () => {}, id: '' }

const noopNotificationApi: NotificationApi = {
  close: () => {},
  isSourceMuted: () => false,
  muteSource: () => {},
  show: () => noopNotificationHandle,
  unmuteSource: () => {}
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
  serverBaseUrl: string | undefined
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
      method: 'POST'
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

const resolveEntryUrl = (instance: PluginRuntimeInstance) => {
  return import.meta.env.DEV && instance.devClientEntryUrl != null && instance.devClientEntryUrl !== ''
    ? instance.devClientEntryUrl
    : instance.clientEntryUrl
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
  const entryUrl = resolveEntryUrl(instance)
  if (entryUrl == null || entryUrl === '') return
  if (!isActivationCurrent()) return

  const hotCallbacks = new Set<() => void | Promise<void>>()
  const notificationSource = {
    icon: 'extension',
    kind: 'plugin' as const,
    name: instance.name,
    scope: instance.scope,
    title: instance.displayName ?? instance.name ?? instance.scope
  }
  const ctx: PluginClientContext = {
    api: {
      fetch: (path, init) =>
        fetch(buildPluginApiUrl(normalizePluginApiPath(instance.scope, path), serverBaseUrl), {
          ...init,
          credentials: init?.credentials ?? 'include'
        })
    },
    commands: {
      execute: (commandId, payload) =>
        registry.executeCommand(instance.scope, commandId, payload, { serverBaseUrl }),
      register: (commandId, handler) =>
        isActivationCurrent() ? registry.registerCommand(instance.scope, commandId, handler) : noopDisposable
    },
    hot: {
      accept: (callback) => {
        if (!isActivationCurrent()) return noopDisposable
        hotCallbacks.add(callback)
        const disposable = { dispose: () => hotCallbacks.delete(callback) }
        registry.addDisposable(instance.scope, disposable)
        return disposable
      },
      reload: () => reloadPlugin(instance.scope)
    },
    i18n: createPluginI18nContext(),
    launcher: {
      registerSearchProvider: provider =>
        isActivationCurrent()
          ? registry.registerLauncherSearchProvider(instance.scope, provider)
          : noopDisposable
    },
    notifications: {
      close: notifications.close,
      muteCurrentPlugin: () => notifications.muteSource(notificationSource),
      show: input =>
        isActivationCurrent()
          ? notifications.show({ ...input, source: notificationSource })
          : noopNotificationHandle
    },
    extensionPoints: {
      contribute: (target, contribution) =>
        isActivationCurrent()
          ? registry.contributeExtensionPoint(instance.scope, target, contribution)
          : noopDisposable,
      has: target => isActivationCurrent() && registry.hasExtensionPoint(instance.scope, target),
      onAvailable: (target, callback) =>
        isActivationCurrent()
          ? registry.onExtensionPointAvailable(instance.scope, target, callback)
          : noopDisposable,
      register: point => isActivationCurrent() ? registry.registerExtensionPoint(instance.scope, point) : noopDisposable
    },
    manifest: instance.manifest,
    options: instance.options ?? {},
    pluginApis: {
      call: (target, input, options) => registry.callPluginApi(instance.scope, target, input, options),
      register: api => isActivationCurrent() ? registry.registerPluginApi(instance.scope, api) : noopDisposable
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
      register: route => isActivationCurrent() ? registry.registerRoute(instance.scope, route) : noopDisposable
    },
    runtime: {
      endpoint: runtimeEndpoint,
      invokeChannel: (channelId, invocation) =>
        invokePluginRuntimeChannel(instance.scope, channelId, invocation, serverBaseUrl),
      listEndpoints: () => listPluginRuntimeEndpoints({ serverBaseUrl })
    },
    scope: instance.scope,
    slots: {
      register: (slot, contribution) =>
        isActivationCurrent() ? registry.registerSlot(instance.scope, slot, contribution) : noopDisposable
    },
    views: {
      register: (viewId, renderer) =>
        isActivationCurrent()
          ? registry.registerView(
            instance.scope,
            typeof renderer === 'function' ? { id: viewId, render: renderer } : { ...renderer, id: viewId }
          )
          : noopDisposable
    }
  }

  try {
    const versionedEntryUrl = entryUrl.startsWith('data:')
      ? entryUrl
      : `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}pluginVersion=${getImportVersion()}`
    const module = await import(/* @vite-ignore */ versionedEntryUrl) as PluginClientModule
    if (!isActivationCurrent()) return
    const cleanup = await module.activatePlugin?.(ctx)
    if (!isActivationCurrent()) {
      toDisposable(cleanup)?.dispose()
      hotCallbacks.clear()
      return
    }
    registry.addDisposable(instance.scope, cleanup)
    registry.addDisposable(instance.scope, () => {
      hotCallbacks.forEach((callback) => {
        void callback()
      })
      hotCallbacks.clear()
    })
  } catch (error) {
    if (!isActivationCurrent()) return
    registry.addDiagnostic({
      level: 'error',
      message: `Failed to activate plugin "${instance.scope}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      pluginScope: instance.scope
    })
  }
}
