/* eslint-disable max-lines -- admin list surface keeps shared native list/search CSS and helpers in one package entry. */
export const adminListSurfaceCss = String.raw`
.relay-admin-list-table {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
}

.relay-admin-list-table--content {
  flex: 0 0 auto;
  height: auto;
}

.relay-admin-list-table__toolbar {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  min-height: 28px;
  min-width: 0;
}

.relay-admin-list-table__toolbar-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.relay-admin-list-table__search {
  flex: 1 1 auto;
  min-width: 0;
}

.relay-admin-list-table__batch {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  min-height: 28px;
  min-width: 0;
}

.relay-admin-list-table .ant-input-affix-wrapper,
.relay-admin-list-table .ant-select-selector {
  background: color-mix(in srgb, var(--text-color) 3%, transparent) !important;
  border-color: color-mix(in srgb, var(--border-color) 74%, transparent)
    !important;
  border-radius: 6px !important;
  box-shadow: none !important;
  color: var(--text-color) !important;
}

.relay-admin-list-table
  .relay-admin-list-table__search.ant-input-affix-wrapper {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  height: var(--app-chrome-icon-size, 18px);
  padding: 0;
}

.relay-admin-list-table__search .ant-input-prefix {
  margin-inline-end: 6px;
}

.relay-admin-list-table__search-icon {
  color: var(--placeholder-color);
  height: var(--app-chrome-icon-size, 18px);
  width: var(--app-chrome-icon-size, 18px);
}

.relay-admin-list-table .ant-input,
.relay-admin-list-table .ant-input::placeholder {
  color: var(--sub-text-color);
  font-size: 12px;
}

.relay-admin-list-table .ant-input {
  background: transparent;
  color: var(--text-color);
  height: var(--app-chrome-icon-size, 18px);
  line-height: var(--app-chrome-icon-size, 18px);
  padding: 0;
}

.relay-admin-list-table .ant-input-clear-icon {
  color: var(--placeholder-color) !important;
}

.relay-admin-list-table
  .relay-admin-list-table__search.ant-input-affix-wrapper:hover,
.relay-admin-list-table
  .relay-admin-list-table__search.ant-input-affix-wrapper-focused {
  border-color: transparent !important;
  box-shadow: none !important;
}

.relay-admin-table .ant-select {
  display: inline-flex;
  height: 28px;
  min-width: 92px;
}

.relay-admin-table .ant-select-selector {
  background: color-mix(in srgb, var(--text-color) 3%, transparent) !important;
  border-color: color-mix(in srgb, var(--border-color) 74%, transparent)
    !important;
  border-radius: 6px !important;
  box-shadow: none !important;
  color: var(--text-color) !important;
  height: 28px !important;
  min-height: 28px !important;
  padding: 0 var(--relay-admin-padding) !important;
}

.relay-admin-table .ant-select-selection-item {
  color: var(--sub-text-color);
  font-size: 12px;
  font-weight: 600;
  line-height: 28px !important;
}

.relay-admin-table .ant-select-arrow {
  color: var(--placeholder-color) !important;
  height: 14px;
  margin-top: -7px;
}

.relay-admin-table .ant-select-focused .ant-select-selector,
.relay-admin-table .ant-select-selector:hover {
  border-color: color-mix(
    in srgb,
    var(--primary-color) 52%,
    var(--border-color)
  ) !important;
}

.relay-admin-list-table .relay-admin-list-table__column-trigger.ant-btn,
.relay-admin-list-table .relay-admin-list-table__toolbar-action-button.ant-btn {
  --route-container-header-icon-size: var(--app-chrome-icon-size, 18px);
  --route-container-header-icon-button-size: var(
    --route-container-header-icon-size
  );

  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  height: var(--app-chrome-icon-size, 18px);
  min-height: 0;
  min-width: var(--app-chrome-icon-size, 18px);
  padding: 0;
  width: var(--app-chrome-icon-size, 18px);
}

.relay-admin-list-table
  .relay-admin-list-table__column-trigger
  .relay-admin-icon,
.relay-admin-list-table
  .relay-admin-list-table__toolbar-action-button
  .relay-admin-icon {
  height: var(--app-chrome-icon-size, 18px);
  width: var(--app-chrome-icon-size, 18px);
}

.relay-admin-list-table .relay-admin-list-table__column-trigger.ant-btn:hover,
.relay-admin-list-table
  .relay-admin-list-table__toolbar-action-button.ant-btn:hover,
.relay-admin-list-table
  .relay-admin-list-table__column-trigger.ant-btn:focus-visible,
.relay-admin-list-table
  .relay-admin-list-table__toolbar-action-button.ant-btn:focus-visible,
.relay-admin-list-table
  .relay-admin-list-table__column-trigger.ant-btn.ant-btn-text:not(:disabled):not(.ant-btn-disabled):hover,
.relay-admin-list-table
  .relay-admin-list-table__toolbar-action-button.ant-btn.ant-btn-text:not(:disabled):not(.ant-btn-disabled):hover,
.relay-admin-list-table
  .relay-admin-list-table__column-trigger.ant-btn.is-active {
  background: transparent !important;
  color: var(--primary-color) !important;
}

.relay-admin-list-table__selected-count {
  color: var(--sub-text-color);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.relay-admin-list-table__table-scroll {
  border-top: 1px solid
    color-mix(in srgb, var(--border-color) 72%, transparent);
  flex: 1 1 0;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  width: 100%;
}

.relay-admin-list-table--content .relay-admin-list-table__table-scroll {
  border-top: 0;
  flex: 0 0 auto;
  overflow: visible;
}

.relay-admin-list-table__table-scroll .ant-table-wrapper,
.relay-admin-list-table__table-scroll .ant-spin-nested-loading,
.relay-admin-list-table__table-scroll .ant-spin-container,
.relay-admin-list-table__table-scroll .ant-table {
  max-width: 100%;
  min-width: 0;
}

.relay-admin-list-table__table-scroll .ant-table-container,
.relay-admin-list-table__table-scroll .ant-table-content {
  max-width: 100%;
}

.relay-admin-list-table__table-scroll .ant-table-thead > tr > th {
  position: sticky;
  top: 0;
  z-index: 2;
}

.relay-admin-list-table__pagination {
  align-items: center;
  border-top: 1px solid
    color-mix(in srgb, var(--border-color) 72%, transparent);
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  justify-content: space-between;
  min-height: 32px;
  padding-top: var(--relay-admin-padding);
}

.relay-admin-list-table__pagination-summary {
  color: var(--sub-text-color);
  font-size: 12px;
  white-space: nowrap;
}

.relay-admin-list-table__pagination .ant-pagination {
  color: var(--sub-text-color);
}

.relay-admin-list-table__pagination .ant-pagination-item,
.relay-admin-list-table__pagination .ant-pagination-prev,
.relay-admin-list-table__pagination .ant-pagination-next {
  min-width: 24px;
}

.relay-admin-list-table__pagination .ant-pagination-item {
  background: transparent;
  border-color: color-mix(in srgb, var(--border-color) 72%, transparent);
}

.relay-admin-list-table__pagination .ant-pagination-item a,
.relay-admin-list-table__pagination .ant-pagination-prev button,
.relay-admin-list-table__pagination .ant-pagination-next button {
  color: var(--sub-text-color);
}

.relay-admin-list-table__pagination .ant-pagination-item-active {
  border-color: color-mix(
    in srgb,
    var(--primary-color) 46%,
    var(--border-color)
  );
}

.relay-admin-list-table__pagination .ant-pagination-item-active a {
  color: var(--primary-color);
}

.relay-admin-list-table__column-menu {
  display: grid;
  gap: 8px;
  min-width: 140px;
}

.relay-admin-list-table__column-popover .ant-popover-inner {
  background: color-mix(in srgb, var(--bg-color) 86%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow:
    0 18px 44px color-mix(in srgb, #0f172a 18%, transparent),
    0 2px 10px color-mix(in srgb, #0f172a 8%, transparent);
  color: var(--text-color);
}

.relay-admin-list-table__column-popover .ant-popover-arrow::before {
  background: color-mix(in srgb, var(--bg-color) 86%, transparent);
}

.relay-admin-list-table__column-popover .ant-checkbox-wrapper {
  color: var(--text-color);
  font-size: 12px;
}

@media (max-width: 760px) {
  .relay-admin-list-table__toolbar {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .relay-admin-list-table__search {
    flex-basis: 100%;
  }

  .relay-admin-list-table__toolbar-spacer {
    display: none;
  }

  .relay-admin-list-table__pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}

.relay-admin-list-table__native-list {
  display: grid;
  min-width: 0;
}

.relay-admin-list-table__native-search {
  --relay-admin-list-native-search-control-size: var(--app-chrome-icon-size, 18px);

  align-items: center;
  border-bottom: 0;
  color: var(--placeholder-color);
  display: flex;
  flex: 1 1 auto;
  gap: var(--oneworks-overlay-icon-gap, 6px);
  line-height: var(--relay-admin-list-native-search-control-size);
  min-height: var(--relay-admin-list-native-search-control-size);
  min-width: 0;
  padding: 0;
}

.relay-admin-list-table__native-search:focus-within {
  color: var(--primary-color);
}

.relay-admin-list-table__native-search .plugin-host-icon,
.relay-admin-list-table__native-search .oneworks-relay__icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 16px;
  height: var(--relay-admin-list-native-search-control-size);
  justify-content: center;
  line-height: var(--relay-admin-list-native-search-control-size);
  width: var(--relay-admin-list-native-search-control-size);
}

.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  flex: 1 1 auto;
  height: var(--relay-admin-list-native-search-control-size) !important;
  line-height: var(--relay-admin-list-native-search-control-size) !important;
  min-height: var(--relay-admin-list-native-search-control-size) !important;
  min-width: 0;
  padding: 0 !important;
}

.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input:hover,
.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input-focused,
.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input:focus-within {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}

.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input
  .ant-input-clear-icon {
  align-items: center;
  display: inline-flex;
  height: var(--relay-admin-list-native-search-control-size);
  justify-content: center;
  line-height: var(--relay-admin-list-native-search-control-size);
}

.relay-admin-list-table__native-search input,
.relay-admin-list-table__native-search
  .ant-input-affix-wrapper.plugin-host-control-input
  input.ant-input {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: var(--text-color);
  flex: 1 1 auto;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  height: var(--relay-admin-list-native-search-control-size);
  line-height: var(--relay-admin-list-native-search-control-size);
  min-width: 0;
  min-height: var(--relay-admin-list-native-search-control-size);
  outline: 0 !important;
  padding: 0 !important;
}

.relay-admin-list-table__native-search input:hover,
.relay-admin-list-table__native-search input:focus {
  border: 0 !important;
  box-shadow: none !important;
  outline: 0 !important;
}

.relay-admin-list-table__native-search .plugin-host-control-button,
.relay-admin-list-table__native-search .plugin-host-control-button.ant-btn {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  flex: 0 0 auto;
  height: var(--relay-admin-list-native-search-control-size) !important;
  line-height: var(--relay-admin-list-native-search-control-size) !important;
  min-height: var(--relay-admin-list-native-search-control-size) !important;
  min-width: var(--relay-admin-list-native-search-control-size) !important;
  padding: 0 !important;
  width: var(--relay-admin-list-native-search-control-size) !important;
}

.relay-admin-list-table__native-search .plugin-host-control-button:hover,
.relay-admin-list-table__native-search .plugin-host-control-button:focus,
.relay-admin-list-table__native-search .plugin-host-control-button:focus-visible,
.relay-admin-list-table__native-search .plugin-host-control-button:active {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}

.relay-admin-list-table__native-search input::placeholder {
  color: var(--sub-text-color);
  opacity: .8;
}

.relay-admin-list-table__native-row {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  display: grid;
  gap: 8px;
  grid-template-columns: var(
    --relay-admin-list-native-row-columns,
    18px minmax(0, 1fr) auto
  );
  min-height: 38px;
  min-width: 0;
  padding: 6px 0;
}

.relay-admin-list-table--content .relay-admin-list-table__native-row {
  border-bottom: 0;
}

.relay-admin-list-table__native-row[data-kind="header"] {
  color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a));
  font: 750 11px/1.25 ui-sans-serif, system-ui, sans-serif;
  min-height: 30px;
  padding: 4px 0;
}

.relay-admin-list-table__native-row[data-clickable="true"] {
  cursor: pointer;
}

.relay-admin-list-table__native-row[data-clickable="true"]:hover
  .relay-admin-list-table__native-title,
.relay-admin-list-table__native-row[data-clickable="true"]:focus-within
  .relay-admin-list-table__native-title {
  color: var(--primary-color, var(--ant-color-primary, #1677ff));
}

.relay-admin-list-table__native-row[data-state="archived"],
.relay-admin-list-table__native-row[data-state="disabled"],
.relay-admin-list-table__native-row[data-state="revoked"] {
  opacity: .68;
}

.relay-admin-list-table__native-row[data-danger="true"] {
  color: var(--danger-color, #dc2626);
}

.relay-admin-list-table__native-icon {
  align-items: center;
  color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a));
  display: inline-flex;
  height: var(--app-chrome-icon-size, 18px);
  justify-content: center;
  width: var(--app-chrome-icon-size, 18px);
}

.relay-admin-list-table__native-icon .oneworks-relay__icon {
  font-size: var(--app-chrome-icon-size, 18px);
}

.relay-admin-list-table__native-cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relay-admin-list-table__native-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.relay-admin-list-table__native-title,
.relay-admin-list-table__native-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relay-admin-list-table__native-title {
  color: var(--sub-text-color, var(--ant-color-text, #1f2328));
  font: 700 12px/1.3 ui-sans-serif, system-ui, sans-serif;
}

.relay-admin-list-table__native-meta {
  color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a));
  font: 500 11px/1.3 ui-sans-serif, system-ui, sans-serif;
}

.relay-admin-list-table__native-actions {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  grid-column: -2 / -1;
  justify-content: flex-end;
  justify-self: end;
  min-width: max-content;
}

.relay-admin-list-table__native-actions .ant-btn,
.relay-admin-list-table__native-actions .plugin-host-control-button {
  align-items: center;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: var(--sub-text-color, var(--ant-color-text-secondary, #57606a)) !important;
  display: inline-flex;
  height: var(--app-chrome-icon-size, 18px) !important;
  justify-content: center;
  line-height: var(--app-chrome-icon-size, 18px) !important;
  min-height: var(--app-chrome-icon-size, 18px) !important;
  min-width: var(--app-chrome-icon-size, 18px) !important;
  padding: 0 !important;
  width: var(--app-chrome-icon-size, 18px) !important;
}

.relay-admin-list-table__native-actions .ant-btn:hover,
.relay-admin-list-table__native-actions .ant-btn:focus,
.relay-admin-list-table__native-actions .ant-btn:focus-visible,
.relay-admin-list-table__native-actions .ant-btn:active,
.relay-admin-list-table__native-actions .plugin-host-control-button:hover,
.relay-admin-list-table__native-actions .plugin-host-control-button:focus,
.relay-admin-list-table__native-actions .plugin-host-control-button:focus-visible,
.relay-admin-list-table__native-actions .plugin-host-control-button:active {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--primary-color, var(--ant-color-primary, #1677ff)) !important;
}

.relay-admin-list-table__native-empty {
  color: var(--placeholder-color, var(--ant-color-text-secondary, #57606a));
  font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 8px 0;
}

.relay-admin-list-table__native-editor {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px 0;
}

.relay-admin-list-table__native-editor-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: var(
    --relay-admin-list-native-editor-columns,
    minmax(160px, 1fr) minmax(110px, 160px) auto
  );
  min-width: 0;
}

.relay-admin-list-table__native-editor-actions {
  align-items: center;
  display: inline-flex;
  gap: 6px;
  justify-content: flex-end;
  min-width: max-content;
}

@media (max-width: 760px) {
  .relay-admin-list-table__native-editor-row,
  .relay-admin-list-table__native-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .relay-admin-list-table__native-icon,
  .relay-admin-list-table__native-actions {
    display: none;
  }
}

`

export const adminListSurfaceClassNames = {
  root: 'relay-admin-list-table',
  rootContent: 'relay-admin-list-table--content',
  toolbar: 'relay-admin-list-table__toolbar',
  toolbarActions: 'relay-admin-list-table__toolbar-actions',
  search: 'relay-admin-list-table__search',
  searchIcon: 'relay-admin-list-table__search-icon',
  batch: 'relay-admin-list-table__batch',
  selectedCount: 'relay-admin-list-table__selected-count',
  tableScroll: 'relay-admin-list-table__table-scroll',
  columnTrigger: 'relay-admin-list-table__column-trigger',
  toolbarActionButton: 'relay-admin-list-table__toolbar-action-button',
  columnPopover: 'relay-admin-list-table__column-popover',
  columnMenu: 'relay-admin-list-table__column-menu',
  pagination: 'relay-admin-list-table__pagination',
  paginationSummary: 'relay-admin-list-table__pagination-summary',
  nativeList: 'relay-admin-list-table__native-list',
  nativeSearch: 'relay-admin-list-table__native-search',
  nativeRow: 'relay-admin-list-table__native-row',
  nativeCell: 'relay-admin-list-table__native-cell',
  nativeIcon: 'relay-admin-list-table__native-icon',
  nativeMain: 'relay-admin-list-table__native-main',
  nativeTitle: 'relay-admin-list-table__native-title',
  nativeMeta: 'relay-admin-list-table__native-meta',
  nativeActions: 'relay-admin-list-table__native-actions',
  nativeEmpty: 'relay-admin-list-table__native-empty',
  nativeEditor: 'relay-admin-list-table__native-editor',
  nativeEditorRow: 'relay-admin-list-table__native-editor-row',
  nativeEditorActions: 'relay-admin-list-table__native-editor-actions'
} as const

export interface AdminListSurfaceMarkupOptions {
  ariaLabel: string
  bodyHtml: string
  toolbarHtml: string
  batchHtml?: string
  layout?: 'content' | 'fill'
}

export const renderAdminListSurfaceMarkup = ({
  ariaLabel,
  batchHtml = '',
  bodyHtml,
  layout = 'fill',
  toolbarHtml
}: AdminListSurfaceMarkupOptions) => `
  <div class="${adminListSurfaceClassNames.root}${
  layout === 'content' ? ` ${adminListSurfaceClassNames.rootContent}` : ''
}" aria-label="${ariaLabel}">
    ${toolbarHtml}
    ${batchHtml}
    <div class="${adminListSurfaceClassNames.tableScroll}">
      ${bodyHtml}
    </div>
  </div>
`

export interface AdminListSurfaceNativeListMarkupOptions {
  emptyHtml: string
  rowsHtml: string
}

export const renderAdminListSurfaceNativeListMarkup = ({
  emptyHtml,
  rowsHtml
}: AdminListSurfaceNativeListMarkupOptions) => `
  <div class="${adminListSurfaceClassNames.nativeList}">
    ${rowsHtml === '' ? emptyHtml : rowsHtml}
  </div>
`

export interface AdminListSurfaceToolbarMarkupOptions {
  actionsHtml?: string
  searchHtml: string
}

export const renderAdminListSurfaceToolbarMarkup = ({
  actionsHtml = '',
  searchHtml
}: AdminListSurfaceToolbarMarkupOptions) => `
  <div class="${adminListSurfaceClassNames.toolbar}">
    ${searchHtml}
    ${actionsHtml === '' ? '' : `<div class="${adminListSurfaceClassNames.toolbarActions}">${actionsHtml}</div>`}
  </div>
`

export const ensureAdminListSurfaceStyles = (targetDocument = globalThis.document) => {
  const styleId = 'oneworks-admin-list-surface-styles'
  if (targetDocument == null) return
  const existingStyle = targetDocument.getElementById(styleId)
  if (existingStyle != null) {
    if (existingStyle.textContent !== adminListSurfaceCss) {
      existingStyle.textContent = adminListSurfaceCss
    }
    return
  }
  const style = targetDocument.createElement('style')
  style.id = styleId
  style.textContent = adminListSurfaceCss
  targetDocument.head.append(style)
}
