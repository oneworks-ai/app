export const pluginDemoCss = `
.plugin-demo { box-sizing: border-box; min-height: 100%; padding: 0; color: var(--text-color, #1f2328); background: transparent; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.plugin-demo__surface { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 100%; }
.plugin-demo__shell { display: grid; grid-template-columns: 184px minmax(0, 1fr); align-items: start; gap: 14px; min-width: 0; }
.plugin-demo__rail { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.plugin-demo__tabs { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.plugin-demo__tab { position: relative; display: flex; width: 100%; min-width: 0; min-height: 32px; align-items: center; gap: 8px; border: 0; border-radius: 6px; padding: 0 9px; color: var(--sub-text-color, #57606a); background: transparent; font: 650 12px/1 ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: background-color .16s ease, color .16s ease; }
.plugin-demo__tab::before { content: ''; position: absolute; top: 7px; bottom: 7px; left: 0; width: 2px; border-radius: 999px; background: transparent; }
.plugin-demo__tab.is-active { color: var(--primary-color, #1677ff); background: color-mix(in srgb, var(--primary-color, #1677ff) 12%, transparent); }
.plugin-demo__tab.is-active::before { background: var(--primary-color, #1677ff); }
.plugin-demo__tab:hover, .plugin-demo__tab:focus-visible { outline: none; color: var(--primary-color, #1677ff); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); }
.plugin-demo__tab .plugin-host-icon, .plugin-demo__overlay-tab .plugin-host-icon { width: 16px; min-width: 16px; height: 16px; font-size: 16px; line-height: 1; }
.plugin-demo__tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-demo__extensions { display: flex; flex-direction: column; gap: 4px; min-width: 0; border-top: 1px solid var(--border-color, #d8dee4); padding-top: 10px; }
.plugin-demo__extensions-title { display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; color: var(--sub-text-color, #57606a); font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase; }
.plugin-demo__extension-action { position: relative; display: flex; width: 100%; min-width: 0; min-height: 32px; align-items: center; gap: 8px; border: 0; border-radius: 6px; padding: 0 9px; color: var(--sub-text-color, #57606a); background: transparent; font: 650 12px/1 ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: background-color .16s ease, color .16s ease; }
.plugin-demo__extension-action:hover, .plugin-demo__extension-action:focus-visible { outline: none; color: var(--primary-color, #1677ff); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); }
.plugin-demo__extension-action .plugin-host-icon { width: 16px; min-width: 16px; height: 16px; font-size: 16px; line-height: 1; }
.plugin-demo__extensions-empty { margin: 0; padding: 0 9px; color: var(--sub-text-color, #57606a); font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.plugin-demo__content { min-width: 0; }
.plugin-demo__pre { overflow: auto; max-height: 260px; margin: 0; border: 1px solid var(--border-color, #d8dee4); border-radius: 6px; padding: 10px; color: var(--text-color, #1f2328); background: var(--sub-bg-color, #f6f8fa); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
.plugin-demo__workbench { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.plugin-demo__workbench--split { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: start; gap: 14px; }
.plugin-demo__config-panel { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; min-width: 0; padding: 0; background: transparent; }
.plugin-demo__config-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.plugin-demo__config-group--wide { width: 220px; max-width: 100%; }
.plugin-demo__config-title { display: inline-flex; align-items: center; gap: 6px; color: var(--sub-text-color, #57606a); font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase; }
.plugin-demo__config-icon { display: inline-flex; align-items: center; justify-content: center; width: 15px; min-width: 15px; height: 15px; color: inherit; }
.plugin-demo__control-mount { min-width: 0; }
.plugin-demo__field-list { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
.plugin-demo__field { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; }
.plugin-demo__field-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 28px; color: var(--sub-text-color, #57606a); }
.plugin-demo__preview { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.plugin-demo__host-component { display: none; min-height: 0; border: 1px solid var(--border-color, #d8dee4); border-radius: 6px; padding: 8px; background: var(--bg-color, #fff); }
.plugin-demo__host-component.is-active { display: block; }
.plugin-demo__host-component--sender { border: 0; border-radius: 0; padding: 0; background: transparent; }
.plugin-demo__host-component--tree { height: min(360px, 46vh); overflow: auto; }
.plugin-demo__host-component--overlay { border: 0; padding: 0; background: transparent; }
.plugin-demo__overlay-demo { display: grid; grid-template-columns: 168px minmax(0, 1fr); align-items: start; gap: 12px; min-width: 0; }
.plugin-demo__overlay-tabs { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.plugin-demo__overlay-tab { position: relative; display: flex; width: 100%; min-width: 0; min-height: 34px; align-items: center; gap: 8px; border: 0; border-radius: 6px; padding: 0 9px; color: var(--sub-text-color, #57606a); background: transparent; font: 650 12px/1 ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: background-color .16s ease, color .16s ease; }
.plugin-demo__overlay-tab::before { content: ''; position: absolute; top: 8px; bottom: 8px; left: 0; width: 2px; border-radius: 999px; background: transparent; }
.plugin-demo__overlay-tab.is-active { color: var(--primary-color, #1677ff); background: color-mix(in srgb, var(--primary-color, #1677ff) 12%, transparent); }
.plugin-demo__overlay-tab.is-active::before { background: var(--primary-color, #1677ff); }
.plugin-demo__overlay-tab:hover, .plugin-demo__overlay-tab:focus-visible { outline: none; color: var(--primary-color, #1677ff); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); }
.plugin-demo__overlay-content { min-width: 0; }
@media (max-width: 760px) { .plugin-demo__shell, .plugin-demo__overlay-demo { grid-template-columns: 1fr; } .plugin-demo__tabs, .plugin-demo__overlay-tabs { flex-direction: row; overflow-x: auto; padding-bottom: 2px; } .plugin-demo__tab, .plugin-demo__overlay-tab { width: auto; flex: 0 0 auto; } .plugin-demo__workbench--split { grid-template-columns: 1fr; } }
`
