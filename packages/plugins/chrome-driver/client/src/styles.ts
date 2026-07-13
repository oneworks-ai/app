export const chromeDriverCss = `
.chrome-driver { box-sizing: border-box; display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; gap: var(--subpage-secondary-gap); overflow-y: auto; overscroll-behavior: contain; color: var(--text-color); font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.chrome-driver > .config-view__editor-wrap { flex: 0 0 auto; }
.chrome-driver .config-view__section-body { display: flex; flex-direction: column; gap: var(--subpage-tertiary-gap); overflow: visible; }
.chrome-driver__alert { display: flex; align-items: center; gap: var(--subpage-tertiary-gap); border: 1px solid color-mix(in srgb, var(--danger-color) 35%, transparent); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 7%, var(--app-shell-content-bg)); }
.chrome-driver__alert > span { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.chrome-driver__alert small, .chrome-driver__alert code { overflow-wrap: anywhere; }
.chrome-driver__advanced-warning { display: flex; align-items: flex-start; gap: 8px; border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent); border-radius: var(--subpage-tertiary-radius); padding: var(--subpage-tertiary-padding); color: var(--warning-color); background: color-mix(in srgb, var(--warning-color) 7%, var(--app-shell-content-bg)); }
.chrome-driver__connection-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--subpage-tertiary-gap); flex-wrap: wrap; }
.chrome-driver__status { display: inline-flex; align-items: center; gap: 6px; color: var(--sub-text-color); font-size: 12px; font-weight: 600; white-space: nowrap; }
.chrome-driver__status > span { width: 7px; height: 7px; border-radius: 50%; background: var(--sub-text-color); }
.chrome-driver__status--connected > span { background: var(--success-color); }
.chrome-driver__status--interrupted > span { background: var(--warning-color); }
.chrome-driver__facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--subpage-tertiary-gap); margin: 0; }
.chrome-driver__facts-wrap { min-width: 0; }
.chrome-driver__facts div { min-width: 0; }
.chrome-driver__facts dt { color: var(--sub-text-color); font-size: 11px; }
.chrome-driver__facts dd { overflow: hidden; margin: 3px 0 0; font: 12px/1.4 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.chrome-driver__hint { display: flex; align-items: flex-start; gap: 8px; margin-top: var(--subpage-tertiary-gap); color: var(--sub-text-color); }
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
  .chrome-driver__connection-actions { width: 100%; justify-content: space-between; }
  .chrome-driver__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .chrome-driver__audit li { grid-template-columns: minmax(58px, auto) minmax(58px, auto); }
  .chrome-driver__audit li details { grid-column: 1 / -1; }
  .chrome-driver__list li { align-items: flex-start; flex-wrap: wrap; }
  .chrome-driver__actions { width: 100%; padding-left: 26px; }
}
`
