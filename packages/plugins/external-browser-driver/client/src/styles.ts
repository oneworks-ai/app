export const chromeDriverCss = `
.chrome-driver { box-sizing: border-box; display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; color: var(--text-color); font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.chrome-driver .config-view__section-body { display: flex; flex-direction: column; gap: var(--subpage-tertiary-gap); overflow: visible; }
.chrome-driver__alert { display: flex; align-items: center; gap: var(--subpage-tertiary-gap); margin-block-end: var(--subpage-secondary-gap, var(--ant-padding, 16px)); border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 7%, var(--app-shell-content-bg)); }
.chrome-driver__alert > span { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.chrome-driver__alert small, .chrome-driver__alert code { overflow-wrap: anywhere; }
.chrome-driver__advanced-warning { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); color: var(--warning-color); background: color-mix(in srgb, var(--warning-color) 7%, var(--app-shell-content-bg)); }
.chrome-driver__advanced-warning-copy { flex: 1; min-width: min(320px, 100%); }
.chrome-driver__connection-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--subpage-tertiary-gap); flex-wrap: wrap; }
.chrome-driver__status { display: inline-flex; align-items: center; gap: 6px; color: var(--sub-text-color); font-size: 12px; font-weight: 600; white-space: nowrap; }
.chrome-driver__status > span { width: 7px; height: 7px; border-radius: 50%; background: var(--sub-text-color); }
.chrome-driver__status--connected > span { background: var(--success-color); }
.chrome-driver__status--interrupted > span { background: var(--warning-color); }
.chrome-driver__hint { display: flex; align-items: flex-start; gap: 8px; margin-top: var(--subpage-tertiary-gap); color: var(--sub-text-color); }
.chrome-driver__hint--connection { margin: 0; padding-inline: var(--subpage-tertiary-padding); }
.chrome-driver__hint--standalone { margin-top: 0; border: 1px solid var(--border-color); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); background: color-mix(in srgb, var(--primary-color) 4%, var(--app-shell-content-bg)); }
.chrome-driver .config-view__field-row--stacked .config-view__field-control > .chrome-driver__site-rule-form { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(132px, auto) auto; gap: var(--subpage-tertiary-gap); align-items: center; }
.chrome-driver__site-rule-form .plugin-host-control-input.ant-input,
.chrome-driver__site-rule-form .plugin-host-control-input.ant-input-affix-wrapper,
.chrome-driver__site-rule-form .plugin-host-control-select.ant-select,
.chrome-driver__site-rule-form .plugin-host-control-select.ant-select .ant-select-selector,
.chrome-driver__site-rule-form .plugin-host-control-button.ant-btn {
  height: 40px;
  min-height: 40px;
}
.chrome-driver__site-rule-form .plugin-host-control-select.ant-select .ant-select-selector { align-items: center; }
.chrome-driver__site-rule-example { display: block; margin-top: 8px; color: var(--sub-text-color); overflow-wrap: anywhere; }
.chrome-driver__site-rules { list-style: none; margin: 0; padding: 0; }
.chrome-driver__site-rules li { display: grid; grid-template-columns: 22px minmax(180px, 1fr) minmax(132px, auto) auto; gap: var(--subpage-tertiary-gap); align-items: center; min-height: 44px; border-top: 1px solid var(--border-color); padding: 8px 0; }
.chrome-driver__site-rules li:first-child { border-top: 0; }
.chrome-driver__site-rule-index { display: inline-grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; color: var(--sub-text-color); background: color-mix(in srgb, var(--text-color) 8%, transparent); font-size: 10px; font-variant-numeric: tabular-nums; }
.chrome-driver__site-rules code { overflow: hidden; color: var(--text-color); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.chrome-driver__site-rules .plugin-host-control-button.ant-btn.ant-btn-icon-only {
  width: 32px !important;
  min-width: 32px !important;
  height: 32px !important;
  min-height: 32px !important;
}
.chrome-driver__row-action { display: flex; justify-content: flex-end; }
.chrome-driver__empty { margin: 0; color: var(--sub-text-color); }
.chrome-driver__row-action + .chrome-driver__empty, .chrome-driver__row-action + .chrome-driver__list { margin-top: var(--subpage-tertiary-gap); }
.chrome-driver__list, .chrome-driver__audit { list-style: none; margin: 0; padding: 0; }
.chrome-driver__list li { display: flex; align-items: center; gap: 10px; min-height: 42px; border-top: 1px solid var(--border-color); padding: 10px 0; }
.chrome-driver__list li:first-child { border-top: 0; }
.chrome-driver__list li > span { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.chrome-driver__list small { overflow: hidden; color: var(--sub-text-color); text-overflow: ellipsis; white-space: nowrap; }
.chrome-driver__list code { color: var(--sub-text-color); font-size: 10px; overflow-wrap: anywhere; }
.chrome-driver details summary { cursor: pointer; color: var(--sub-text-color); font-size: 11px; }
.chrome-driver details[open] summary { margin-bottom: 4px; }
.chrome-driver__actions { display: flex; flex-wrap: wrap; gap: 7px; }
.chrome-driver__audit li { display: grid; grid-template-columns: minmax(64px, auto) minmax(62px, auto) minmax(160px, 1fr); gap: 10px; align-items: baseline; padding: 5px 0; }
.chrome-driver__audit time { color: var(--sub-text-color); font-variant-numeric: tabular-nums; }
.chrome-driver__audit span { font-weight: 600; }
.chrome-driver__audit .is-succeeded, .chrome-driver__audit .is-approved { color: var(--success-color); }
.chrome-driver__audit .is-failed, .chrome-driver__audit .is-denied { color: var(--danger-color); }
.chrome-driver__audit code { display: block; overflow-wrap: anywhere; white-space: normal; }
.chrome-driver__more { margin-top: var(--subpage-tertiary-gap); }
@media (max-width: 720px) {
  .chrome-driver .native-tabs { --native-tabs-gap: 6px; --native-tabs-icon-size: 15px; }
  .chrome-driver .native-tabs__items { width: 100%; padding-block-end: 2px; scrollbar-width: thin; }
  .chrome-driver .native-tabs__items::-webkit-scrollbar { display: block; height: 3px; }
  .chrome-driver .native-tabs__tab { font-size: 12px; }
  .chrome-driver .native-tabs__label { gap: 4px; }
  .chrome-driver__connection-actions { width: 100%; justify-content: space-between; }
  .chrome-driver__audit li { grid-template-columns: minmax(58px, auto) minmax(58px, auto); }
  .chrome-driver__audit li details { grid-column: 1 / -1; }
  .chrome-driver__list li { align-items: flex-start; flex-wrap: wrap; }
  .chrome-driver__actions { width: 100%; padding-left: 26px; }
  .chrome-driver .config-view__field-row--stacked .config-view__field-control > .chrome-driver__site-rule-form { grid-template-columns: minmax(0, 1fr) minmax(124px, auto); }
  .chrome-driver__site-rule-form > :first-child { grid-column: 1 / -1; }
  .chrome-driver__site-rules li { grid-template-columns: 22px minmax(0, 1fr) auto; }
  .chrome-driver__site-rules .chrome-driver__site-rule-index { grid-row: 1 / 3; }
  .chrome-driver__site-rules code { grid-column: 2 / -1; grid-row: 1; }
  .chrome-driver__site-rules .plugin-host-control-select { grid-column: 2; grid-row: 2; width: min(180px, 100%); }
  .chrome-driver__site-rules .plugin-host-control-button { grid-column: 3; grid-row: 2; }
}
`
