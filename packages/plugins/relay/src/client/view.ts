/* eslint-disable max-lines -- relay client view owns login callbacks, device actions, and host API wiring. */
import { createRelayClientI18n } from './i18n.js'
import { openRelayLogin } from './login-action.js'
import { clearLoginCallbackFromUrl, readLoginCallback } from './login-callback.js'
import { buildRelayServerOptionsUpdate } from './options.js'
import { renderRelayViewMarkup } from './render.js'
import type {
  Disposable,
  PluginClientContext,
  PluginViewContext,
  RelayServerStatus,
  RelayStatus,
  RelayViewState
} from './types.js'

class RelayActionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export const renderRelayView = (
  container: HTMLElement,
  ctx: PluginClientContext,
  view?: PluginViewContext
): Disposable => {
  const getMessages = () => createRelayClientI18n(ctx.i18n)
  let state: RelayViewState = {
    loading: true,
    error: null,
    status: null
  }
  let editingServer = false
  let savingServer = false
  let serverDraft = {
    name: '',
    remoteBaseUrl: ''
  }

  const getServers = () => {
    const status = state.status
    const options: NonNullable<RelayStatus['options']> = status?.options ?? {}
    return status?.servers ?? options.servers ?? []
  }

  const getActiveServer = (): RelayServerStatus | undefined => {
    const connection: NonNullable<RelayStatus['connection']> = state.status?.connection ?? {}
    const servers = getServers()
    return servers.find(server => server.active === true) ??
      servers.find(server => server.id === connection.activeServerId) ??
      servers[0]
  }

  const getActiveRemote = () => {
    const connection: NonNullable<RelayStatus['connection']> = state.status?.connection ?? {}
    return connection.remoteBaseUrl ?? getActiveServer()?.remoteBaseUrl
  }

  const resetServerDraft = () => {
    const activeServer = getActiveServer()
    serverDraft = {
      name: activeServer?.name === '-' ? '' : activeServer?.name ?? '',
      remoteBaseUrl: getActiveRemote() ?? ''
    }
  }

  const readStatus = async () => {
    const response = await ctx.api.fetch('relay/status')
    if (!response.ok) {
      throw new Error(getMessages().errors.statusRequestFailed(response.status))
    }
    return await response.json()
  }

  const paint = () => {
    const messages = getMessages()
    const status = state.status
    const connection: NonNullable<RelayStatus['connection']> = status?.connection ?? {}
    const device: NonNullable<RelayStatus['device']> = status?.device ?? {}
    const options: NonNullable<RelayStatus['options']> = status?.options ?? {}
    const servers = getServers()
    const activeServer = getActiveServer()
    const connectionState = state.loading ? 'loading' : connection.state ?? 'idle'

    container.innerHTML = renderRelayViewMarkup({
      activeRemote: getActiveRemote(),
      activeServer,
      configDistribution: status?.configDistribution ?? status?.configSync,
      connectionState,
      device,
      editingServer,
      messages,
      options,
      savingServer,
      servers,
      serverDraft,
      stateError: state.error
    })
  }

  const refresh = async () => {
    state = { ...state, loading: true, error: null }
    paint()
    try {
      state = { loading: false, error: null, status: await readStatus() }
      if (!editingServer) resetServerDraft()
    } catch (error) {
      state = {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        status: state.status
      }
    }
    paint()
  }

  const openServerEditor = () => {
    resetServerDraft()
    editingServer = true
    paint()
  }

  const closeServerEditor = () => {
    editingServer = false
    resetServerDraft()
    paint()
  }

  const saveServer = async () => {
    const updateOptions = view?.options?.update
    if (updateOptions == null) {
      state = {
        ...state,
        error: getMessages().errors.optionsUpdateUnavailable
      }
      paint()
      return
    }

    savingServer = true
    state = { ...state, error: null }
    paint()
    try {
      const activeServer = getActiveServer()
      const nextOptions = buildRelayServerOptionsUpdate(
        view?.options?.value ?? ctx.options ?? {},
        {
          id: activeServer?.id,
          name: serverDraft.name,
          remoteBaseUrl: serverDraft.remoteBaseUrl
        }
      )
      await updateOptions(nextOptions)
      editingServer = false
      ctx.notifications?.show?.({
        level: 'success',
        title: getMessages().actions.serverSaved
      })
      await refresh()
    } catch (error) {
      state = {
        ...state,
        error: error instanceof Error && error.message === 'invalid_relay_server_url'
          ? getMessages().errors.serverUrlInvalid
          : error instanceof Error
          ? error.message
          : String(error)
      }
    } finally {
      savingServer = false
      paint()
    }
  }

  const postAction = async (action: string, payload?: Record<string, unknown>) => {
    const response = await ctx.api.fetch(`relay/${action}`, {
      body: payload == null ? undefined : JSON.stringify(payload),
      headers: payload == null ? undefined : { 'content-type': 'application/json' },
      method: 'POST'
    })
    if (!response.ok) {
      const text = await response.text()
      throw new RelayActionError(
        text || getMessages().errors.relayActionFailed(action, response.status),
        response.status
      )
    }
    return response
  }

  const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

  const refreshConfigDistribution = async () => {
    state = { ...state, loading: true, error: null }
    paint()
    try {
      const response = await postAction('config-refresh')
      state = { loading: false, error: null, status: await response.json() }
    } catch (error) {
      if (error instanceof RelayActionError && (error.status === 404 || error.status === 405)) {
        try {
          state = { loading: false, error: null, status: await readStatus() }
        } catch (statusError) {
          state = {
            loading: false,
            error: toErrorMessage(statusError),
            status: state.status
          }
        }
        paint()
        return
      }
      state = {
        loading: false,
        error: toErrorMessage(error),
        status: state.status
      }
    }
    paint()
  }

  const callAction = async (action: string, serverId?: string, payload: Record<string, unknown> = {}) => {
    state = { ...state, loading: true, error: null }
    paint()
    try {
      const response = await postAction(action, {
        ...payload,
        ...(serverId == null ? {} : { serverId })
      })
      state = { loading: false, error: null, status: await response.json() }
    } catch (error) {
      state = {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        status: state.status
      }
    }
    paint()
  }

  const openLogin = async (serverId?: string) => {
    state = { ...state, loading: true, error: null }
    paint()
    try {
      await openRelayLogin(ctx, { serverId: serverId ?? getActiveServer()?.id })
      state = { ...state, loading: false }
      paint()
    } catch (error) {
      state = {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        status: state.status
      }
      paint()
    }
  }

  const completeLoginFromCallback = async () => {
    const callback = readLoginCallback()
    if (callback == null) return false
    clearLoginCallbackFromUrl()
    await callAction('login-callback', callback.serverId, {
      token: callback.token
    })
    return true
  }

  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-action]')
      : null
    const action = target?.dataset.action
    if (action == null) return
    if (action === 'edit-server') {
      openServerEditor()
      return
    }
    if (action === 'save-server') {
      void saveServer()
      return
    }
    if (action === 'cancel-server') {
      closeServerEditor()
      return
    }
    if (action === 'refresh') {
      void refresh()
      return
    }
    if (action === 'refresh-config') {
      void refreshConfigDistribution()
      return
    }
    if (action === 'login') {
      void openLogin(target?.dataset.serverId || undefined)
      return
    }
    void callAction(action, target?.dataset.serverId || undefined)
  }

  const handleInput = (event: Event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null
    if (target == null) return

    const field = target.dataset.field
    if (field === 'server-name') {
      serverDraft = { ...serverDraft, name: target.value }
      return
    }
    if (field === 'server-url') {
      serverDraft = { ...serverDraft, remoteBaseUrl: target.value }
    }
  }

  const handleSubmit = (event: SubmitEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('.oneworks-relay__server-editor') == null) return
    event.preventDefault()
    void saveServer()
  }

  const getTooltipButton = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>('.oneworks-relay__button[data-tooltip]')
      : null

  const getRelatedTooltipButton = (event: Event) => {
    const relatedTarget = 'relatedTarget' in event
      ? (event as FocusEvent | PointerEvent).relatedTarget
      : null
    return getTooltipButton(relatedTarget)
  }

  const showTooltip = (event: Event) => {
    getTooltipButton(event.target)?.setAttribute('data-tooltip-open', 'true')
  }

  const hideTooltip = (event: Event) => {
    const button = getTooltipButton(event.target)
    if (button == null || button === getRelatedTooltipButton(event)) return
    button.removeAttribute('data-tooltip-open')
  }

  container.addEventListener('click', handleClick)
  container.addEventListener('input', handleInput)
  container.addEventListener('submit', handleSubmit)
  container.addEventListener('focusin', showTooltip)
  container.addEventListener('focusout', hideTooltip)
  container.addEventListener('pointerover', showTooltip)
  container.addEventListener('pointerout', hideTooltip)
  const languageSubscription = ctx.i18n?.subscribe?.(() => {
    paint()
  })
  paint()
  void completeLoginFromCallback().then(handled => {
    if (!handled) void refresh()
  }).catch(() => {
    void refresh()
  })

  return {
    dispose() {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('input', handleInput)
      container.removeEventListener('submit', handleSubmit)
      container.removeEventListener('focusin', showTooltip)
      container.removeEventListener('focusout', hideTooltip)
      container.removeEventListener('pointerover', showTooltip)
      container.removeEventListener('pointerout', hideTooltip)
      languageSubscription?.dispose()
    }
  }
}
