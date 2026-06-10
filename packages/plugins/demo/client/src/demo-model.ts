export const eventName = 'oneworks-plugin-demo-event'

export const pretty = value => JSON.stringify(value, null, 2)

export const getDemoTabs = t => [
  { action: 'server', icon: 'terminal', label: t('tabServer') },
  { action: 'api', icon: 'api', label: t('tabApi') },
  { action: 'toast', icon: 'data_object', label: t('tabToast') },
  { action: 'reload', icon: 'refresh', label: t('tabReload') },
  { action: 'sender', icon: 'edit_square', label: t('tabSender') },
  { action: 'projectFileTree', icon: 'account_tree', label: t('tabProjectFileTree') },
  { action: 'overlay', icon: 'select_window', label: t('tabOverlay') }
]

export const emitDemoEvent = detail => {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

export const getInitialResult = (ctx, view, variant, t) => ({
  host: view.host,
  message: t('resultReady'),
  routeId: view.routeId,
  scope: ctx.scope,
  variant
})
