/* eslint-disable max-lines -- plugin registry centralizes scoped runtime registrations and cleanup semantics. */

import { buildApiUrl } from '#~/api/base'
import { createServerUrlFromBase, normalizeServerBaseUrl } from '#~/runtime-config'

import { isPluginContributionGroupDisabled, isPluginContributionItemDisabled } from './plugin-contribution-preferences'
import type {
  PluginCleanup,
  PluginClientApiCallOptions,
  PluginClientApiHandler,
  PluginClientApiRegistration,
  PluginClientApiRuntimeRegistration,
  PluginCommandHandler,
  PluginContributionAvailability,
  PluginContributionSurface,
  PluginDiagnostic,
  PluginDisposable,
  PluginExtensionContributionRegistration,
  PluginExtensionPointRegistration,
  PluginLauncherSearchProvider,
  PluginRouteRegistration,
  PluginRuntimeEndpoint,
  PluginRuntimeInstance,
  PluginServerRuntimeRole,
  PluginSlot,
  PluginViewRegistration
} from './plugin-manifest'

type SlotContribution = Record<string, unknown> & { id: string }
type ExtensionPointRecord = PluginExtensionPointRegistration & { pluginScope: string }
type ExtensionContributionRecord = PluginExtensionContributionRegistration & {
  extensionPoint: string
  pluginScope: string
}
type ExtensionPointAvailableHandler = (
  point: ExtensionPointRecord
) => PluginCleanup | Promise<PluginCleanup>
interface ExtensionPointListenerRecord {
  active: boolean
  activeCleanup?: PluginDisposable
  handler: ExtensionPointAvailableHandler
  id: string
  scope: string
  targetKey: string
  version: number
}
type PluginApiRecord = PluginClientApiRuntimeRegistration & {
  handler: PluginClientApiHandler
}
interface PendingPluginApiCall {
  callerScope: string
  input?: unknown
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}
type RegistryListener = () => void

interface PluginRegistryRemoteOptions {
  serverBaseUrl?: string
}

interface PluginRegistryRuntimeContext {
  runtime?: PluginRuntimeEndpoint
  surfaces?: PluginContributionSurface[]
}

const createPluginRegistryApiUrl = (path: string, serverBaseUrl?: string) => {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl)
  return normalizedServerBaseUrl == null
    ? buildApiUrl(path)
    : createServerUrlFromBase(normalizedServerBaseUrl, path)
}

const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const pluginRuntimeRoles = new Set<PluginServerRuntimeRole>(['manager', 'workspace'])
const pluginContributionSurfaces = new Set<PluginContributionSurface>(['launcher', 'workspace'])

const slotFromManifestKey = {
  chatHeaderActions: 'chat.header.actions',
  chatHeaderMoreMenu: 'chat.header.moreMenu',
  chatInteractionPanelEmptyActions: 'chat.interactionPanel.emptyActions',
  launcherSearchProviders: 'launcher.searchProviders',
  navFooterBefore: 'nav.footer.before',
  navItems: 'nav.items',
  navMoreMenu: 'nav.moreMenu',
  routeHeaderActions: 'route.header.actions',
  routeMoreMenuItems: 'route.moreMenu.items',
  routeSidebarContextMenu: 'route.sidebar.contextMenu',
  routeWindowBarActions: 'route.windowBar.actions',
  sessionGroups: 'sessions.groups',
  workbenchAddMenu: 'workbench.addMenu',
  workbenchTabs: 'workbench.tabs'
} as const satisfies Record<string, PluginSlot>

const toDisposable = (cleanup: PluginCleanup): PluginDisposable | null => {
  if (cleanup == null) return null
  if (typeof cleanup === 'function') return { dispose: cleanup }
  return cleanup
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeRuntimeRoles = (value: unknown): PluginServerRuntimeRole[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const roles = [
    ...new Set(
      value.filter((role): role is PluginServerRuntimeRole =>
        typeof role === 'string' && pluginRuntimeRoles.has(role as PluginServerRuntimeRole)
      )
    )
  ]
  return roles.length === 0 ? undefined : roles
}

const normalizeContributionSurfaces = (value: unknown): PluginContributionSurface[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const surfaces = [
    ...new Set(
      value.filter((surface): surface is PluginContributionSurface =>
        typeof surface === 'string' && pluginContributionSurfaces.has(surface as PluginContributionSurface)
      )
    )
  ]
  return surfaces.length === 0 ? undefined : surfaces
}

const readRuntimeRoles = (availability: unknown) => (
  isRecord(availability) ? normalizeRuntimeRoles(availability.roles) : undefined
)

const readContributionSurfaces = (availability: unknown) => (
  isRecord(availability) ? normalizeContributionSurfaces(availability.surfaces) : undefined
)

export class PluginRegistry {
  private commands = new Map<string, { handler: PluginCommandHandler; scope: string }>()
  private diagnostics: PluginDiagnostic[] = []
  private disposablesByScope = new Map<string, PluginDisposable[]>()
  private extensionContributions = new Map<string, Map<string, ExtensionContributionRecord>>()
  private extensionPointListeners = new Map<string, Map<string, ExtensionPointListenerRecord>>()
  private extensionPoints = new Map<string, ExtensionPointRecord>()
  private instances = new Map<string, PluginRuntimeInstance>()
  private listeners = new Set<RegistryListener>()
  private nextExtensionPointListenerId = 0
  private pendingPluginApiCalls = new Map<string, Set<PendingPluginApiCall>>()
  private pluginApis = new Map<string, PluginApiRecord>()
  private routes = new Map<string, PluginRouteRegistration & { scope: string }>()
  private slots = new Map<PluginSlot, Map<string, SlotContribution & { pluginScope: string }>>()
  private views = new Map<string, PluginViewRegistration & { scope: string }>()
  private launcherProviders = new Map<string, PluginLauncherSearchProvider & { scope: string }>()
  private runtime?: PluginRuntimeEndpoint
  private surfaces = new Set<PluginContributionSurface>(['workspace'])

  getSnapshot() {
    return {
      diagnostics: [...this.diagnostics],
      extensionContributions: Object.fromEntries(
        [...this.extensionContributions.entries()].map(([extensionPoint, values]) => [
          extensionPoint,
          this.extensionPoints.has(extensionPoint) ? [...values.values()] : []
        ])
      ) as Record<string, ExtensionContributionRecord[]>,
      extensionPoints: [...this.extensionPoints.values()],
      instances: [...this.instances.values()],
      launcherProviders: [...this.launcherProviders.values()],
      pluginApis: [...this.pluginApis.values()].map(({ handler: _handler, ...api }) => api),
      routes: [...this.routes.values()],
      runtime: this.runtime,
      slots: Object.fromEntries(
        [...this.slots.entries()].map(([slot, values]) => [slot, [...values.values()]])
      ) as Partial<Record<PluginSlot, Array<SlotContribution & { pluginScope: string }>>>,
      views: [...this.views.values()]
    }
  }

  setRuntimeContext(context: PluginRegistryRuntimeContext = {}) {
    this.runtime = context.runtime
    this.surfaces = new Set(
      context.surfaces?.length === 0 || context.surfaces == null ? ['workspace'] : context.surfaces
    )
    this.emit()
  }

  subscribe(listener: RegistryListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setInstances(instances: PluginRuntimeInstance[]) {
    this.diagnostics = []
    this.instances = new Map(instances.map(instance => [instance.scope, instance]))
    for (const instance of instances) {
      this.addDiagnostics(instance.diagnostics ?? [])
    }
    for (const instance of instances) {
      if (instance.enabled === false) continue
      this.registerManifestExtensionPoints(instance)
    }
    for (const instance of instances) {
      if (instance.enabled === false) continue
      this.registerManifestContributions(instance)
    }
    this.emit()
  }

  registerInstanceContributions(instance: PluginRuntimeInstance) {
    this.registerManifestExtensionPoints(instance)
    this.registerManifestContributions(instance)
  }

  disposeScope(scope: string) {
    this.disposablesByScope.get(scope)?.forEach((disposable) => {
      disposable.dispose()
    })
    this.disposablesByScope.delete(scope)
    this.diagnostics = this.diagnostics.filter(diagnostic => this.getDiagnosticScope(diagnostic) !== scope)
    this.commands = new Map([...this.commands].filter(([, value]) => value.scope !== scope))
    this.extensionPoints = new Map([...this.extensionPoints].filter(([, value]) => value.pluginScope !== scope))
    this.removeExtensionPointListenersByScope(scope)
    for (const [extensionPoint, values] of this.extensionContributions) {
      const nextValues = new Map([...values].filter(([, value]) => value.pluginScope !== scope))
      if (nextValues.size === 0) {
        this.extensionContributions.delete(extensionPoint)
      } else {
        this.extensionContributions.set(extensionPoint, nextValues)
      }
    }
    this.pluginApis = new Map([...this.pluginApis].filter(([, value]) => value.pluginScope !== scope))
    this.rejectPendingPluginApiCallsForCaller(scope, `Plugin "${scope}" was disposed before the API call was ready.`)
    this.routes = new Map([...this.routes].filter(([, value]) => value.scope !== scope))
    this.views = new Map([...this.views].filter(([, value]) => value.scope !== scope))
    this.launcherProviders = new Map([...this.launcherProviders].filter(([, value]) => value.scope !== scope))
    for (const [slot, values] of this.slots) {
      this.slots.set(slot, new Map([...values].filter(([, value]) => value.pluginScope !== scope)))
    }
    this.emit()
  }

  addDisposable(scope: string, cleanup: PluginCleanup) {
    const disposable = toDisposable(cleanup)
    if (disposable == null) return
    const disposables = this.disposablesByScope.get(scope) ?? []
    disposables.push(disposable)
    this.disposablesByScope.set(scope, disposables)
  }

  addDiagnostic(diagnostic: PluginDiagnostic) {
    this.diagnostics.push(diagnostic)
    this.emit()
  }

  addDiagnostics(diagnostics: PluginDiagnostic[]) {
    if (diagnostics.length <= 0) return
    this.diagnostics.push(...diagnostics)
  }

  registerCommand(scope: string, commandId: string, handler: PluginCommandHandler) {
    if (!this.validateIdentifier(scope, commandId, 'command')) return { dispose: () => {} }
    const key = this.scopedKey(scope, commandId)
    if (this.commands.has(key)) {
      this.duplicate(scope, 'command', key)
      return { dispose: () => {} }
    }
    this.commands.set(key, { handler, scope })
    const disposable = { dispose: () => this.commands.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  async executeCommand(
    scope: string,
    commandId: string,
    payload?: unknown,
    options: PluginRegistryRemoteOptions = {}
  ) {
    const key = commandId.includes('/') ? commandId : this.scopedKey(scope, commandId)
    const command = this.commands.get(key)
    if (command != null) return command.handler(payload)

    const [targetScope, targetCommandId] = key.split('/', 2)
    if (targetScope == null || targetCommandId == null) {
      throw new Error(`Plugin command "${commandId}" is not registered`)
    }
    const response = await fetch(
      createPluginRegistryApiUrl(
        `/api/plugins/${encodeURIComponent(targetScope)}/commands/${encodeURIComponent(targetCommandId)}`,
        options.serverBaseUrl
      ),
      {
        body: JSON.stringify({ payload }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      }
    )
    if (!response.ok) throw new Error(`Plugin command "${key}" failed with status ${response.status}`)
    const body = await response.json() as unknown
    if (
      body != null && typeof body === 'object' && 'success' in body && (body as { success?: unknown }).success === true
    ) {
      return (body as { data?: unknown }).data
    }
    return body
  }

  registerPluginApi(scope: string, api: PluginClientApiRegistration) {
    if (!this.validateIdentifier(scope, api.id, 'plugin API')) return { dispose: () => {} }
    if (typeof api.handler !== 'function') {
      this.addDiagnostic({
        level: 'error',
        message: `Plugin API "${scope}/${api.id}" must register a handler function.`,
        pluginScope: scope
      })
      return { dispose: () => {} }
    }
    const key = this.scopedKey(scope, api.id)
    if (this.pluginApis.has(key)) {
      this.duplicate(scope, 'plugin API', key)
      return { dispose: () => {} }
    }
    this.pluginApis.set(key, { ...api, pluginScope: scope })
    const disposable = {
      dispose: () => {
        this.pluginApis.delete(key)
        this.emit()
      }
    }
    this.addDisposable(scope, disposable)
    this.drainPendingPluginApiCalls(key)
    this.emit()
    return disposable
  }

  async callPluginApi(
    callerScope: string,
    target: string,
    input?: unknown,
    options: PluginClientApiCallOptions = {}
  ) {
    const api = this.normalizePluginApiTarget(callerScope, target)
    if (api == null) {
      throw new Error(`Plugin API target "${target}" is invalid.`)
    }
    const record = this.pluginApis.get(api.key)
    if (record != null) {
      return await this.invokePluginApi(record, callerScope, input)
    }
    return await this.waitForPluginApi(callerScope, api.key, input, options)
  }

  registerSlot(scope: string, slot: PluginSlot, contribution: SlotContribution) {
    const preparedContribution = this.prepareRuntimeContribution(scope, contribution)
    if (preparedContribution == null) return { dispose: () => {} }
    if (!this.validateIdentifier(scope, contribution.id, `slot ${slot}`)) return { dispose: () => {} }
    const key = this.scopedKey(scope, contribution.id)
    const values = this.slots.get(slot) ?? new Map()
    if (values.has(key)) {
      this.duplicate(scope, `slot ${slot}`, key)
      return { dispose: () => {} }
    }
    values.set(key, { ...preparedContribution, pluginScope: scope })
    this.slots.set(slot, values)
    const disposable = { dispose: () => values.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  registerRoute(scope: string, route: PluginRouteRegistration) {
    const preparedRoute = this.prepareRuntimeContribution(scope, route)
    if (preparedRoute == null) return { dispose: () => {} }
    if (!this.validateIdentifier(scope, route.id, 'route')) return { dispose: () => {} }
    const key = this.scopedKey(scope, route.id)
    if (this.routes.has(key)) {
      this.duplicate(scope, 'route', key)
      return { dispose: () => {} }
    }
    this.routes.set(key, { ...preparedRoute, scope })
    const disposable = { dispose: () => this.routes.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  registerView(scope: string, view: PluginViewRegistration) {
    if (!this.validateIdentifier(scope, view.id, 'view')) return { dispose: () => {} }
    const key = this.scopedKey(scope, view.id)
    if (this.views.has(key)) {
      this.duplicate(scope, 'view', key)
      return { dispose: () => {} }
    }
    this.views.set(key, { ...view, scope })
    const disposable = { dispose: () => this.views.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  registerLauncherSearchProvider(scope: string, provider: PluginLauncherSearchProvider) {
    const preparedProvider = this.prepareRuntimeContribution(scope, provider)
    if (preparedProvider == null) return { dispose: () => {} }
    if (!this.validateIdentifier(scope, provider.id, 'launcher search provider')) return { dispose: () => {} }
    const key = this.scopedKey(scope, provider.id)
    if (this.launcherProviders.has(key)) {
      this.duplicate(scope, 'launcher search provider', key)
      return { dispose: () => {} }
    }
    this.launcherProviders.set(key, { ...preparedProvider, scope })
    const disposable = { dispose: () => this.launcherProviders.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  registerExtensionPoint(scope: string, point: PluginExtensionPointRegistration) {
    const preparedPoint = this.prepareRuntimeContribution(scope, point)
    if (preparedPoint == null) return { dispose: () => {} }
    if (!this.validateIdentifier(scope, point.id, 'extension point')) return { dispose: () => {} }
    const key = this.scopedKey(scope, point.id)
    if (this.extensionPoints.has(key)) {
      this.duplicate(scope, 'extension point', key)
      return { dispose: () => {} }
    }
    this.extensionPoints.set(key, { ...preparedPoint, pluginScope: scope })
    const disposable = {
      dispose: () => {
        this.extensionPoints.delete(key)
        this.deactivateExtensionPointListeners(key)
        this.emit()
      }
    }
    this.addDisposable(scope, disposable)
    this.activateExtensionPointListeners(key)
    this.emit()
    return disposable
  }

  onExtensionPointAvailable(
    scope: string,
    target: string,
    handler: ExtensionPointAvailableHandler
  ) {
    const extensionPoint = this.normalizeExtensionPointTarget(scope, target)
    if (extensionPoint == null) return { dispose: () => {} }

    const id = `${scope}/extension-listener/${++this.nextExtensionPointListenerId}`
    const listener: ExtensionPointListenerRecord = {
      active: false,
      handler,
      id,
      scope,
      targetKey: extensionPoint.key,
      version: 0
    }
    const values = this.extensionPointListeners.get(extensionPoint.key) ?? new Map()
    values.set(id, listener)
    this.extensionPointListeners.set(extensionPoint.key, values)

    const disposable = {
      dispose: () => {
        const currentValues = this.extensionPointListeners.get(extensionPoint.key)
        currentValues?.delete(id)
        if (currentValues?.size === 0) {
          this.extensionPointListeners.delete(extensionPoint.key)
        }
        this.disposeExtensionPointListener(listener)
      }
    }
    this.addDisposable(scope, disposable)
    this.runExtensionPointListenerIfAvailable(listener)
    return disposable
  }

  contributeExtensionPoint(
    scope: string,
    target: string,
    contribution: PluginExtensionContributionRegistration
  ) {
    const preparedContribution = this.prepareRuntimeContribution(scope, contribution)
    if (preparedContribution == null) return { dispose: () => {} }
    const extensionPoint = this.normalizeExtensionPointTarget(scope, target)
    if (extensionPoint == null) return { dispose: () => {} }
    if (!this.validateIdentifier(scope, preparedContribution.id, `extension contribution ${extensionPoint.key}`)) {
      return { dispose: () => {} }
    }
    if (!this.extensionPoints.has(extensionPoint.key)) {
      this.addDiagnostic({
        level: 'warning',
        message:
          `Plugin extension point "${extensionPoint.key}" is not registered for contribution "${scope}/${contribution.id}".`,
        pluginScope: scope
      })
      return { dispose: () => {} }
    }
    const key = this.scopedKey(scope, preparedContribution.id)
    const values = this.extensionContributions.get(extensionPoint.key) ?? new Map()
    if (values.has(key)) {
      this.duplicate(scope, `extension contribution ${extensionPoint.key}`, key)
      return { dispose: () => {} }
    }
    values.set(key, { ...preparedContribution, extensionPoint: extensionPoint.key, pluginScope: scope })
    this.extensionContributions.set(extensionPoint.key, values)
    const disposable = { dispose: () => values.delete(key) }
    this.addDisposable(scope, disposable)
    this.emit()
    return disposable
  }

  hasExtensionPoint(scope: string, target: string) {
    const extensionPoint = this.normalizeExtensionPointTarget(scope, target)
    return extensionPoint != null && this.extensionPoints.has(extensionPoint.key)
  }

  getExtensionContributions(scope: string, target: string) {
    const extensionPoint = this.normalizeExtensionPointTarget(scope, target)
    if (extensionPoint == null || !this.extensionPoints.has(extensionPoint.key)) return []
    return [...(this.extensionContributions.get(extensionPoint.key)?.values() ?? [])]
  }

  findRoute(scope: string, routeId: string) {
    return this.routes.get(this.scopedKey(scope, routeId))
  }

  findView(scope: string, viewId: string) {
    return this.views.get(this.scopedKey(scope, viewId))
  }

  private prepareRuntimeContribution<T extends object>(scope: string, contribution: T): T | undefined {
    return this.prepareContribution(this.instances.get(scope), contribution)
  }

  private prepareManifestContribution<T extends object>(
    instance: PluginRuntimeInstance,
    contribution: T,
    inheritedAvailability?: PluginContributionAvailability
  ): T | undefined {
    return this.prepareContribution(instance, contribution, inheritedAvailability)
  }

  private prepareContribution<T extends object>(
    instance: PluginRuntimeInstance | undefined,
    contribution: T,
    inheritedAvailability?: PluginContributionAvailability
  ): T | undefined {
    if (!this.isContributionAvailable(instance, contribution, inheritedAvailability)) return undefined

    const preparedContribution = this.applyInheritedAvailability(contribution, inheritedAvailability)
    const children = (preparedContribution as { children?: unknown }).children
    if (!Array.isArray(children)) return preparedContribution

    const childInheritedAvailability = this.getChildInheritedAvailability(preparedContribution, inheritedAvailability)
    const filteredChildren = children
      .filter(isRecord)
      .map(child => this.prepareContribution(instance, child, childInheritedAvailability))
      .filter((child): child is Record<string, unknown> => child != null)

    if (filteredChildren.length === children.length) return preparedContribution
    const rest = { ...(preparedContribution as Record<string, unknown>) }
    delete rest.children
    return (filteredChildren.length === 0
      ? rest
      : { ...rest, children: filteredChildren }) as T
  }

  private applyInheritedAvailability<T extends object>(
    contribution: T,
    inheritedAvailability?: PluginContributionAvailability
  ): T {
    const inheritedRoles = readRuntimeRoles(inheritedAvailability)
    const inheritedSurfaces = readContributionSurfaces(inheritedAvailability)
    const shouldApplyRoles = readRuntimeRoles(contribution) == null && inheritedRoles != null
    const shouldApplySurfaces = readContributionSurfaces(contribution) == null && inheritedSurfaces != null
    if (!shouldApplyRoles && !shouldApplySurfaces) return contribution
    return {
      ...contribution,
      ...(shouldApplyRoles ? { roles: inheritedRoles } : {}),
      ...(shouldApplySurfaces ? { surfaces: inheritedSurfaces } : {})
    }
  }

  private isContributionAvailable(
    instance: PluginRuntimeInstance | undefined,
    contribution: unknown,
    inheritedAvailability?: PluginContributionAvailability
  ) {
    const runtimeRoles = readRuntimeRoles(contribution) ??
      readRuntimeRoles(inheritedAvailability) ??
      this.getInstanceServerRuntimeRoles(instance)
    if (runtimeRoles != null && this.runtime?.role != null && !runtimeRoles.includes(this.runtime.role)) {
      return false
    }

    const surfaces = readContributionSurfaces(contribution) ?? readContributionSurfaces(inheritedAvailability)
    if (surfaces != null && !surfaces.some(surface => this.surfaces.has(surface))) {
      return false
    }

    return true
  }

  private getChildInheritedAvailability(
    contribution: unknown,
    inheritedAvailability?: PluginContributionAvailability
  ): PluginContributionAvailability {
    return {
      roles: readRuntimeRoles(contribution) ?? readRuntimeRoles(inheritedAvailability),
      surfaces: readContributionSurfaces(contribution) ?? readContributionSurfaces(inheritedAvailability)
    }
  }

  private getInstanceServerRuntimeRoles(instance: PluginRuntimeInstance | undefined) {
    return normalizeRuntimeRoles(instance?.manifest?.plugin?.server?.roles)
  }

  private registerManifestContributions(instance: PluginRuntimeInstance) {
    const contributions = instance.plugin?.contributions ?? instance.manifest?.plugin?.contributions
    if (contributions == null) return
    if (!isPluginContributionGroupDisabled(instance.scope, 'extensionContributions')) {
      contributions.extensionContributions?.forEach((contribution, index) => {
        if (isPluginContributionItemDisabled(instance.scope, 'extensionContributions', contribution, index)) return
        const preparedContribution = this.prepareManifestContribution(instance, contribution, contributions)
        if (preparedContribution == null) return
        this.onExtensionPointAvailable(
          instance.scope,
          preparedContribution.target,
          () => this.contributeExtensionPoint(instance.scope, preparedContribution.target, preparedContribution)
        )
      })
    }
    for (const [manifestKey, slot] of Object.entries(slotFromManifestKey)) {
      if (isPluginContributionGroupDisabled(instance.scope, manifestKey)) continue
      const values = contributions[manifestKey as keyof typeof contributions]
      if (!Array.isArray(values)) continue
      values.forEach((value, index) => {
        if (isPluginContributionItemDisabled(instance.scope, manifestKey, value, index)) return
        const contribution = this.prepareManifestContribution(
          instance,
          value as unknown as SlotContribution,
          contributions
        )
        if (contribution == null) return
        this.registerSlot(instance.scope, slot, contribution as SlotContribution)
      })
    }
    if (
      contributions.routeMoreMenuItems == null &&
      Array.isArray(contributions.routeMoreMenu) &&
      !isPluginContributionGroupDisabled(instance.scope, 'routeMoreMenuItems')
    ) {
      contributions.routeMoreMenu.forEach((value, index) => {
        if (isPluginContributionItemDisabled(instance.scope, 'routeMoreMenuItems', value, index)) return
        const contribution = this.prepareManifestContribution(
          instance,
          value as unknown as SlotContribution,
          contributions
        )
        if (contribution == null) return
        this.registerSlot(instance.scope, 'route.moreMenu.items', contribution as SlotContribution)
      })
    }
    if (!isPluginContributionGroupDisabled(instance.scope, 'workspaceDrawerTabs')) {
      contributions.workspaceDrawerTabs?.forEach((tab, index) => {
        if (isPluginContributionItemDisabled(instance.scope, 'workspaceDrawerTabs', tab, index)) return
        const contribution = this.prepareManifestContribution(instance, tab, contributions)
        if (contribution == null) return
        this.registerSlot(instance.scope, 'workbench.tabs', {
          ...contribution,
          placement: contribution.placement ?? 'right'
        })
      })
    }
    if (isPluginContributionGroupDisabled(instance.scope, 'routes')) return
    contributions.routes?.forEach((route, index) => {
      if (isPluginContributionItemDisabled(instance.scope, 'routes', route, index)) return
      const contribution = this.prepareManifestContribution(instance, route, contributions)
      if (contribution == null || contribution.clientView == null) return
      this.registerRoute(instance.scope, {
        description: contribution.description,
        descriptionI18n: contribution.descriptionI18n,
        icon: contribution.icon,
        id: contribution.routeId ?? contribution.id,
        i18n: contribution.i18n,
        roles: contribution.roles,
        surfaces: contribution.surfaces,
        title: contribution.title,
        titleI18n: contribution.titleI18n,
        viewId: contribution.clientView
      })
    })
  }

  private registerManifestExtensionPoints(instance: PluginRuntimeInstance) {
    const contributions = instance.plugin?.contributions ?? instance.manifest?.plugin?.contributions
    if (contributions == null || isPluginContributionGroupDisabled(instance.scope, 'extensionPoints')) return
    contributions.extensionPoints?.forEach((point, index) => {
      if (isPluginContributionItemDisabled(instance.scope, 'extensionPoints', point, index)) return
      const contribution = this.prepareManifestContribution(instance, point, contributions)
      if (contribution == null) return
      this.registerExtensionPoint(instance.scope, contribution)
    })
  }

  private validateIdentifier(scope: string, id: string, kind: string) {
    if (identifierPattern.test(id)) return true
    this.addDiagnostic({
      level: 'error',
      message: `Plugin ${kind} id "${id}" is invalid for scope "${scope}". Expected ${identifierPattern.source}.`,
      pluginScope: scope
    })
    return false
  }

  private duplicate(scope: string, kind: string, key: string) {
    this.addDiagnostic({
      level: 'error',
      message: `Duplicate plugin ${kind} registration "${key}" in scope "${scope}".`,
      pluginScope: scope
    })
  }

  private getDiagnosticScope(diagnostic: PluginDiagnostic) {
    return 'pluginScope' in diagnostic ? diagnostic.pluginScope : diagnostic.scope
  }

  private scopedKey(scope: string, id: string) {
    return `${scope}/${id}`
  }

  private normalizeExtensionPointTarget(scope: string, target: string) {
    const normalized = target.trim()
    if (normalized === '') {
      this.addDiagnostic({
        level: 'error',
        message: `Plugin extension point target is empty in scope "${scope}".`,
        pluginScope: scope
      })
      return undefined
    }
    const parts = normalized.split('/')
    const targetScope = parts.length === 1 ? scope : parts[0]
    const pointId = parts.length === 1 ? parts[0] : parts[1]
    if (parts.length > 2 || targetScope == null || pointId == null) {
      this.addDiagnostic({
        level: 'error',
        message:
          `Plugin extension point target "${target}" is invalid in scope "${scope}". Expected "point" or "scope/point".`,
        pluginScope: scope
      })
      return undefined
    }
    if (!this.validateIdentifier(scope, targetScope, 'extension point scope')) return undefined
    if (!this.validateIdentifier(scope, pointId, 'extension point id')) return undefined
    return {
      id: pointId,
      key: this.scopedKey(targetScope, pointId),
      scope: targetScope
    }
  }

  private normalizePluginApiTarget(scope: string, target: string) {
    const normalized = target.trim()
    if (normalized === '') {
      this.addDiagnostic({
        level: 'error',
        message: `Plugin API target is empty in scope "${scope}".`,
        pluginScope: scope
      })
      return undefined
    }
    const parts = normalized.split('/')
    const targetScope = parts.length === 1 ? scope : parts[0]
    const apiId = parts.length === 1 ? parts[0] : parts[1]
    if (parts.length > 2 || targetScope == null || apiId == null) {
      this.addDiagnostic({
        level: 'error',
        message: `Plugin API target "${target}" is invalid in scope "${scope}". Expected "api" or "scope/api".`,
        pluginScope: scope
      })
      return undefined
    }
    if (!this.validateIdentifier(scope, targetScope, 'plugin API scope')) return undefined
    if (!this.validateIdentifier(scope, apiId, 'plugin API id')) return undefined
    return {
      id: apiId,
      key: this.scopedKey(targetScope, apiId),
      scope: targetScope
    }
  }

  private activateExtensionPointListeners(extensionPointKey: string) {
    const point = this.extensionPoints.get(extensionPointKey)
    if (point == null) return
    this.extensionPointListeners.get(extensionPointKey)?.forEach(listener => {
      this.runExtensionPointListener(listener, point)
    })
  }

  private deactivateExtensionPointListeners(extensionPointKey: string) {
    this.extensionPointListeners.get(extensionPointKey)?.forEach(listener => {
      this.disposeExtensionPointListener(listener)
    })
  }

  private runExtensionPointListenerIfAvailable(listener: ExtensionPointListenerRecord) {
    const point = this.extensionPoints.get(listener.targetKey)
    if (point == null) return
    this.runExtensionPointListener(listener, point)
  }

  private runExtensionPointListener(listener: ExtensionPointListenerRecord, point: ExtensionPointRecord) {
    if (listener.active) return
    listener.active = true
    const version = ++listener.version
    Promise.resolve(listener.handler(point))
      .then((cleanup) => {
        const disposable = toDisposable(cleanup)
        if (listener.version !== version || !this.isExtensionPointListenerRegistered(listener)) {
          disposable?.dispose()
          return
        }
        listener.activeCleanup = disposable ?? undefined
      })
      .catch((error) => {
        if (listener.version !== version || !this.isExtensionPointListenerRegistered(listener)) return
        listener.active = false
        this.addDiagnostic({
          level: 'error',
          message: `Plugin extension point listener for "${listener.targetKey}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          pluginScope: listener.scope
        })
      })
  }

  private isExtensionPointListenerRegistered(listener: ExtensionPointListenerRecord) {
    return this.extensionPointListeners.get(listener.targetKey)?.get(listener.id) === listener
  }

  private disposeExtensionPointListener(listener: ExtensionPointListenerRecord) {
    listener.version += 1
    listener.active = false
    listener.activeCleanup?.dispose()
    listener.activeCleanup = undefined
  }

  private removeExtensionPointListenersByScope(scope: string) {
    for (const [targetKey, values] of this.extensionPointListeners) {
      for (const [id, listener] of values) {
        if (listener.scope !== scope) continue
        values.delete(id)
        this.disposeExtensionPointListener(listener)
      }
      if (values.size === 0) {
        this.extensionPointListeners.delete(targetKey)
      }
    }
  }

  private invokePluginApi(record: PluginApiRecord, callerScope: string, input?: unknown) {
    return Promise.resolve(
      record.handler(input, {
        apiId: record.id,
        callerScope,
        targetScope: record.pluginScope
      })
    )
  }

  private waitForPluginApi(
    callerScope: string,
    key: string,
    input: unknown,
    options: PluginClientApiCallOptions
  ) {
    return new Promise((resolve, reject) => {
      const pending: PendingPluginApiCall = {
        callerScope,
        input,
        reject,
        resolve
      }
      if (options.timeoutMs != null && options.timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          const calls = this.pendingPluginApiCalls.get(key)
          calls?.delete(pending)
          if (calls?.size === 0) {
            this.pendingPluginApiCalls.delete(key)
          }
          reject(new Error(`Timed out waiting for plugin API "${key}" to register.`))
        }, options.timeoutMs)
      }
      const calls = this.pendingPluginApiCalls.get(key) ?? new Set()
      calls.add(pending)
      this.pendingPluginApiCalls.set(key, calls)
    })
  }

  private drainPendingPluginApiCalls(key: string) {
    const record = this.pluginApis.get(key)
    const calls = this.pendingPluginApiCalls.get(key)
    if (record == null || calls == null) return
    this.pendingPluginApiCalls.delete(key)
    calls.forEach((call) => {
      if (call.timer != null) clearTimeout(call.timer)
      void this.invokePluginApi(record, call.callerScope, call.input)
        .then(call.resolve, call.reject)
    })
  }

  private rejectPendingPluginApiCallsForCaller(callerScope: string, message: string) {
    for (const [key, calls] of this.pendingPluginApiCalls) {
      for (const call of calls) {
        if (call.callerScope !== callerScope) continue
        if (call.timer != null) clearTimeout(call.timer)
        calls.delete(call)
        call.reject(new Error(message))
      }
      if (calls.size === 0) {
        this.pendingPluginApiCalls.delete(key)
      }
    }
  }

  private emit() {
    this.listeners.forEach(listener => listener())
  }
}
