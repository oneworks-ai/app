export const relayClientCss = `
.oneworks-relay { box-sizing: border-box; min-height: 100%; padding: 0; color: var(--text-color, var(--ant-color-text, #1f2328)); background: transparent; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__shell { width: 100%; min-width: 0; display: grid; gap: var(--subpage-content-card-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__surface { width: 100%; min-width: 0; display: grid; overflow: visible; border: 0; border-radius: 0; background: transparent; }
.oneworks-relay__toolbar { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: 0 0 var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); overflow: visible; }
.oneworks-relay__section-title { min-width: 0; max-width: 100%; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); margin: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 700 13px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__server-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__remote-inline { max-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity: 0; overflow: hidden; text-overflow: ellipsis; transform: translateX(-2px); transition: max-width .16s ease, opacity .16s ease, transform .16s ease; white-space: nowrap; }
.oneworks-relay__section-title:hover .oneworks-relay__remote-inline, .oneworks-relay__section-title:focus-within .oneworks-relay__remote-inline { max-width: min(42vw, 360px); opacity: 1; transform: translateX(0); }
.oneworks-relay__toolbar-right { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__actions { min-height: var(--oneworks-overlay-control-height, 30px); display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__primary-actions, .oneworks-relay__revealed-actions, .oneworks-relay__account-actions { min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__revealed-actions { width: 0; max-width: 0; overflow: hidden; opacity: 0; pointer-events: none; transform: translateX(4px); transition: width .16s ease, max-width .16s ease, opacity .16s ease, transform .16s ease; }
.oneworks-relay__toolbar:hover .oneworks-relay__revealed-actions, .oneworks-relay__toolbar:focus-within .oneworks-relay__revealed-actions { width: 138px; max-width: 138px; overflow: visible; opacity: 1; pointer-events: auto; transform: translateX(0); }
.oneworks-relay__account-actions { flex-wrap: wrap; justify-content: flex-end; }
.oneworks-relay__button { position: relative; width: var(--oneworks-overlay-control-height, 30px); min-width: var(--oneworks-overlay-control-height, 30px); min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--oneworks-overlay-item-radius, 6px); padding: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); background: transparent; cursor: pointer; }
.oneworks-relay__button:disabled { color: var(--disabled-text-color, var(--ant-color-text-disabled, #8c959f)); cursor: default; opacity: .62; }
.oneworks-relay__button::before, .oneworks-relay__button::after { position: absolute; inset-inline-start: 50%; z-index: 20; opacity: 0; pointer-events: none; visibility: hidden; transition: opacity .12s ease, transform .12s ease, visibility .12s ease; }
.oneworks-relay__button::before { content: ""; inset-block-end: calc(100% + 2px); width: 7px; height: 7px; background: var(--text-color, var(--ant-color-text, #1f2328)); transform: translate(-50%, 2px) rotate(45deg); }
.oneworks-relay__button::after { content: attr(data-tooltip); inset-block-end: calc(100% + 6px); max-width: 160px; border-radius: var(--oneworks-overlay-item-radius, 6px); padding: 5px 7px; color: var(--bg-color, var(--ant-color-bg-container, #fff)); background: var(--text-color, var(--ant-color-text, #1f2328)); box-shadow: var(--oneworks-overlay-shadow, 0 6px 18px rgb(0 0 0 / 16%)); font: 600 11px/1.15 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; transform: translate(-50%, 4px); white-space: nowrap; }
.oneworks-relay__toolbar .oneworks-relay__button::before { inset-block-start: calc(100% + 2px); inset-block-end: auto; transform: translate(-50%, -2px) rotate(45deg); }
.oneworks-relay__toolbar .oneworks-relay__button::after { inset-block-start: calc(100% + 6px); inset-block-end: auto; transform: translate(-50%, -4px); }
.oneworks-relay__button:hover::before, .oneworks-relay__button:hover::after, .oneworks-relay__button:focus::before, .oneworks-relay__button:focus::after, .oneworks-relay__button:focus-visible::before, .oneworks-relay__button:focus-visible::after, .oneworks-relay__button[data-tooltip-open="true"]::before, .oneworks-relay__button[data-tooltip-open="true"]::after { opacity: 1; visibility: visible; transform: translate(-50%, 0) rotate(45deg); }
.oneworks-relay__button:hover::after, .oneworks-relay__button:focus::after, .oneworks-relay__button:focus-visible::after, .oneworks-relay__button[data-tooltip-open="true"]::after { transform: translate(-50%, 0); }
.oneworks-relay__button:hover { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: transparent; }
.oneworks-relay__button:disabled:hover { color: var(--disabled-text-color, var(--ant-color-text-disabled, #8c959f)); }
.oneworks-relay__button[data-primary="true"] { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: transparent; }
.oneworks-relay__button[data-primary="true"]:hover { color: var(--primary-text-color, var(--ant-color-primary-hover, #1d4ed8)); background: transparent; }
.oneworks-relay__icon { font-size: 18px; line-height: 1; }
.oneworks-relay__button .oneworks-relay__icon, .oneworks-relay__section-title .oneworks-relay__icon { font-size: 16px; }
.oneworks-relay__server-editor { display: grid; grid-template-columns: minmax(130px, .42fr) minmax(180px, 1fr) auto; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); align-items: center; padding: 0 0 var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__field { min-width: 0; min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); color: var(--sub-text-color, var(--ant-color-text, #1f2328)); }
.oneworks-relay__field:focus-within { border-bottom-color: var(--primary-color, var(--ant-color-primary, #1677ff)); color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__input { width: 100%; min-width: 0; border: 0; outline: 0; padding: 0; color: var(--text-color, var(--ant-color-text, #1f2328)); background: transparent; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__input--url { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 500; }
.oneworks-relay__input::placeholder { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); opacity: .82; }
.oneworks-relay__editor-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__notice { padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) calc(var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) + 4px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); color: var(--danger-color, #dc2626); font: 600 12px/1.5 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__account { min-width: 0; display: grid; border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__account-summary { min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); align-items: center; padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0; cursor: pointer; list-style: none; }
.oneworks-relay__account-summary::-webkit-details-marker { display: none; }
.oneworks-relay__account-summary:focus-visible { outline: 2px solid var(--primary-color, var(--ant-color-primary, #1677ff)); outline-offset: -2px; }
.oneworks-relay__account-panel { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: 0 0 var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) calc(34px + var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px))); }
.oneworks-relay__account-avatar { position: relative; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: var(--primary-text-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #2563eb) 14%, transparent); font: 800 12px/1 ui-sans-serif, system-ui, sans-serif; overflow: visible; }
.oneworks-relay__account-avatar-image { width: 100%; height: 100%; display: block; border-radius: inherit; object-fit: cover; }
.oneworks-relay__account-status { position: absolute; inset-inline-end: -1px; inset-block-end: -1px; width: 10px; height: 10px; border: 2px solid var(--page-background, var(--ant-color-bg-layout, #fff)); border-radius: 999px; background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__account-avatar[data-state="registered"] .oneworks-relay__account-status, .oneworks-relay__account-avatar[data-state="connected"] .oneworks-relay__account-status { background: var(--success-color, #0f766e); }
.oneworks-relay__account-avatar[data-state="connecting"] .oneworks-relay__account-status, .oneworks-relay__account-avatar[data-state="loading"] .oneworks-relay__account-status { background: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__account-avatar[data-state="error"] .oneworks-relay__account-status { background: var(--danger-color, #dc2626); }
.oneworks-relay__account-copy { min-width: 0; display: grid; gap: 2px; }
.oneworks-relay__account-name { min-width: 0; display: flex; align-items: center; gap: 6px; margin: 0; font: 700 13px/1.35 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__account-platform { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__account-state { flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--primary-color, #1677ff) 28%, transparent); border-radius: 999px; padding: 1px 6px; color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); font: 700 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-transform: lowercase; }
.oneworks-relay__account-subtitle, .oneworks-relay__account-email { margin: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__account-chevron { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); transition: transform .16s ease; }
.oneworks-relay__account[open] .oneworks-relay__account-chevron { transform: rotate(180deg); }
.oneworks-relay__account-meta { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__account-fact { min-width: 0; display: grid; gap: 1px; }
.oneworks-relay__account-fact-label { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase; }
.oneworks-relay__account-fact-value { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__account-devices { min-width: 0; display: grid; gap: 4px; padding-block-start: 2px; }
.oneworks-relay__devices-summary { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 11px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__device-row { min-width: 0; min-height: 22px; display: grid; grid-template-columns: 10px minmax(0, max-content) auto minmax(0, 1fr); align-items: center; gap: 6px; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); }
.oneworks-relay__device-status { width: 8px; height: 8px; border-radius: 999px; background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-status[data-state="online"] { background: var(--success-color, #0f766e); }
.oneworks-relay__device-status[data-state="stale"] { background: var(--warning-color, #d97706); }
.oneworks-relay__device-status[data-state="offline"] { background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-name { min-width: 0; max-width: min(280px, 32vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 650 12px/1.3 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__device-chip { min-width: 0; color: var(--primary-color, var(--ant-color-primary, #1677ff)); font: 650 11px/1.2 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.oneworks-relay__device-features { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 11px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__devices-empty { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0 0; }
.oneworks-relay__config-header { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__config-title { min-width: 0; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); margin: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 700 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-state { flex: 0 0 auto; border: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); border-radius: 999px; padding: 1px 6px; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); background: transparent; font: 700 10px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-state[data-state="synced"] { border-color: color-mix(in srgb, var(--success-color, #0f766e) 32%, transparent); color: var(--success-color, #0f766e); background: color-mix(in srgb, var(--success-color, #0f766e) 8%, transparent); }
.oneworks-relay__config-state[data-state="error"] { border-color: color-mix(in srgb, var(--danger-color, #dc2626) 32%, transparent); color: var(--danger-color, #dc2626); background: color-mix(in srgb, var(--danger-color, #dc2626) 8%, transparent); }
.oneworks-relay__config-empty { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-error { color: var(--danger-color, #dc2626); font: 650 12px/1.4 ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
.oneworks-relay__config-grid { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__config-fact { min-width: 0; display: grid; gap: 1px; }
.oneworks-relay__config-fact-label { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase; }
.oneworks-relay__config-fact-value { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__config-sources { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__config-source { min-width: 0; min-height: 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__config-source[data-enabled="false"] { opacity: .72; }
.oneworks-relay__config-source-copy { min-width: 0; display: grid; gap: 1px; }
.oneworks-relay__config-source-name { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 700 12px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__config-source-meta, .oneworks-relay__config-source-state { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 11px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__config-source-actions { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__share { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0 0; border-top: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__share-form { min-width: 0; display: grid; grid-template-columns: minmax(140px, .55fr) minmax(140px, .45fr); gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__share-editor { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__textarea { width: 100%; min-width: 0; min-height: 132px; resize: vertical; border: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); border-radius: var(--oneworks-overlay-item-radius, 6px); outline: 0; padding: 8px; color: var(--text-color, var(--ant-color-text, #1f2328)); background: color-mix(in srgb, var(--page-background, #fff) 94%, transparent); font: 500 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.oneworks-relay__textarea:focus { border-color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__share-grid { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__share-empty { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
@media (max-width: 720px) {
  .oneworks-relay__toolbar { display: grid; }
  .oneworks-relay__server-editor { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__account-panel { padding-inline-start: 0; }
  .oneworks-relay__account-actions { justify-content: flex-start; }
  .oneworks-relay__share-form { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) {
  .oneworks-relay__section-title { flex-wrap: wrap; }
  .oneworks-relay__account-summary { grid-template-columns: 34px minmax(0, 1fr); }
  .oneworks-relay__account-chevron { display: none; }
  .oneworks-relay__account-meta { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__config-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__share-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__device-row { grid-template-columns: 10px minmax(0, 1fr) auto; }
  .oneworks-relay__device-features { grid-column: 2 / -1; }
}
`
