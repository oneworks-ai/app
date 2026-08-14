export const oneworksChannelCss = `
.oneworks-channel { color: var(--text-color, #20242a); flex: 1 1 auto; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; height: 100%; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding-right: 2px; }
.oneworks-channel.is-room { overflow: hidden; padding-right: 0; }
.oneworks-channel *, .oneworks-channel *::before, .oneworks-channel *::after { box-sizing: border-box; }
.oneworks-channel__panel { min-width: 0; }
.oneworks-channel__panel.is-room { height: 100%; min-height: 0; padding-top: 0; }
.oneworks-channel__list, .oneworks-channel__scenario-list { border-top: 1px solid var(--border-color, #d8dee4); min-width: 0; }
.oneworks-channel__row { align-items: center; border-bottom: 1px solid var(--border-color, #d8dee4); display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) auto; min-height: 52px; padding: 8px 2px; }
.oneworks-channel__row-main { min-width: 0; }
.oneworks-channel__row-title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__row-detail { color: var(--sub-text-color, #5c6570); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__status { color: var(--sub-text-color, #5c6570); font-size: 12px; text-transform: capitalize; }
.oneworks-channel__status.is-active, .oneworks-channel__status.is-connected, .oneworks-channel__status.is-completed, .oneworks-channel__status.is-processed, .oneworks-channel__status.is-success { color: var(--success-color, #237b4b); }
.oneworks-channel__status.is-blocked, .oneworks-channel__status.is-deferred_work, .oneworks-channel__status.is-leased, .oneworks-channel__status.is-pending { color: var(--warning-color, #9a6700); }
.oneworks-channel__status.is-denied, .oneworks-channel__status.is-error, .oneworks-channel__status.is-failed { color: var(--error-color, #c43d3d); }
.oneworks-channel__room-surface { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.oneworks-channel__room { flex: 1 1 0; height: auto; min-height: 0; }
.oneworks-channel__creator { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.oneworks-channel__entity-picker { align-content: safe center; display: grid; justify-items: center; min-height: 0; overflow: auto; padding: 20px 0; width: 100%; }
.oneworks-channel__entity-picker-content { display: grid; gap: 10px; max-width: 820px; min-width: 0; width: 100%; }
.oneworks-channel__entity-picker-toolbar { align-items: center; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) minmax(180px, 260px); }
.oneworks-channel__entity-picker-toolbar > :last-child { min-width: 0; width: 100%; }
.oneworks-channel__creator-hint { color: var(--sub-text-color, #5c6570); margin: 0; }
.oneworks-channel__entity-section { display: grid; gap: 7px; min-width: 0; }
.oneworks-channel__entity-section + .oneworks-channel__entity-section { border-top: 1px solid var(--border-color, #d8dee4); padding-top: 10px; }
.oneworks-channel__entity-section-heading { align-items: baseline; display: flex; gap: 8px; justify-content: space-between; min-width: 0; }
.oneworks-channel__entity-section-heading > strong { font-size: 12px; }
.oneworks-channel__entity-section-heading > span { color: var(--sub-text-color, #5c6570); font-size: 11px; text-align: right; }
.oneworks-channel__entity-grid { --oneworks-entity-card-row-height: 66px; --oneworks-entity-grid-gap: 10px; align-content: start; display: grid; gap: var(--oneworks-entity-grid-gap); grid-auto-rows: var(--oneworks-entity-card-row-height); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); max-height: calc(var(--oneworks-entity-card-row-height) + var(--oneworks-entity-card-row-height) + var(--oneworks-entity-card-row-height) + var(--oneworks-entity-grid-gap) + var(--oneworks-entity-grid-gap)); max-width: 820px; min-width: 0; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; scrollbar-gutter: stable; width: 100%; }
.oneworks-channel__entity-grid.is-leaders { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.oneworks-channel__entity-grid > .entity-card, .oneworks-channel__entity-grid > .oneworks-channel__entity-card { height: var(--oneworks-entity-card-row-height); min-height: 0; }
.oneworks-channel__entity-card { align-items: center; background: var(--content-background-color, #fff); border: 1px solid var(--border-color, #d8dee4); border-radius: 6px; color: inherit; cursor: pointer; display: grid; font: inherit; gap: 10px; grid-template-columns: 36px minmax(0, 1fr) 18px; min-height: 66px; padding: 10px; text-align: left; }
.oneworks-channel__entity-card.is-create { border-style: dashed; }
.oneworks-channel__entity-card.is-create > .material-symbols-rounded { color: var(--sub-text-color, #5c6570); }
.oneworks-channel__entity-avatar { align-items: center; background: var(--control-background-color, #eef1f4); border-radius: 6px; display: flex; height: 36px; justify-content: center; object-fit: cover; overflow: hidden; width: 36px; }
.oneworks-channel__entity-avatar.is-fallback { color: var(--sub-text-color, #5c6570); font-size: 14px; font-weight: 700; }
.oneworks-channel__entity-avatar.is-create { color: var(--primary-color, #1677ff); }
.oneworks-channel__entity-avatar.is-create > .material-symbols-rounded { font-size: 20px; }
.oneworks-channel__entity-copy { display: grid; min-width: 0; }
.oneworks-channel__entity-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__entity-copy > span { color: var(--sub-text-color, #5c6570); display: -webkit-box; font-size: 12px; line-clamp: 2; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.oneworks-channel__entity-empty { align-items: center; color: var(--sub-text-color, #5c6570); display: grid; gap: 10px; justify-items: center; }
.oneworks-channel__entity-empty > .material-symbols-rounded { font-size: 28px; }
.oneworks-channel__entity-no-results { align-items: center; color: var(--sub-text-color, #5c6570); display: flex; justify-content: center; min-height: 66px; }
.oneworks-channel__creator-composer { margin-top: auto; }
.oneworks-channel__creator-composer .plugin-host-component-sender { width: 100%; }
.oneworks-channel__creator-composer .toolbar-btn--reference .toolbar-btn__text { display: none; }
.oneworks-channel__share-editor { border-bottom: 1px solid var(--border-color, #d8dee4); border-top: 1px solid var(--border-color, #d8dee4); display: grid; flex: 0 0 auto; gap: 12px; padding: 12px 2px 14px; }
.oneworks-channel__share-heading { align-items: center; display: flex; justify-content: space-between; min-width: 0; }
.oneworks-channel__share-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__share-fields { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(180px, 1fr)); }
.oneworks-channel__share-room-link { background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; font: inherit; min-width: 0; padding: 0; text-align: left; }
.oneworks-channel__form { min-width: 0; }
.oneworks-channel__playground-grid { display: grid; gap: 20px; grid-template-columns: minmax(210px, 280px) minmax(0, 1fr); min-width: 0; }
.oneworks-channel__controls, .oneworks-channel__composer, .oneworks-channel__scenario-editor { display: grid; gap: 12px; min-width: 0; }
.oneworks-channel__controls { align-content: start; border-right: 1px solid var(--border-color, #d8dee4); padding-right: 20px; }
.oneworks-channel__field { display: grid; gap: 5px; min-width: 0; }
.oneworks-channel__field label { color: var(--sub-text-color, #5c6570); font-size: 12px; font-weight: 650; }
.oneworks-channel__field > :last-child { min-width: 0; width: 100%; }
.oneworks-channel__target { border-top: 1px solid var(--border-color, #d8dee4); display: grid; gap: 2px; margin-top: 2px; padding-top: 10px; }
.oneworks-channel__target span { color: var(--sub-text-color, #5c6570); font-size: 11px; }
.oneworks-channel__target strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
.oneworks-channel__result { align-items: center; border-top: 1px solid var(--border-color, #d8dee4); display: flex; flex-wrap: wrap; gap: 7px; min-height: 34px; padding-top: 8px; }
.oneworks-channel__result code { color: var(--sub-text-color, #5c6570); font-size: 11px; margin-left: auto; }
.oneworks-channel__scenario-layout { display: grid; gap: 20px; grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr); min-width: 0; }
.oneworks-channel__scenario-editor { min-width: 0; }
.oneworks-channel__scenario-editor .oneworks-channel__playground-grid { grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); }
.oneworks-channel__empty { align-items: center; color: var(--sub-text-color, #5c6570); display: flex; gap: 8px; justify-content: center; min-height: 120px; text-align: center; }
.oneworks-channel__message { color: var(--sub-text-color, #5c6570); margin: 0 0 10px; }
.oneworks-channel__message.is-error { color: var(--error-color, #c43d3d); }
.oneworks-channel__side-content { box-sizing: border-box; min-height: 100%; padding: 10px 12px; width: 100%; }
.oneworks-channel__side-content.is-members { padding: 0; }
.oneworks-channel__side-content.is-connections { display: grid; gap: 10px; align-content: start; }
.oneworks-channel__connection-intro { color: var(--sub-text-color, #5c6570); font-size: 12px; margin: 0; }
.oneworks-channel__connection-candidates { background: var(--control-background-color, #f6f8fa); border: 1px solid var(--border-color, #d8dee4); border-radius: 6px; display: grid; gap: 3px; padding: 10px; }
.oneworks-channel__connection-candidates > span { color: var(--sub-text-color, #5c6570); font-size: 11px; }
.oneworks-channel__connection-candidates > :nth-child(3) { margin-top: 5px; min-width: 0; width: 100%; }
.oneworks-channel__connection-candidate { align-items: center; border-top: 1px solid var(--border-color, #d8dee4); display: grid; gap: 8px; grid-template-columns: 24px minmax(0, 1fr) auto; min-height: 58px; padding: 8px 0 0; }
.oneworks-channel__connections { border-top: 1px solid var(--border-color, #d8dee4); display: grid; }
.oneworks-channel__connection { align-items: center; border-bottom: 1px solid var(--border-color, #d8dee4); display: grid; gap: 2px 10px; grid-template-columns: 24px minmax(0, 1fr) auto; min-height: 68px; padding: 9px 2px; }
.oneworks-channel__connection-icon { height: 24px; object-fit: contain; width: 24px; }
.oneworks-channel__connection-copy { display: grid; min-width: 0; }
.oneworks-channel__connection-copy strong, .oneworks-channel__connection-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__connection-copy small, .oneworks-channel__connection-policy { color: var(--sub-text-color, #5c6570); font-size: 11px; }
.oneworks-channel__connection-status { color: var(--success-color, #237b4b); font-size: 11px; }
.oneworks-channel__connection-status.is-removed, .oneworks-channel__connection-status.is-unavailable { color: var(--error-color, #c43d3d); }
.oneworks-channel__connection-policy { align-items: center; display: flex; gap: 8px; grid-column: 2 / -1; justify-content: space-between; }
.oneworks-channel__empty.is-compact { min-height: 86px; }
.oneworks-channel__panel-members { display: grid; width: 100%; }
.oneworks-channel__panel-member { align-items: center; background: transparent; border: 0; border-bottom: 1px solid var(--border-color, #d8dee4); color: inherit; cursor: pointer; display: grid; font: inherit; gap: 10px; grid-template-columns: 36px minmax(0, 1fr) 18px; min-height: 58px; padding: 8px 12px; text-align: left; width: 100%; }
.oneworks-channel__panel-member:hover { background: var(--tag-hover-bg, #f5f7f9); }
.oneworks-channel__panel-member:focus-visible { outline: 2px solid color-mix(in srgb, var(--primary-color, #1677ff) 42%, transparent); outline-offset: -2px; }
.oneworks-channel__panel-member > .material-symbols-rounded { color: var(--sub-text-color, #5c6570); }
.oneworks-channel__panel-member-copy { display: grid; min-width: 0; }
.oneworks-channel__panel-member-copy strong, .oneworks-channel__panel-member-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__panel-member-copy span { color: var(--sub-text-color, #5c6570); font-size: 12px; }
.oneworks-channel__room-settings { display: grid; gap: 14px; }
.oneworks-channel__room-settings-summary { align-items: center; display: grid; gap: 12px; grid-template-columns: 56px minmax(0, 1fr); }
.oneworks-channel__room-settings-avatar { align-items: center; display: flex; height: 56px; justify-content: center; width: 56px; }
.oneworks-channel__room-settings-avatar > .group-avatar { --app-chrome-icon-size: 56px; border-radius: 6px; }
.oneworks-channel__room-settings-summary > span { display: grid; gap: 3px; min-width: 0; }
.oneworks-channel__room-settings-summary strong, .oneworks-channel__room-settings-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oneworks-channel__room-settings-summary small, .oneworks-channel__room-settings-platforms { color: var(--sub-text-color, #5c6570); }
.oneworks-channel__danger-button { width: 100%; }
.oneworks-channel__danger-button.ant-btn { justify-content: center; }
.oneworks-channel__room-settings-warning { color: var(--error-color, #c43d3d); font-size: 12px; margin: -4px 0 0; }
@media (max-width: 980px) {
  .oneworks-channel__scenario-layout { grid-template-columns: 1fr; }
  .oneworks-channel__scenario-list { margin-top: 4px; }
}
@media (max-width: 700px) {
  .oneworks-channel__playground-grid, .oneworks-channel__scenario-editor .oneworks-channel__playground-grid { grid-template-columns: 1fr; }
  .oneworks-channel__controls { border-bottom: 1px solid var(--border-color, #d8dee4); border-right: 0; padding-bottom: 14px; padding-right: 0; }
  .oneworks-channel__row { align-items: start; grid-template-columns: minmax(0, 1fr) auto; }
  .oneworks-channel__row-detail { white-space: normal; }
  .oneworks-channel__share-fields { grid-template-columns: 1fr; }
  .oneworks-channel__entity-picker-toolbar { grid-template-columns: 1fr; }
  .oneworks-channel__entity-grid, .oneworks-channel__entity-grid.is-leaders { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .oneworks-channel__entity-section-heading { align-items: start; display: grid; gap: 2px; }
  .oneworks-channel__entity-section-heading > span { text-align: left; }
}
@media (max-width: 480px) {
  .oneworks-channel__entity-grid, .oneworks-channel__entity-grid.is-leaders { grid-auto-rows: max-content; grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: calc(66.6667vw - 16.6667px); padding-right: 0; scrollbar-gutter: auto; }
  .oneworks-channel__entity-grid > .entity-card, .oneworks-channel__entity-grid > .oneworks-channel__entity-card { align-content: center; aspect-ratio: 1; height: auto; justify-items: center; min-height: 0; padding: 10px; text-align: center; }
  .oneworks-channel__entity-grid > .entity-card { gap: 8px; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; }
  .oneworks-channel__entity-grid > .entity-card.has-related-entities { grid-template-columns: minmax(0, 1fr); }
  .oneworks-channel__entity-grid .entity-card__copy, .oneworks-channel__entity-grid .oneworks-channel__entity-copy { justify-items: center; width: 100%; }
  .oneworks-channel__entity-grid .entity-card__name, .oneworks-channel__entity-grid .oneworks-channel__entity-copy strong { display: -webkit-box; overflow: hidden; text-align: center; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .oneworks-channel__entity-grid .entity-card__description, .oneworks-channel__entity-grid .oneworks-channel__entity-copy > span { display: none; }
  .oneworks-channel__entity-grid .entity-card__related-entities { bottom: 7px; position: absolute; right: 7px; }
  .oneworks-channel__entity-card { gap: 8px; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; }
  .oneworks-channel__entity-card.is-create > .material-symbols-rounded:last-child { display: none; }
}
`
