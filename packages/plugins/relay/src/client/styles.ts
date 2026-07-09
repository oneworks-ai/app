/* eslint-disable max-lines -- relay plugin route styles stay bundled with the renderer CSS injection. */
import { adminListSurfaceCss } from '@oneworks/components/admin-list-surface'

export const relayClientCss = `
${adminListSurfaceCss}
.oneworks-relay { box-sizing: border-box; min-height: 100%; padding: 0; color: var(--text-color, var(--ant-color-text, #1f2328)); background: transparent; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay--documents-tab { height: 100%; display: grid; }
.oneworks-relay--team-config-content-tab { height: 100%; display: grid; }
.oneworks-relay--documents-tab .oneworks-relay__shell,
.oneworks-relay--documents-tab .oneworks-relay__surface,
.oneworks-relay--documents-tab .oneworks-relay__profile,
.oneworks-relay--team-config-content-tab .oneworks-relay__shell,
.oneworks-relay--team-config-content-tab .oneworks-relay__surface,
.oneworks-relay--team-config-content-tab .oneworks-relay__profile { min-height: 0; height: 100%; }
.oneworks-relay--documents-tab .oneworks-relay__profile { grid-template-rows: auto auto minmax(0, 1fr); }
.oneworks-relay--team-config-content-tab .oneworks-relay__profile { grid-template-rows: auto auto minmax(0, 1fr); }
.oneworks-relay--documents-tab .oneworks-relay__documents-panel,
.oneworks-relay--documents-tab .oneworks-relay__documents-panel > .oneworks-relay__profile-section,
.oneworks-relay--documents-tab .oneworks-relay__personal-docs { min-height: 0; height: 100%; }
.oneworks-relay--team-config-content-tab .oneworks-relay__team-detail-panel,
.oneworks-relay--team-config-content-tab .oneworks-relay__team-configs,
.oneworks-relay--team-config-content-tab .oneworks-relay__team-config-content { min-height: 0; height: 100%; }
.oneworks-relay--team-config-content-tab .oneworks-relay__team-detail-panel { grid-template-rows: minmax(0, 1fr); }
.oneworks-relay--team-config-content-tab .oneworks-relay__team-configs--detail { grid-template-rows: auto minmax(0, 1fr); }
.oneworks-relay__shell { width: 100%; min-width: 0; display: grid; gap: var(--subpage-content-card-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__surface { width: 100%; min-width: 0; display: grid; overflow: visible; border: 0; border-radius: 0; background: transparent; }
.oneworks-relay__primary-actions, .oneworks-relay__account-actions { min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__account-actions { flex-wrap: wrap; justify-content: flex-end; }
.oneworks-relay__button { position: relative; width: auto; min-width: var(--app-chrome-icon-size, 18px); min-height: var(--app-chrome-icon-size, 18px); display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--oneworks-overlay-item-radius, 6px); padding: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); background: transparent; cursor: pointer; }
.oneworks-relay__button:disabled { color: var(--disabled-text-color, var(--ant-color-text-disabled, #8c959f)); cursor: default; opacity: .62; }
.oneworks-relay__button:hover { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: transparent; }
.oneworks-relay__button:disabled:hover { color: var(--disabled-text-color, var(--ant-color-text-disabled, #8c959f)); }
.oneworks-relay__button[data-primary="true"] { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: transparent; }
.oneworks-relay__button[data-primary="true"]:hover { color: var(--primary-text-color, var(--ant-color-primary-hover, #1d4ed8)); background: transparent; }
.oneworks-relay__button.ant-btn { width: auto; min-width: var(--app-chrome-icon-size, 18px); height: var(--app-chrome-icon-size, 18px); min-height: var(--app-chrome-icon-size, 18px); border: 0 !important; padding: 0; box-shadow: none !important; background: transparent; }
.oneworks-relay__button.ant-btn:hover,
.oneworks-relay__button.ant-btn:focus,
.oneworks-relay__button.ant-btn:focus-visible,
.oneworks-relay__button.ant-btn:active { border: 0 !important; box-shadow: none !important; background: transparent; }
.oneworks-relay__icon { font-size: 18px; line-height: 1; }
.oneworks-relay__button .oneworks-relay__icon { font-size: var(--app-chrome-icon-size, 18px); }
.oneworks-relay__server-editor { min-width: 0; display: grid; grid-template-columns: minmax(130px, .42fr) minmax(180px, 1fr); gap: var(--oneworks-overlay-icon-gap, 6px); align-items: center; }
.oneworks-relay__field { min-width: 0; min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); color: var(--sub-text-color, var(--ant-color-text, #1f2328)); }
.oneworks-relay__field:focus-within { border-bottom-color: var(--primary-color, var(--ant-color-primary, #1677ff)); color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__input { width: 100%; min-width: 0; border: 0; outline: 0; padding: 0; color: var(--text-color, var(--ant-color-text, #1f2328)); background: transparent; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__input--url { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 500; }
.oneworks-relay__input::placeholder { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); opacity: .82; }
.oneworks-relay__editor-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__notice { padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) calc(var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) + 4px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); color: var(--danger-color, #dc2626); font: 600 12px/1.5 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__accounts { min-width: 0; display: grid; }
.oneworks-relay__empty { padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__empty--center { min-height: min(420px, 52vh); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 0; text-align: center; }
.oneworks-relay__empty--center .oneworks-relay__icon { font-size: 28px; opacity: .54; }
.oneworks-relay__account-avatar { --oneworks-relay-account-avatar-size: 34px; --oneworks-relay-account-avatar-font-size: 12px; position: relative; width: var(--oneworks-relay-account-avatar-size); height: var(--oneworks-relay-account-avatar-size); display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: var(--primary-text-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #2563eb) 14%, transparent); font: 800 var(--oneworks-relay-account-avatar-font-size)/1 ui-sans-serif, system-ui, sans-serif; overflow: visible; }
.relay-admin-list-table__native-icon.oneworks-relay__account-avatar { --oneworks-relay-account-avatar-size: var(--relay-admin-list-native-icon-size, var(--app-chrome-icon-size, 18px)); --oneworks-relay-account-avatar-font-size: calc(var(--oneworks-relay-account-avatar-size) * .56); flex-basis: var(--oneworks-relay-account-avatar-size); max-width: var(--oneworks-relay-account-avatar-size); min-width: var(--oneworks-relay-account-avatar-size); width: var(--oneworks-relay-account-avatar-size); height: var(--oneworks-relay-account-avatar-size); }
.oneworks-relay__account-avatar[data-state="signed-in"] { color: var(--success-color, #0f766e); background: color-mix(in srgb, var(--success-color, #0f766e) 14%, transparent); }
.oneworks-relay__account-avatar[data-state="disabled"] { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); background: color-mix(in srgb, var(--placeholder-color, #57606a) 12%, transparent); }
.oneworks-relay__account-avatar-image { width: 100%; height: 100%; display: block; border-radius: inherit; object-fit: cover; }
.oneworks-relay__device-title { display: flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); }
.oneworks-relay__device-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__device-presence-icon { position: relative; overflow: visible; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-presence-icon[data-current="true"] { color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__device-presence-dot { position: absolute; inset-inline-end: -2px; inset-block-end: -2px; width: 7px; height: 7px; border: 2px solid var(--bg-color, var(--ant-color-bg-container, #fff)); border-radius: 999px; background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-presence-icon[data-state="online"] .oneworks-relay__device-presence-dot { background: var(--success-color, #0f766e); }
.oneworks-relay__device-presence-icon[data-state="stale"] .oneworks-relay__device-presence-dot { background: var(--warning-color, #d97706); }
.oneworks-relay__device-presence-icon[data-state="offline"] .oneworks-relay__device-presence-dot,
.oneworks-relay__device-presence-icon[data-state="unknown"] .oneworks-relay__device-presence-dot { background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-avatar { position: relative; width: 54px; height: 54px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); background: color-mix(in srgb, var(--text-color, #1f2328) 7%, transparent); overflow: visible; }
.oneworks-relay__device-avatar[data-current="true"] { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #2563eb) 14%, transparent); }
.oneworks-relay__device-avatar .oneworks-relay__icon { font-size: 28px; }
.oneworks-relay__device-avatar-dot { position: absolute; inset-inline-end: 3px; inset-block-end: 3px; width: 12px; height: 12px; border: 2px solid var(--bg-color, var(--ant-color-bg-container, #fff)); border-radius: 999px; background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-avatar[data-state="online"] .oneworks-relay__device-avatar-dot { background: var(--success-color, #0f766e); }
.oneworks-relay__device-avatar[data-state="stale"] .oneworks-relay__device-avatar-dot { background: var(--warning-color, #d97706); }
.oneworks-relay__device-avatar[data-state="offline"] .oneworks-relay__device-avatar-dot,
.oneworks-relay__device-avatar[data-state="unknown"] .oneworks-relay__device-avatar-dot { background: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__device-manager-row .relay-admin-list-table__native-title { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font-weight: 650; }
.oneworks-relay__device-management-group-row .relay-admin-list-table__native-title { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__config { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0 0; }
.oneworks-relay__config-header { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__config-title { min-width: 0; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); margin: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 700 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-state { flex: 0 0 auto; border: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); border-radius: 999px; padding: 1px 6px; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); background: transparent; font: 700 10px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-state[data-state="synced"] { border-color: color-mix(in srgb, var(--success-color, #0f766e) 32%, transparent); color: var(--success-color, #0f766e); background: color-mix(in srgb, var(--success-color, #0f766e) 8%, transparent); }
.oneworks-relay__config-state[data-state="error"] { border-color: color-mix(in srgb, var(--danger-color, #dc2626) 32%, transparent); color: var(--danger-color, #dc2626); background: color-mix(in srgb, var(--danger-color, #dc2626) 8%, transparent); }
.oneworks-relay__config-empty { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__config-error { color: var(--danger-color, #dc2626); font: 650 12px/1.4 ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
.oneworks-relay__share { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0 0; border-top: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__share-form { min-width: 0; display: grid; grid-template-columns: minmax(140px, .55fr) minmax(140px, .45fr); gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__share-editor { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__textarea { width: 100%; min-width: 0; min-height: 132px; resize: vertical; border: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); border-radius: var(--oneworks-overlay-item-radius, 6px); outline: 0; padding: 8px; color: var(--text-color, var(--ant-color-text, #1f2328)); background: color-mix(in srgb, var(--bg-color, var(--ant-color-bg-container, #fff)) 96%, var(--text-color, #1f2328) 4%); font: 500 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.oneworks-relay__textarea:focus { border-color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__share-grid { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__share-empty { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__profile { min-width: 0; display: grid; gap: 0; padding-block-start: 0; }
.oneworks-relay__profile--accounts { min-height: min(560px, calc(100vh - 140px)); display: flex; flex-direction: column; gap: 0; padding-block-start: 0; }
.oneworks-relay__profile--accounts.oneworks-relay__profile--launcher { padding-block-start: 10px; }
.oneworks-relay__profile--token-detail { min-height: calc(100dvh - var(--route-container-header-overlay-height, 39px) - 36px); gap: 0; }
.oneworks-relay__profile--token-detail .oneworks-relay__profile-section { min-height: inherit; display: flex; flex-direction: column; gap: 0; padding-block-start: 0; }
.oneworks-relay__profile--team-detail { gap: 0; }
.oneworks-relay__team-detail { min-width: 0; display: grid; gap: 0; }
.oneworks-relay__team-hero { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; gap: var(--subpage-secondary-gap, 10px); padding: 0 0 var(--subpage-secondary-padding, 10px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__team-hero-main { min-width: 0; display: grid; grid-template-columns: 54px minmax(0, 1fr); align-items: center; gap: 10px; }
.oneworks-relay__team-avatar { width: 54px; height: 54px; font-size: 18px; }
.oneworks-relay__team-hero-copy { min-width: 0; display: grid; gap: 2px; }
.oneworks-relay__team-hero-copy strong { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 800 20px/1.12 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-hero-copy > span:last-child { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 12px/1.35 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__profile--team-detail .oneworks-relay__profile-tabs { margin-block: 10px 0; }
.oneworks-relay__profile--team-detail.oneworks-relay__profile--launcher .oneworks-relay__profile-tabs { margin-block-start: 0; }
.oneworks-relay__team-detail-panel { min-width: 0; display: grid; gap: 10px; }
.oneworks-relay__team-detail-panel--route-detail { gap: 0; }
.oneworks-relay__team-detail-panel > .oneworks-relay__config:first-child,
.oneworks-relay__team-detail-panel > .oneworks-relay__share:first-child,
.oneworks-relay__team-detail-panel > .oneworks-relay__profile-section:first-child { padding-block-start: 0; }
.oneworks-relay__team-detail-panel > .oneworks-relay__share:first-child { border-top: 0; }
.oneworks-relay__team-overview, .oneworks-relay__team-projects, .oneworks-relay__team-configs, .oneworks-relay__team-share { min-width: 0; display: grid; gap: 10px; }
.oneworks-relay__team-metric-grid { min-width: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding-bottom: 10px; border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__team-metric-grid--compact { grid-template-columns: repeat(4, minmax(0, 1fr)); padding-bottom: 0; border-bottom: 0; }
.oneworks-relay__team-metric { min-width: 0; min-height: 56px; display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: start; gap: 8px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--sub-border-color, #d8dee4) 78%, transparent); border-radius: var(--oneworks-overlay-item-radius, 6px); background: color-mix(in srgb, var(--bg-color, var(--ant-color-bg-container, #fff)) 96%, var(--text-color, #1f2328) 4%); }
.oneworks-relay__team-metric-icon { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); line-height: 1; }
.oneworks-relay__team-metric[data-tone="primary"] .oneworks-relay__team-metric-icon { color: var(--primary-color, var(--ant-color-primary, #1677ff)); }
.oneworks-relay__team-metric[data-tone="success"] .oneworks-relay__team-metric-icon { color: var(--success-color, #0f766e); }
.oneworks-relay__team-metric[data-tone="warning"] .oneworks-relay__team-metric-icon { color: var(--warning-color, #d97706); }
.oneworks-relay__team-metric[data-tone="danger"] .oneworks-relay__team-metric-icon { color: var(--danger-color, #dc2626); }
.oneworks-relay__team-metric-copy { min-width: 0; display: grid; gap: 2px; }
.oneworks-relay__team-metric-label, .oneworks-relay__team-metric-meta { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.2 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-metric-copy strong { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 800 13px/1.2 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-panel-section { min-width: 0; display: grid; gap: var(--subpage-section-gap, 10px); }
.oneworks-relay__team-section-head { min-width: 0; min-height: 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--subpage-section-gap, 10px); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__team-section-title { min-width: 0; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-section-meta { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.25 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.oneworks-relay__team-detail-list { min-width: 0; display: grid; gap: 0; }
.oneworks-relay__team-detail-row { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, var(--oneworks-relay-team-detail-label-width, 210px)) minmax(0, 1fr); align-items: center; column-gap: var(--subpage-section-gap, 10px); row-gap: var(--subpage-section-gap, 10px); padding: var(--subpage-section-gap, 10px) 0; border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__team-detail-row:first-child { padding-block-start: 0; }
.oneworks-relay__team-detail-label { min-width: 0; display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: center; gap: var(--subpage-section-gap, 10px); color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 11px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-detail-icon { width: 16px; min-width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); line-height: 1; }
.oneworks-relay__team-detail-copy { min-width: 0; display: grid; gap: 1px; }
.oneworks-relay__team-detail-title { color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-detail-description { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-detail-value { min-width: 0; justify-self: start; align-self: center; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 700 12px/1.3 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-state { min-width: 0; min-height: 84px; display: inline-grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding-block: 10px; border-block: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); }
.oneworks-relay__team-state-icon { color: var(--primary-color, var(--ant-color-primary, #1677ff)); font-size: 20px; }
.oneworks-relay__team-state-copy { min-width: 0; display: grid; gap: 3px; font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-state-copy strong { color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 13px/1.3 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-config-list, .oneworks-relay__team-project-list, .oneworks-relay__device-project-list { min-width: 0; }
.oneworks-relay__team-configs--detail { gap: 0; }
.oneworks-relay__team-configs--detail > .route-container-inline-breadcrumb { padding-block-start: 0; }
.oneworks-relay__team-config-detail { min-width: 0; display: grid; gap: 0; }
.oneworks-relay__team-configs--detail > .route-container-inline-breadcrumb + .oneworks-relay__team-config-detail .oneworks-relay__team-detail-row:first-child { padding-block-start: var(--subpage-section-gap, 10px); }
.oneworks-relay__project-rule-detail { gap: 0; padding-block-start: var(--subpage-section-gap, 10px); }
.oneworks-relay__project-rule-tab-panel { min-width: 0; display: grid; padding-block-start: 0; }
.oneworks-relay__project-rule-tabs + .oneworks-relay__project-rule-tab-panel { margin-block-start: 0; }
.oneworks-relay__project-rule-list-panel, .oneworks-relay__project-rule-settings-panel { min-width: 0; display: grid; gap: var(--subpage-section-gap, 10px); }
.oneworks-relay__project-rule-repositories, .oneworks-relay__project-rule-settings { min-width: 0; display: grid; gap: var(--subpage-section-gap, 10px); }
.oneworks-relay__project-rule-repository-list { min-width: 0; display: grid; gap: 6px; }
.oneworks-relay__project-rule-repository-row { min-width: 0; min-height: 34px; display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); align-items: center; gap: var(--subpage-section-gap, 10px); border-block-end: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); padding-block: 6px; }
.oneworks-relay__project-rule-repository-row:first-child { border-block-start: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__project-rule-repository-kind { min-width: 0; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-icon-gap, 6px); color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); overflow: hidden; }
.oneworks-relay__project-rule-repository-copy { min-width: 0; display: grid; gap: 1px; }
.oneworks-relay__project-rule-repository-copy strong { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 12px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__project-rule-repository-copy span { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__project-rule-repository-control { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__project-rule-list-actions { min-width: 0; display: flex; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); padding-block-start: 2px; }
.oneworks-relay__project-rule-fields { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px var(--subpage-section-gap, 10px); }
.oneworks-relay__project-rule-field { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__project-rule-field-copy { min-width: 0; display: grid; gap: 1px; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__project-rule-field-copy strong { color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__project-rule-card-actions { min-width: 0; display: flex; justify-content: flex-end; }
.oneworks-relay__project-rule-files { min-width: 0; min-height: min(420px, calc(100dvh - 300px)); display: flex; }
.oneworks-relay__project-rule-files-list { min-width: 0; flex: 1 1 auto; }
.oneworks-relay__team-config-content { box-sizing: border-box; min-width: 0; min-height: min(540px, calc(100dvh - 250px)); display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px; padding-block-start: 0; border-top: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__team-config-content-editor { min-width: 0; min-height: 320px; display: grid; }
.oneworks-relay--team-config-content-tab .oneworks-relay__team-config-content-editor { min-height: 0; }
.oneworks-relay__team-config-json-editor { min-width: 0; min-height: 0; height: 100%; display: grid; }
.oneworks-relay__team-config-json-textarea { min-height: 320px; resize: vertical; }
.oneworks-relay__team-config-content-actions { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); padding-block-end: var(--subpage-section-gap, 10px); }
.oneworks-relay__team-config-content-state { min-width: 0; margin-inline-end: auto; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-config-action { min-width: 0; min-height: var(--oneworks-overlay-control-height, 30px); display: inline-flex; align-items: center; justify-content: center; gap: var(--oneworks-overlay-icon-gap, 6px); border: 1px solid transparent; border-radius: var(--oneworks-overlay-item-radius, 6px); padding: 0 8px; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); background: transparent; font: 700 12px/1.2 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.oneworks-relay__team-config-action:hover { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); }
.oneworks-relay__team-config-action:disabled { color: var(--disabled-text-color, var(--ant-color-text-disabled, #8c959f)); cursor: default; opacity: .62; }
.oneworks-relay__team-config-action:disabled:hover { background: transparent; }
.oneworks-relay__team-config-action[data-primary="true"] { border-color: color-mix(in srgb, var(--primary-color, #1677ff) 30%, transparent); color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 8%, transparent); }
.oneworks-relay__team-config-action-icon { width: 18px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.oneworks-relay__team-config-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__team-permission-note { min-width: 0; min-height: 34px; display: flex; align-items: center; gap: 8px; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 12px/1.35 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-share-layout { min-width: 0; display: grid; gap: 8px; }
.oneworks-relay__team-share-actions { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__team-share-form { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.oneworks-relay__team-share-field { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__team-share-field > span { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 11px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__team-share-field--wide { min-width: 0; }
.oneworks-relay__host-interaction-list { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
.oneworks-relay__login { min-width: 0; min-height: calc(100dvh - var(--route-container-header-overlay-height, 39px) - 24px); display: flex; flex-direction: column; }
.oneworks-relay__login-frame { flex: 1 1 auto; width: 100%; min-height: inherit; border: 0; background: var(--page-background, var(--ant-color-bg-layout, #fff)); }
.oneworks-relay__login-loading { min-height: 160px; display: inline-flex; align-items: center; justify-content: center; gap: var(--oneworks-overlay-icon-gap, 6px); color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 12px/1.35 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__servers { min-width: 0; display: grid; align-content: start; gap: 10px; }
.oneworks-relay__server-management-form { --relay-admin-list-native-row-columns: var(--app-chrome-icon-size, 18px) minmax(0, 1fr) auto; }
.oneworks-relay__messages { min-width: 0; display: grid; gap: 0; padding: 0; }
.relay-message-center { display: grid; gap: 0; min-width: 0; }
.relay-message-center__filters { display: grid; gap: 8px; min-width: 0; padding: 0 0 var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)); }
.relay-message-center__filter-row { display: flex; align-items: center; justify-content: flex-start; gap: 10px; min-width: 0; }
.relay-message-center__category-filter { flex: 0 1 auto; min-width: 0; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; border-radius: 4px; background: transparent; padding: 0; }
.relay-message-center__category-option { min-height: 24px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border-radius: 4px; padding: 0 8px; color: var(--sub-text-color, var(--ant-color-text-secondary, #57606a)); font: 700 12px/1 ui-sans-serif, system-ui, sans-serif; }
.relay-message-center__category-option.is-selected { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 12%, transparent); }
.relay-message-center__category-option .oneworks-relay__icon { width: 14px; height: 14px; min-width: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
.relay-message-center__empty { padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.relay-message-center__list { display: grid; min-width: 0; }
.relay-message-center__item { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; column-gap: 10px; row-gap: 8px; padding: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)) 0; border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.relay-message-center__team-avatar { width: 34px; height: 34px; min-width: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid color-mix(in srgb, var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)) 74%, transparent); border-radius: 999px; color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 10%, transparent); font-weight: 750; }
.relay-message-center__item--announcement .relay-message-center__team-avatar { color: var(--warning-color, #d97706); background: color-mix(in srgb, var(--warning-color, #d97706) 10%, transparent); }
.relay-message-center__item--team_invitation .relay-message-center__team-avatar { color: var(--primary-color, var(--ant-color-primary, #1677ff)); background: color-mix(in srgb, var(--primary-color, #1677ff) 12%, transparent); }
.relay-message-center__item--personal .relay-message-center__team-avatar { color: var(--success-color, #1a7f37); background: color-mix(in srgb, var(--success-color, #1a7f37) 10%, transparent); }
.relay-message-center__item--system .relay-message-center__team-avatar { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); background: color-mix(in srgb, var(--sub-text-color, #1f2328) 8%, transparent); }
.relay-message-center__team-avatar .oneworks-relay__icon { font-size: 18px; }
.relay-message-center__item-copy { display: grid; gap: 4px; min-width: 0; }
.relay-message-center__item-copy h4 { margin: 0; min-width: 0; overflow: hidden; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 13px/1.3 ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
.relay-message-center__item-copy p { display: -webkit-box; overflow: hidden; margin: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; }
.relay-message-center__item-meta { overflow: hidden; margin: 0; color: color-mix(in srgb, var(--placeholder-color, var(--ant-color-text-secondary, #57606a)) 80%, transparent); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
.relay-message-center__item-side { min-width: max-content; align-self: stretch; display: grid; grid-template-rows: auto 1fr; justify-items: end; }
.relay-message-center__item-side time { align-self: end; color: color-mix(in srgb, var(--placeholder-color, var(--ant-color-text-secondary, #57606a)) 72%, transparent); font: 600 11px/1.3 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.relay-message-center__status { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.oneworks-relay__profile-header { min-width: 0; display: flex; align-items: center; justify-content: flex-start; gap: 14px; padding-block-end: var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__profile-title { min-width: 0; display: inline-grid; grid-template-columns: 60px minmax(0, 1fr); align-items: center; gap: 14px; }
.oneworks-relay__profile-avatar { width: 60px; height: 60px; font-size: 18px; }
.oneworks-relay__profile-heading-copy { min-width: 0; display: grid; gap: 4px; }
.oneworks-relay__profile-eyebrow { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 12px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__profile-heading-copy strong { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 20px/1.2 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__profile-heading-copy span:not(.oneworks-relay__profile-eyebrow) { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 500 13px/1.3 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__profile-tabs { min-width: 0; }
.oneworks-relay__profile--launcher > .oneworks-relay__profile-tabs { padding-block-start: 10px; }
.oneworks-relay__document-tab-actions { min-width: 0; display: inline-flex; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
.oneworks-relay__profile > .oneworks-relay__profile-header + .oneworks-relay__profile-tabs { margin-block-start: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__profile-tab-panel { min-width: 0; display: grid; }
.oneworks-relay__profile-section { min-width: 0; display: grid; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); padding-block-start: 0; }
.oneworks-relay__profile-grid { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); }
.oneworks-relay__profile-fact { min-width: 0; display: grid; gap: 2px; }
.oneworks-relay__profile-fact-label { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 650 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-transform: uppercase; }
.oneworks-relay__profile-fact-value { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__personal-docs { position: relative; min-width: 0; min-height: min(520px, calc(100dvh - 240px)); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 0; overflow: hidden; padding-block-start: 0; }
.oneworks-relay__personal-docs-list-pane { min-width: 0; min-height: 0; height: 100%; display: flex; align-self: stretch; }
.oneworks-relay__personal-docs-list { min-width: 0; min-height: 92px; height: 100%; display: flex; }
.oneworks-relay__personal-docs-list .interaction-list__scroll { min-height: 0; height: 100%; flex: 1 1 auto; }
.oneworks-relay__personal-docs-list .interaction-list__items { min-height: 100%; height: 100%; flex: 1 0 auto; }
.oneworks-relay__document-preview { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 2; width: min(680px, max(420px, calc(100% - 300px))); min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); border-left: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); background: var(--bg-color, var(--ant-color-bg-container, #fff)); box-shadow: -12px 0 24px rgb(0 0 0 / 6%); animation: oneworks-relay-document-preview-in .2s ease-out both; will-change: opacity, transform; }
.oneworks-relay__document-preview--closing { pointer-events: none; animation: oneworks-relay-document-preview-out .26s ease-in both; }
.oneworks-relay__document-preview-head { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 0 0 var(--subpage-tertiary-padding, var(--ant-padding-xs, 8px)); border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); }
.oneworks-relay__document-preview-copy { min-width: 0; display: grid; gap: 2px; padding-inline-start: 10px; }
.oneworks-relay__document-preview-title { min-width: 0; margin: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 13px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__document-preview-breadcrumb { min-width: 0; display: inline-flex; align-items: center; gap: 2px; overflow: hidden; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 700 13px/1.25 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__document-preview-breadcrumb-item { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__document-preview-breadcrumb-item.is-current { color: var(--sub-text-color, var(--ant-color-text, #1f2328)); }
.oneworks-relay__document-preview-breadcrumb-separator { flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 400 14px/1 "Material Symbols Rounded"; }
.oneworks-relay__document-preview-meta { min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 11px/1.25 ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__document-preview-badge { min-width: max-content; align-self: center; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif; }
.oneworks-relay__document-preview-actions { min-width: max-content; display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
.oneworks-relay__document-preview-close { flex: 0 0 auto; overflow: visible; }
.oneworks-relay__document-preview-body { min-width: 0; min-height: 0; display: grid; padding: 0; }
.oneworks-relay__document-preview-editor { min-width: 0; min-height: 0; height: 100%; }
.oneworks-relay__document-preview-pre { min-width: 0; min-height: 0; margin: 0; overflow: auto; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 500 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
.oneworks-relay__document-preview-empty { min-width: 0; min-height: 180px; display: flex; align-items: center; justify-content: center; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 12px/1.35 ui-sans-serif, system-ui, sans-serif; text-align: center; }
.oneworks-relay__document-preview-empty--error { color: var(--danger-color, #dc2626); }
@keyframes oneworks-relay-document-preview-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes oneworks-relay-document-preview-out {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(36px); }
}
	.oneworks-relay__profile-row-actions { min-height: 30px; display: flex; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
	.oneworks-relay__profile-message-row { align-items: start; }
	.oneworks-relay__profile-message-row > .oneworks-relay__icon { margin-top: 2px; }
	.oneworks-relay__profile-message-body { min-width: 0; color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 500 11px/1.45 ui-sans-serif, system-ui, sans-serif; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
	.oneworks-relay__link-button { min-width: 0; border: 0; padding: 0; color: inherit; background: transparent; cursor: pointer; text-align: left; }
	.oneworks-relay__link-button:hover, .oneworks-relay__link-button:focus-visible { color: var(--primary-color, var(--ant-color-primary, #1677ff)); outline: 0; }
	.oneworks-relay__token-preview-cell { display: inline-flex; align-items: center; gap: var(--oneworks-overlay-item-gap, 6px); }
	.oneworks-relay__token-preview { flex: 1 1 auto; min-width: 0; color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.oneworks-relay__token-preview-cell .oneworks-relay__button { flex: 0 0 18px; width: 18px; min-width: 18px; min-height: 18px; }
	.oneworks-relay__token-editor { min-width: 0; display: grid; gap: 0; }
	.oneworks-relay__token-editor-row { min-width: 0; display: grid; grid-template-columns: minmax(180px, .42fr) minmax(180px, .58fr); gap: 16px; align-items: center; border-bottom: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); padding: 10px 0; }
	.oneworks-relay__token-editor-label { min-width: 0; display: grid; gap: 3px; }
	.oneworks-relay__token-editor-label strong { color: var(--sub-text-color, var(--ant-color-text, #1f2328)); font: 750 12px/1.25 ui-sans-serif, system-ui, sans-serif; }
	.oneworks-relay__token-editor-label span { color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a)); font: 600 11px/1.35 ui-sans-serif, system-ui, sans-serif; }
	.oneworks-relay__token-editor-control { min-width: 0; }
	.oneworks-relay__token-editor-actions { min-height: 34px; display: flex; align-items: center; justify-content: flex-end; gap: var(--oneworks-overlay-item-gap, 6px); padding-top: 8px; }
	.oneworks-relay__profile--token-detail .oneworks-relay__token-editor { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
	.oneworks-relay__profile--token-detail .oneworks-relay__token-editor-actions { margin-top: auto; border-top: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); padding: 8px 0 0; }
	.oneworks-relay__created-token { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--subpage-tertiary-gap, var(--ant-padding-xs, 8px)); border: 1px solid color-mix(in srgb, var(--success-color, #0f766e) 28%, transparent); border-radius: var(--oneworks-overlay-item-radius, 6px); padding: 6px 8px; color: var(--success-color, #0f766e); background: color-mix(in srgb, var(--success-color, #0f766e) 7%, transparent); }
	.oneworks-relay__created-token--editor { grid-template-columns: minmax(0, 1fr) auto; margin-top: 10px; }
	.oneworks-relay__created-token--editor span { grid-column: 1 / -1; }
	.oneworks-relay__created-token--editor .oneworks-relay__textarea { min-height: 74px; color: inherit; }
	.oneworks-relay__created-token span { font: 700 11px/1.25 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.oneworks-relay__created-token code { min-width: 0; color: inherit; font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-relay__profile-status-code { justify-self: start; min-width: 34px; border-radius: 999px; padding: 2px 6px; color: var(--danger-color, #dc2626); background: color-mix(in srgb, var(--danger-color, #dc2626) 8%, transparent); font: 750 10px/1.2 ui-sans-serif, system-ui, sans-serif; text-align: center; }
.oneworks-relay__profile-status-code[data-ok="true"] { color: var(--success-color, #0f766e); background: color-mix(in srgb, var(--success-color, #0f766e) 8%, transparent); }
@media (max-width: 720px) {
  .oneworks-relay__server-editor { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__server-management-form { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__account-panel { padding-inline-start: 0; }
  .oneworks-relay__account-actions { justify-content: flex-start; }
  .oneworks-relay__share-form { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__profile-header { display: grid; }
  .oneworks-relay__profile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .oneworks-relay__personal-docs { min-height: auto; grid-template-columns: minmax(0, 1fr); overflow: visible; }
  .oneworks-relay__document-preview { position: relative; inset: auto; width: auto; min-height: 320px; border-top: 1px solid var(--sub-border-color, var(--ant-color-border-secondary, #d8dee4)); border-left: 0; box-shadow: none; }
  .oneworks-relay__team-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .oneworks-relay__project-rule-repository-row,
  .oneworks-relay__project-rule-fields { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__team-share-form { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) {
  .oneworks-relay__account-summary { grid-template-columns: 34px minmax(0, 1fr); }
  .oneworks-relay__account-chevron { display: none; }
  .oneworks-relay__account-meta { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__config-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__share-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__profile-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__team-metric-grid { grid-template-columns: minmax(0, 1fr); }
  .oneworks-relay__team-detail-row { grid-template-columns: minmax(0, 1fr); align-items: center; column-gap: var(--subpage-section-gap, 10px); row-gap: var(--subpage-section-gap, 10px); padding: var(--subpage-section-gap, 10px) 0; }
}
`
