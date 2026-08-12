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
}
`
