export const cuaDriverCss = `
.cua-driver { box-sizing: border-box; display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; color: var(--text-color); font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.cua-driver__tab-panel > .config-view__editor-wrap { flex: 0 0 auto; min-height: auto; }
.cua-driver .config-view__section-body { display: flex; flex: 0 0 auto; min-height: auto; flex-direction: column; gap: var(--subpage-tertiary-gap); overflow: visible; }
.cua-driver__error { display: flex; align-items: flex-start; gap: 8px; margin-block-end: var(--subpage-secondary-gap, 16px); border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 7%, var(--app-shell-content-bg)); }
.cua-driver .cua-driver__rule-form { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(148px, auto) auto; gap: var(--subpage-tertiary-gap); align-items: center; }
.cua-driver__rule-form .plugin-host-control-input.ant-input,
.cua-driver__rule-form .plugin-host-control-input.ant-input-affix-wrapper,
.cua-driver__rule-form .plugin-host-control-select.ant-select,
.cua-driver__rule-form .plugin-host-control-select.ant-select .ant-select-selector,
.cua-driver__rule-form .plugin-host-control-button.ant-btn { height: 40px; min-height: 40px; }
.cua-driver__example { display: block; margin-top: 8px; color: var(--sub-text-color); overflow-wrap: anywhere; }
.cua-driver__rules { list-style: none; margin: 0; padding: 0; }
.cua-driver__rules li { display: grid; grid-template-columns: 22px minmax(180px, 1fr) minmax(148px, auto) auto; gap: var(--subpage-tertiary-gap); align-items: center; min-height: 44px; border-top: 1px solid var(--border-color); padding: 8px 0; }
.cua-driver__rules li:first-child { border-top: 0; }
.cua-driver__rule-index { display: inline-grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; color: var(--sub-text-color); background: color-mix(in srgb, var(--text-color) 8%, transparent); font-size: 10px; font-variant-numeric: tabular-nums; }
.cua-driver__rules code { overflow: hidden; color: var(--text-color); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cua-driver__rules .plugin-host-control-button.ant-btn.ant-btn-icon-only { width: 32px !important; min-width: 32px !important; height: 32px !important; min-height: 32px !important; }
.cua-driver__empty { margin: 0; color: var(--sub-text-color); }
.cua-driver__inline-control { display: flex; min-width: min(320px, 100%); justify-content: flex-end; }
.cua-driver__inline-control .plugin-host-control-select, .cua-driver__inline-control .plugin-host-control-input { width: min(320px, 100%); }
@media (max-width: 720px) {
  .cua-driver .cua-driver__rule-form { grid-template-columns: minmax(0, 1fr) minmax(132px, auto); }
  .cua-driver__rule-form > :first-child { grid-column: 1 / -1; }
  .cua-driver__rules li { grid-template-columns: 22px minmax(0, 1fr) auto; }
  .cua-driver__rules .cua-driver__rule-index { grid-row: 1 / 3; }
  .cua-driver__rules code { grid-column: 2 / -1; grid-row: 1; }
  .cua-driver__rules .plugin-host-control-select { grid-column: 2; grid-row: 2; width: min(190px, 100%); }
  .cua-driver__rules .plugin-host-control-button { grid-column: 3; grid-row: 2; }
}
`
