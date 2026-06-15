interface ActionButtonOptions {
  data?: Record<string, boolean | number | string | undefined>
  disabled?: boolean
  primary?: boolean
  serverId?: string
}

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

export const valueOrDash = (value: unknown) => {
  if (value == null || String(value).trim() === '') return '-'
  return String(value)
}

export const materialIcon = (name: string) =>
  `<span class="oneworks-relay__icon material-symbols-rounded" aria-hidden="true">${escapeHtml(name)}</span>`

export const actionButton = (
  action: string,
  label: string,
  iconName: string,
  options: ActionButtonOptions = {}
) => {
  const disabledAttr = options.disabled === true ? ' disabled' : ''
  const dataAttrs = Object.entries(options.data ?? {})
    .map(([key, value]) => value == null ? '' : ` data-${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join('')
  const serverAttr = options.serverId == null ? '' : ` data-server-id="${escapeHtml(options.serverId)}"`
  const primaryAttr = options.primary === true ? ' data-primary="true"' : ''
  return `<button class="oneworks-relay__button" type="button" aria-label="${escapeHtml(label)}" data-tooltip="${
    escapeHtml(label)
  }" data-action="${escapeHtml(action)}"${disabledAttr}${primaryAttr}${serverAttr}${dataAttrs}>${
    materialIcon(iconName)
  }</button>`
}

export const fact = (iconName: string, label: string, value: unknown) => `
  <div class="oneworks-relay__fact">
    <span class="oneworks-relay__fact-icon">${materialIcon(iconName)}</span>
    <div>
      <p class="oneworks-relay__label">${escapeHtml(label)}</p>
      <p class="oneworks-relay__value">${escapeHtml(valueOrDash(value))}</p>
    </div>
  </div>
`
