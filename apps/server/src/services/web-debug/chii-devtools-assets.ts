/* eslint-disable max-lines -- DevTools asset patch includes injected CSS and browser-side script payloads. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(__filename)

const ONE_WORKS_DEVTOOLS_BOOTSTRAP_SCRIPT_PATH = 'oneworks-devtools-bootstrap.js'
const ONE_WORKS_DEVTOOLS_PATCH_SCRIPT_PATH = 'oneworks-devtools-patch.js'
const ONE_WORKS_DEVTOOLS_STYLE_PATH = 'oneworks-devtools.css'
const ONE_WORKS_DEVTOOLS_LEGACY_SCRIPT_PATH = 'front_end/ui/legacy/legacy.js'
export const ONE_WORKS_DEVTOOLS_ASSET_VERSION = '20260614zm'

const oneWorksDevtoolsStyle = `
html {
  --oneworks-devtools-accent: #4f9cff;
  --oneworks-devtools-toolbar-bg: #141414;
  --oneworks-devtools-toolbar-border: 1px;
  --oneworks-devtools-toolbar-total-height: 27px;
  --oneworks-devtools-toolbar-icon-size: 18px;
  --oneworks-devtools-toolbar-height: calc(
    var(--oneworks-devtools-toolbar-total-height) -
      var(--oneworks-devtools-toolbar-border)
  );
  --oneworks-devtools-toolbar-padding-block: calc(
    (
      var(--oneworks-devtools-toolbar-total-height) -
        var(--oneworks-devtools-toolbar-icon-size)
    ) / 2
  );
}

.tabbed-pane-header[aria-label="Main toolbar"] {
  background: var(--oneworks-devtools-toolbar-bg) !important;
  box-sizing: border-box !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .toolbar-shadow,
.toolbar-shadow.wrappable.toolbar-grow-vertical {
  box-sizing: border-box !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
}

.toolbar-shadow {
  gap: 4px !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] {
  display: flex !important;
  align-items: center !important;
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  padding: 0 10px !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tabs {
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
  background: transparent !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab {
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
  padding: 0 10px !important;
  background: transparent !important;
  line-height: var(--oneworks-devtools-toolbar-icon-size) !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab.selected,
.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab:hover,
.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab:focus-visible {
  background: transparent !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab-title {
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  line-height: var(--oneworks-devtools-toolbar-icon-size) !important;
}

.tabbed-pane-left-toolbar.toolbar-shadow {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
  max-height: var(--oneworks-devtools-toolbar-total-height) !important;
  padding-inline: 0 !important;
  padding-block: var(--oneworks-devtools-toolbar-padding-block) !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .toolbar-shadow {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
  max-height: var(--oneworks-devtools-toolbar-total-height) !important;
  padding-inline: 0 !important;
  padding-block: var(--oneworks-devtools-toolbar-padding-block) !important;
}

.toolbar-shadow.wrappable.toolbar-grow-vertical {
  height: var(--oneworks-devtools-toolbar-total-height) !important;
  min-height: var(--oneworks-devtools-toolbar-total-height) !important;
  max-height: var(--oneworks-devtools-toolbar-total-height) !important;
  padding-inline: 10px !important;
  padding-block: var(--oneworks-devtools-toolbar-padding-block) !important;
}

.tabbed-pane-header[aria-label="Main toolbar"] .toolbar-shadow .toolbar,
.toolbar-shadow.wrappable.toolbar-grow-vertical .toolbar {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  padding: 0 !important;
  background: transparent !important;
}

.toolbar-shadow.wrappable.toolbar-grow-vertical > * {
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  max-height: var(--oneworks-devtools-toolbar-icon-size) !important;
}

.toolbar-shadow input,
.toolbar-shadow select,
.toolbar-shadow .toolbar-input,
.toolbar-shadow .toolbar-combo-box {
  box-sizing: border-box !important;
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  padding-block: 0 !important;
  line-height: var(--oneworks-devtools-toolbar-icon-size) !important;
}

.toolbar-shadow .toolbar-divider,
.toolbar-shadow .toolbar-item-separator {
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  margin-block: 0 !important;
  align-self: center !important;
}

.toolbar-button.toolbar-has-glyph,
button.toolbar-button.toolbar-has-glyph,
.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab devtools-icon {
  box-sizing: border-box !important;
}

.toolbar-button.toolbar-has-glyph,
button.toolbar-button.toolbar-has-glyph {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-width: var(--oneworks-devtools-toolbar-icon-size) !important;
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 2px !important;
  background: transparent !important;
  line-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  pointer-events: auto !important;
  vertical-align: middle !important;
}

.toolbar-button.toolbar-has-glyph:hover,
.toolbar-button.toolbar-has-glyph:focus-visible,
.toolbar-button.toolbar-has-glyph.toolbar-state-on,
.toolbar-button.toolbar-has-glyph.toolbar-state-off:hover,
.oneworks-device-toolbar-button.oneworks-device-toolbar-active {
  background: transparent !important;
  color: var(--oneworks-devtools-accent) !important;
}

.toolbar-button.toolbar-has-glyph devtools-icon,
.toolbar-button.toolbar-has-glyph .toolbar-glyph,
.toolbar-button.toolbar-has-glyph .toolbar-button-icon,
devtools-icon.toolbar-button-icon,
.tabbed-pane-header[aria-label="Main toolbar"] .tabbed-pane-header-tab devtools-icon {
  --icon-size: var(--oneworks-devtools-toolbar-icon-size) !important;
  width: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-width: var(--oneworks-devtools-toolbar-icon-size) !important;
  height: var(--oneworks-devtools-toolbar-icon-size) !important;
  min-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  margin: 0 !important;
  font-size: var(--oneworks-devtools-toolbar-icon-size) !important;
  line-height: var(--oneworks-devtools-toolbar-icon-size) !important;
  pointer-events: none !important;
}

.oneworks-dock-side-active {
  color: var(--oneworks-devtools-accent) !important;
}

.oneworks-device-toolbar-button.oneworks-device-toolbar-active {
  color: var(--oneworks-devtools-accent) !important;
  background: transparent !important;
}

.oneworks-device-toolbar-button.oneworks-device-toolbar-active .toolbar-glyph {
  color: var(--oneworks-devtools-accent) !important;
}

.oneworks-dock-side-menu {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--oneworks-devtools-toolbar-total-height);
  padding: 4px 8px;
  border-bottom: 1px solid rgba(128, 128, 128, .28);
  box-sizing: border-box;
  color: var(--sys-color-on-surface, currentColor);
  font-size: 12px;
  white-space: nowrap;
}

.oneworks-dock-side-menu::before {
  width: 21px;
  height: 16px;
  content: '';
  flex: 0 0 21px;
}

.oneworks-dock-side-menu__label {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 13px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.oneworks-dock-side-menu__actions {
  display: inline-flex;
  align-items: center;
  height: 18px;
  gap: 10px;
  flex: 0 0 auto;
}

.oneworks-dock-side-menu__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0 !important;
  border: 0;
  border-radius: 2px;
  background: transparent !important;
  color: inherit;
  cursor: pointer;
}

.oneworks-dock-side-menu__button:hover,
.oneworks-dock-side-menu__button:focus-visible,
.oneworks-dock-side-menu__button.oneworks-dock-side-active {
  background: transparent !important;
  color: var(--oneworks-devtools-accent) !important;
  outline: none;
}

.oneworks-dock-side-menu__glyph {
  display: block;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 0;
  background-color: currentColor;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: 18px 18px;
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: 18px 18px;
}

.oneworks-dock-side-menu__button[data-oneworks-dock-side="left"] .oneworks-dock-side-menu__glyph {
  -webkit-mask-image: url("/__oneworks_chii__/front_end/Images/dock-left.svg");
  mask-image: url("/__oneworks_chii__/front_end/Images/dock-left.svg");
}

.oneworks-dock-side-menu__button[data-oneworks-dock-side="bottom"] .oneworks-dock-side-menu__glyph {
  -webkit-mask-image: url("/__oneworks_chii__/front_end/Images/dock-bottom.svg");
  mask-image: url("/__oneworks_chii__/front_end/Images/dock-bottom.svg");
}

.oneworks-dock-side-menu__button[data-oneworks-dock-side="right"] .oneworks-dock-side-menu__glyph {
  -webkit-mask-image: url("/__oneworks_chii__/front_end/Images/dock-right.svg");
  mask-image: url("/__oneworks_chii__/front_end/Images/dock-right.svg");
}
`

const oneWorksDevtoolsBootstrapScript = `
import * as Legacy from './front_end/ui/legacy/legacy.js';

const ONE_WORKS_DEVTOOLS_SOURCE = 'oneworks-devtools';
const searchParams = new URLSearchParams(location.search);
const hostOrigin = searchParams.get('oneworks_host_origin') || '*';
const leftToolbarLocation = Legacy.Toolbar.ToolbarItemLocation.MAIN_TOOLBAR_LEFT;
const rightToolbarLocation = Legacy.Toolbar.ToolbarItemLocation.MAIN_TOOLBAR_RIGHT;
const debugKeys = ['oneworks_debug', 'oneworks_devtools_debug'];
const protocolDebugKeys = ['oneworks_protocol_debug'];
const storageDebugKeys = ['oneworks-devtools-debug', 'oneworks_debug'];
let hasOneWorksDeviceToolbarRegistration = false;

const isDebugValueEnabled = (value) => {
  if (value == null) return false;
  const normalizedValue = String(value).trim().toLowerCase();
  return normalizedValue === '' || (
    normalizedValue !== '0' &&
    normalizedValue !== 'false' &&
    normalizedValue !== 'off' &&
    normalizedValue !== 'no'
  );
};

const readStorageDebugValue = () => {
  for (const key of storageDebugKeys) {
    try {
      const localValue = window.localStorage?.getItem(key);
      if (localValue != null) return localValue;
      const sessionValue = window.sessionStorage?.getItem(key);
      if (sessionValue != null) return sessionValue;
    } catch {
      return null;
    }
  }
  return null;
};

const isDevtoolsDebugEnabled = () => {
  for (const key of debugKeys) {
    const queryValue = searchParams.get(key);
    if (queryValue != null) return isDebugValueEnabled(queryValue);
  }
  return isDebugValueEnabled(readStorageDebugValue());
};

const isProtocolDebugEnabled = () => {
  for (const key of protocolDebugKeys) {
    const queryValue = searchParams.get(key);
    if (queryValue != null) return isDebugValueEnabled(queryValue);
  }
  return false;
};

const debugDevtools = (...args) => {
  if (!isDevtoolsDebugEnabled()) return;
  console.debug('[oneworks-devtools]', ...args);
};

const debugDevtoolsJson = (label, payload) => {
  if (!isDevtoolsDebugEnabled()) return;
  let serializedPayload = '';
  try {
    serializedPayload = JSON.stringify(payload);
  } catch (error) {
    serializedPayload = JSON.stringify({
      error: String(error)
    });
  }
  console.debug('[oneworks-devtools]', label, serializedPayload);
  window.parent?.postMessage({
    label,
    payload: serializedPayload,
    source: ONE_WORKS_DEVTOOLS_SOURCE,
    type: 'debug-log'
  }, hostOrigin);
};

const isProtocolMethodInteresting = (method) => (
  typeof method === 'string' &&
  (
    method === 'DOM.enable' ||
    method === 'DOM.disable' ||
    method === 'DOM.getDocument' ||
    method === 'DOM.requestChildNodes' ||
    method === 'DOM.documentUpdated' ||
    method === 'DOM.setChildNodes' ||
    method === 'DOM.childNodeInserted' ||
    method === 'DOM.childNodeRemoved' ||
    method === 'Page.enable' ||
    method === 'Page.loadEventFired' ||
    method === 'Inspector.detached'
  )
);

const readProtocolRootSummary = (root) => {
  if (root == null || typeof root !== 'object') return null;
  return {
    backendNodeId: root.backendNodeId ?? null,
    childNodeCount: root.childNodeCount ?? null,
    childrenLength: Array.isArray(root.children) ? root.children.length : null,
    localName: root.localName ?? null,
    nodeId: root.nodeId ?? null,
    nodeName: root.nodeName ?? null,
    nodeType: root.nodeType ?? null
  };
};

const readProtocolNodeSummary = (node) => {
  if (node == null || typeof node !== 'object') return null;
  return {
    backendNodeId: node.backendNodeId ?? null,
    childNodeCount: node.childNodeCount ?? null,
    childrenLength: Array.isArray(node.children) ? node.children.length : null,
    nodeId: node.nodeId ?? null,
    nodeName: node.nodeName ?? null,
    nodeType: node.nodeType ?? null
  };
};

const readProtocolDataText = (data) => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return '[ArrayBuffer ' + data.byteLength + ']';
  if (ArrayBuffer.isView(data)) return '[' + data.constructor.name + ' ' + data.byteLength + ']';
  return null;
};

const summarizeProtocolMessage = (message, direction, methodsById) => {
  if (message == null || typeof message !== 'object') return null;
  const id = message.id == null ? null : String(message.id);
  const method = typeof message.method === 'string' ? message.method : null;
  if (direction === 'send' && id != null && method != null) {
    methodsById.set(id, method);
  }

  const requestMethod = method ?? (id == null ? null : methodsById.get(id) ?? null);
  const isInteresting = isProtocolMethodInteresting(method) ||
    isProtocolMethodInteresting(requestMethod) ||
    message.error != null;
  if (!isInteresting) return null;

  return {
    direction,
    error: message.error ?? null,
    id,
    method,
    params: message.params == null ? null : {
      depth: message.params.depth ?? null,
      nodeId: message.params.nodeId ?? null,
      parentId: message.params.parentId ?? null,
      nodesLength: Array.isArray(message.params.nodes) ? message.params.nodes.length : null
    },
    requestMethod,
    result: message.result == null ? null : {
      root: readProtocolRootSummary(message.result.root)
    }
  };
};

const summarizeProtocolData = (data, direction, methodsById) => {
  const text = readProtocolDataText(data);
  if (text == null || !text.startsWith('{') && !text.startsWith('[')) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages
    .map(message => summarizeProtocolMessage(message, direction, methodsById))
    .filter(Boolean);
};

const installProtocolDebugging = () => {
  if (!isProtocolDebugEnabled()) return;
  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket == null || NativeWebSocket.__oneworksDevtoolsPatched === true) return;

  const PatchedWebSocket = function(url, protocols) {
    const socket = protocols == null ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    const socketUrl = String(url);
    const isChiiClientSocket = /\\/__oneworks_chii__\\/client\\//.test(socketUrl);
    const methodsById = new Map();

    if (isChiiClientSocket) {
      debugDevtoolsJson('protocol-websocket-created', {
        url: socketUrl
      });
    }

    const nativeSend = socket.send.bind(socket);
    Object.defineProperty(socket, 'send', {
      configurable: true,
      value(data) {
        if (isChiiClientSocket) {
          const summaries = summarizeProtocolData(data, 'send', methodsById);
          if (summaries.length > 0) {
            debugDevtoolsJson('protocol-send', { summaries, url: socketUrl });
          }
        }
        return nativeSend(data);
      }
    });

    socket.addEventListener('message', (event) => {
      if (!isChiiClientSocket) return;
      const summaries = summarizeProtocolData(event.data, 'receive', methodsById);
      if (summaries.length > 0) {
        debugDevtoolsJson('protocol-receive', { summaries, url: socketUrl });
      }
    });

    socket.addEventListener('close', (event) => {
      if (!isChiiClientSocket) return;
      debugDevtoolsJson('protocol-websocket-close', {
        code: event.code,
        reason: event.reason,
        url: socketUrl,
        wasClean: event.wasClean
      });
    });

    socket.addEventListener('error', () => {
      if (!isChiiClientSocket) return;
      debugDevtoolsJson('protocol-websocket-error', {
        url: socketUrl
      });
    });

    return socket;
  };
  Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  PatchedWebSocket.__oneworksDevtoolsPatched = true;
  window.WebSocket = PatchedWebSocket;
  debugDevtools('protocol debugging installed');
};

installProtocolDebugging();

const describeToolbarDescriptor = (descriptor) => ({
  actionId: descriptor?.actionId,
  commandPrompt: descriptor?.commandPrompt,
  experiment: descriptor?.experiment,
  location: descriptor?.location,
  order: descriptor?.order,
  showLabel: descriptor?.showLabel,
  title: descriptor?.title
});

const getLoadItemSource = (descriptor) => {
  try {
    return String(descriptor?.loadItem ?? '');
  } catch {
    return '';
  }
};

const postToggleDeviceToolbar = () => {
  debugDevtools('post toggle device toolbar', { hostOrigin });
  window.parent?.postMessage({
    source: ONE_WORKS_DEVTOOLS_SOURCE,
    type: 'toggle-device-toolbar'
  }, hostOrigin);
};

const stopToolbarPointerEvent = (event) => {
  event.stopPropagation();
};

const activateDeviceToolbarButton = (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  postToggleDeviceToolbar();
};

const createOneWorksDeviceToolbarItem = () => {
  debugDevtools('create device toolbar button');
  const button = new Legacy.Toolbar.ToolbarButton('Toggle device toolbar', 'devices', '', 'oneworks-toggle-device-toolbar');
  button.element.classList.add('oneworks-device-toolbar-button');
  button.element.dataset.oneworksDeviceToolbarButton = 'true';
  button.element.setAttribute('aria-label', 'Toggle device toolbar');
  button.element.setAttribute('title', 'Toggle device toolbar');
  button.element.addEventListener('pointerdown', stopToolbarPointerEvent, true);
  button.element.addEventListener('mousedown', stopToolbarPointerEvent, true);
  button.element.addEventListener('click', activateDeviceToolbarButton, true);
  button.element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    activateDeviceToolbarButton(event);
  }, true);
  return button;
};

const createOneWorksDeviceToolbarRegistration = (descriptor) => {
  hasOneWorksDeviceToolbarRegistration = true;
  return {
    ...descriptor,
    actionId: undefined,
    condition: undefined,
    loadItem: async () => ({
      item: createOneWorksDeviceToolbarItem
    }),
    location: descriptor?.location ?? leftToolbarLocation,
    order: descriptor?.order ?? 1
  };
};

const isEmulationDeviceToolbarRegistration = (descriptor) => (
  descriptor?.actionId === 'emulation.toggle-device-mode'
);

const isScreencastToolbarRegistration = (descriptor) => (
  descriptor?.location === leftToolbarLocation &&
  descriptor?.order === 1 &&
  /ScreencastApp|ToolbarButtonProvider|screencast/i.test(getLoadItemSource(descriptor))
);

const isNodeIndicatorRegistration = (descriptor) => (
  descriptor?.location === leftToolbarLocation &&
  descriptor?.order === 2 &&
  /NodeIndicator/.test(getLoadItemSource(descriptor))
);

const isOutermostTargetSelectorRegistration = (descriptor) => (
  descriptor?.location === rightToolbarLocation &&
  descriptor?.order === 98 &&
  /OutermostTargetSelector/.test(getLoadItemSource(descriptor))
);

const isCloseButtonRegistration = (descriptor) => (
  descriptor?.location === rightToolbarLocation &&
  descriptor?.order === 101 &&
  /CloseButtonProvider/.test(getLoadItemSource(descriptor))
);

globalThis.__ONEWORKS_DEVTOOLS_REWRITE_TOOLBAR_ITEM__ = (descriptor) => {
  const isDeviceToolbarRegistration = isEmulationDeviceToolbarRegistration(descriptor) ||
    isScreencastToolbarRegistration(descriptor);
  if (isDeviceToolbarRegistration) {
    if (hasOneWorksDeviceToolbarRegistration) {
      debugDevtools('skip duplicate device toolbar item', {
        descriptor: describeToolbarDescriptor(descriptor)
      });
      return null;
    }
    debugDevtools('replace toolbar item', {
      descriptor: describeToolbarDescriptor(descriptor),
      reason: isScreencastToolbarRegistration(descriptor) ? 'screencast-device-toolbar' : 'device-toolbar'
    });
    return createOneWorksDeviceToolbarRegistration(descriptor);
  }

  const skipReason = isNodeIndicatorRegistration(descriptor)
    ? 'node-indicator'
    : isOutermostTargetSelectorRegistration(descriptor)
      ? 'outermost-target-selector'
      : isCloseButtonRegistration(descriptor)
        ? 'close-button'
        : null;

  if (skipReason != null) {
    debugDevtools('skip toolbar item', {
      descriptor: describeToolbarDescriptor(descriptor),
      reason: skipReason
    });
    return null;
  }

  return descriptor;
};

debugDevtools('bootstrap installed', {
  dockSide: searchParams.get('oneworks_dock_side'),
  hostOrigin,
  location: location.href
});
`

const oneWorksDevtoolsPatchScript = `
const ONE_WORKS_DEVTOOLS_SOURCE = 'oneworks-devtools';
const ONE_WORKS_HOST_SOURCE = 'oneworks-host';
const ONE_WORKS_DEVTOOLS_ASSET_VERSION = ${JSON.stringify(ONE_WORKS_DEVTOOLS_ASSET_VERSION)};
const ONE_WORKS_DEVTOOLS_STYLE = ${JSON.stringify(oneWorksDevtoolsStyle)};
const searchParams = new URLSearchParams(location.search);
const hostOrigin = searchParams.get('oneworks_host_origin') || '*';
const dockControlsMode = searchParams.get('oneworks_dock_controls');
const shouldShowDockMenuFallback = dockControlsMode === 'fallback' || dockControlsMode === 'menu';
const debugKeys = ['oneworks_debug', 'oneworks_devtools_debug'];
const storageDebugKeys = ['oneworks-devtools-debug', 'oneworks_debug'];
const dockSideLabelPatterns = {
  left: [
    /dock\\s*to\\s*left/i,
    /^\\s*left\\s*$/i,
    /停靠.*左/,
    /左侧/
  ],
  bottom: [
    /dock\\s*to\\s*bottom/i,
    /^\\s*bottom\\s*$/i,
    /停靠.*下/,
    /底部|下方/
  ],
  right: [
    /dock\\s*to\\s*right/i,
    /^\\s*right\\s*$/i,
    /停靠.*右/,
    /右侧/
  ]
};
let currentDockSide = searchParams.get('oneworks_dock_side') || 'right';
let isDeviceToolbarOpen = false;
const observedRoots = new WeakSet();

const isDebugValueEnabled = (value) => {
  if (value == null) return false;
  const normalizedValue = String(value).trim().toLowerCase();
  return normalizedValue === '' || (
    normalizedValue !== '0' &&
    normalizedValue !== 'false' &&
    normalizedValue !== 'off' &&
    normalizedValue !== 'no'
  );
};

const readStorageDebugValue = () => {
  for (const key of storageDebugKeys) {
    try {
      const localValue = window.localStorage?.getItem(key);
      if (localValue != null) return localValue;
      const sessionValue = window.sessionStorage?.getItem(key);
      if (sessionValue != null) return sessionValue;
    } catch {
      return null;
    }
  }
  return null;
};

const isDevtoolsDebugEnabled = () => {
  for (const key of debugKeys) {
    const queryValue = searchParams.get(key);
    if (queryValue != null) return isDebugValueEnabled(queryValue);
  }
  return isDebugValueEnabled(readStorageDebugValue());
};

const debugDevtools = (...args) => {
  if (!isDevtoolsDebugEnabled()) return;
  console.debug('[oneworks-devtools]', ...args);
};

const debugDevtoolsJson = (label, payload) => {
  if (!isDevtoolsDebugEnabled()) return;
  let serializedPayload = '';
  try {
    serializedPayload = JSON.stringify(payload);
  } catch (error) {
    serializedPayload = JSON.stringify({
      error: String(error)
    });
  }
  console.debug('[oneworks-devtools]', label, serializedPayload);
  window.parent?.postMessage({
    label,
    payload: serializedPayload,
    source: ONE_WORKS_DEVTOOLS_SOURCE,
    type: 'debug-log'
  }, hostOrigin);
};

const readElementSnapshot = (element) => {
  if (!(element instanceof Element)) return null;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    ariaLabel: element.getAttribute('aria-label'),
    className: typeof element.className === 'string' ? element.className : String(element.className),
    display: style.display,
    flex: style.flex,
    flexBasis: style.flexBasis,
    flexDirection: style.flexDirection,
    height: style.height,
    id: element.id || null,
    maxHeight: style.maxHeight,
    minHeight: style.minHeight,
    overflow: style.overflow,
    padding: style.padding,
    rect: {
      height: Math.round(rect.height * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100
    },
    role: element.getAttribute('role'),
    tagName: element.tagName.toLowerCase(),
    text: element.textContent?.trim?.().slice(0, 80) ?? ''
  };
};

const queryElementSnapshots = (selector, limit = 6) => (
  Array.from(document.querySelectorAll(selector))
    .slice(0, limit)
    .map(readElementSnapshot)
);

const readCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const logDevtoolsDiagnostics = (reason) => {
  if (!isDevtoolsDebugEnabled()) return;
  const roots = collectRoots();
  const styleTagCount = roots.reduce((count, root) => (
    count + (root.querySelectorAll?.('style[data-oneworks-devtools-style="true"]').length ?? 0)
  ), 0);
  const zeroHeightCandidates = Array.from(document.querySelectorAll([
    '.widget.vbox',
    '.tabbed-pane-content',
    '[role="tabpanel"]',
    '#main-content',
    '#elements-content',
    '.elements-wrap'
  ].join(','))).filter((element) => element.getBoundingClientRect().height <= 1);

  debugDevtoolsJson('diagnostics-json', {
    assetVersion: ONE_WORKS_DEVTOOLS_ASSET_VERSION,
    currentDockSide,
    deviceToolbarOpen: isDeviceToolbarOpen,
    location: location.href,
    readyState: document.readyState,
    reason,
    cssVariables: {
      oneWorksToolbarHeight: readCssVariable('--oneworks-devtools-toolbar-total-height'),
      oneWorksToolbarIconSize: readCssVariable('--oneworks-devtools-toolbar-icon-size'),
      toolbarHeight: readCssVariable('--toolbar-height')
    },
    rootCount: roots.length,
    styleTagCount,
    keyElements: {
      deviceToolbar: queryElementSnapshots('.toolbar-shadow.wrappable.toolbar-grow-vertical', 2),
      elementsContent: queryElementSnapshots('#elements-content, .elements-wrap', 4),
      leftToolbar: queryElementSnapshots('.tabbed-pane-left-toolbar.toolbar-shadow', 2),
      mainContent: queryElementSnapshots('#main-content', 2),
      mainToolbar: queryElementSnapshots('.tabbed-pane-header[aria-label="Main toolbar"]', 2),
      selectedTabs: queryElementSnapshots('.tabbed-pane-header-tab.selected', 8),
      tabDropdown: queryElementSnapshots('.tabbed-pane-header-tabs-drop-down-container', 4),
      tabPanels: queryElementSnapshots('[role="tabpanel"]', 8)
    },
    zeroHeightCandidates: zeroHeightCandidates.slice(0, 12).map(readElementSnapshot)
  });
};

const scheduleDevtoolsDiagnostics = (reason) => {
  if (!isDevtoolsDebugEnabled()) return;
  requestAnimationFrame(() => logDevtoolsDiagnostics(reason + ':raf'));
  window.setTimeout(() => logDevtoolsDiagnostics(reason + ':1000ms'), 1000);
};

const readBoundedNumberParam = (name, minimum, maximum) => {
  const value = Number.parseFloat(searchParams.get(name) ?? '');
  if (!Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
};

const readCssColorParam = (name) => {
  const value = searchParams.get(name)?.trim() ?? '';
  if (value === '') return null;
  if (
    /^#[0-9a-f]{3,8}$/iu.test(value) ||
    /^rgba?\\(\\s*[0-9.]+\\s*,\\s*[0-9.]+\\s*,\\s*[0-9.]+(?:\\s*,\\s*(?:[0-9.]+|[0-9.]+%))?\\s*\\)$/iu.test(value) ||
    /^hsla?\\(\\s*[0-9.]+(?:deg|rad|turn)?\\s*,\\s*[0-9.]+%\\s*,\\s*[0-9.]+%(?:\\s*,\\s*(?:[0-9.]+|[0-9.]+%))?\\s*\\)$/iu.test(value)
  ) return value;
  return null;
};

const applyToolbarMetrics = () => {
  const toolbarBackgroundColor = readCssColorParam('oneworks_toolbar_background_color');
  const toolbarIconSize = readBoundedNumberParam('oneworks_toolbar_icon_size', 12, 32);
  const toolbarTotalHeight = readBoundedNumberParam('oneworks_toolbar_total_height', 20, 64);

  if (toolbarBackgroundColor != null) {
    document.documentElement.style.setProperty(
      '--oneworks-devtools-toolbar-bg',
      toolbarBackgroundColor
    );
  }
  if (toolbarIconSize != null) {
    document.documentElement.style.setProperty(
      '--oneworks-devtools-toolbar-icon-size',
      toolbarIconSize + 'px'
    );
  }
  if (toolbarTotalHeight != null) {
    document.documentElement.style.setProperty(
      '--oneworks-devtools-toolbar-total-height',
      toolbarTotalHeight + 'px'
    );
  }
  debugDevtools('apply toolbar metrics', {
    toolbarBackgroundColor,
    toolbarIconSize,
    toolbarTotalHeight
  });
};

const getElementLabel = (element) => [
  element.getAttribute?.('aria-label'),
  element.getAttribute?.('title'),
  element.getAttribute?.('aria-description'),
  element.textContent
].filter(Boolean).join(' ').trim();

const getDockSideFromLabel = (label) => {
  for (const [dockSide, patterns] of Object.entries(dockSideLabelPatterns)) {
    if (patterns.some(pattern => pattern.test(label))) return dockSide;
  }
  return null;
};

const getDockSideFromEvent = (event) => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const item of path) {
    if (!(item instanceof Element)) continue;
    const dockSide = getDockSideFromLabel(getElementLabel(item));
    if (dockSide != null) return dockSide;
  }
  return null;
};

const postDockSide = (dockSide) => {
  currentDockSide = dockSide;
  document.documentElement.dataset.oneworksDockSide = dockSide;
  debugDevtools('post dock side', { dockSide, hostOrigin });
  window.parent?.postMessage({
    dockSide,
    source: ONE_WORKS_DEVTOOLS_SOURCE,
    type: 'set-dock-side'
  }, hostOrigin);
  updateDockSideStateForAllRoots();
};

const handleDockSideButtonEvent = (dockSide, event) => {
  event.preventDefault();
  event.stopPropagation();
  postDockSide(dockSide);
};

const createDockSideButton = (dockSide, label) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'oneworks-dock-side-menu__button';
  button.dataset.oneworksDockSide = dockSide;
  button.setAttribute('aria-label', label);
  button.appendChild(document.createElement('span')).className = 'oneworks-dock-side-menu__glyph';
  button.addEventListener('pointerdown', event => handleDockSideButtonEvent(dockSide, event), true);
  button.addEventListener('mousedown', event => handleDockSideButtonEvent(dockSide, event), true);
  button.addEventListener('click', event => handleDockSideButtonEvent(dockSide, event), true);
  return button;
};

const createDockSideMenu = () => {
  const row = document.createElement('div');
  row.className = 'oneworks-dock-side-menu';
  row.dataset.oneworksDockSideMenu = 'true';

  const label = document.createElement('span');
  label.className = 'oneworks-dock-side-menu__label';
  label.textContent = 'Dock side';
  row.appendChild(label);

  const actions = document.createElement('span');
  actions.className = 'oneworks-dock-side-menu__actions';
  actions.appendChild(createDockSideButton('left', 'Dock to left'));
  actions.appendChild(createDockSideButton('bottom', 'Dock to bottom'));
  actions.appendChild(createDockSideButton('right', 'Dock to right'));
  row.appendChild(actions);
  return row;
};

const isVisible = (element) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
};

const injectRootStyle = (root) => {
  if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) return;
  if (root.querySelector('style[data-oneworks-devtools-style="true"]') != null) return;
  const style = document.createElement('style');
  style.dataset.oneworksDevtoolsStyle = 'true';
  style.textContent = ONE_WORKS_DEVTOOLS_STYLE;
  root.appendChild(style);
  debugDevtools('inject shadow root style', {
    host: root.host?.tagName?.toLowerCase?.() ?? null
  });
};

const collectRoots = (root = document, roots = []) => {
  roots.push(root);
  const elements = root.querySelectorAll?.('*') ?? [];
  for (const element of elements) {
    if (element.shadowRoot == null) continue;
    collectRoots(element.shadowRoot, roots);
  }
  return roots;
};

const discoverShadowRoots = (root = document) => {
  const elements = root.querySelectorAll?.('*') ?? [];
  for (const element of elements) {
    if (element.shadowRoot == null) continue;
    observeRoot(element.shadowRoot);
  }
};

const isMainDevToolsMenu = (menu) => {
  const text = [
    menu.textContent,
    ...Array.from(menu.querySelectorAll?.('[aria-label], [title]') ?? []).map(getElementLabel)
  ].filter(Boolean).join(' ');

  return (
    /Focus page|Hide console drawer|Show console drawer|Run command|Open file|More tools|Help/iu.test(text) &&
    /Search|Run command|Open file/iu.test(text)
  );
};

const injectDockSideMenus = (root = document) => {
  if (!shouldShowDockMenuFallback) return;
  const menus = root.querySelectorAll?.('[role="menu"], .soft-context-menu') ?? [];
  for (const menu of menus) {
    if (!(menu instanceof HTMLElement) || !isVisible(menu)) continue;
    if (!isMainDevToolsMenu(menu)) continue;
    if (menu.querySelector('.oneworks-dock-side-menu') != null) continue;
    menu.insertBefore(createDockSideMenu(), menu.firstChild);
    debugDevtools('inject dock side menu', {
      dockSide: currentDockSide,
      text: menu.textContent?.trim?.().slice(0, 160) ?? ''
    });
  }
  updateDockSideState(root);
};

const updateDockSideState = (root = document) => {
  const controls = root.querySelectorAll?.('.oneworks-dock-side-menu__button') ?? [];
  for (const control of controls) {
    if (!(control instanceof HTMLElement)) continue;
    const dockSide = control.dataset.oneworksDockSide;
    if (dockSide == null) continue;
    const isActive = dockSide === currentDockSide;
    control.classList.toggle('oneworks-dock-side-active', isActive);
    control.setAttribute('aria-pressed', String(isActive));
  }
};

const updateDockSideStateForAllRoots = () => {
  for (const root of collectRoots()) {
    updateDockSideState(root);
  }
};

const updateDeviceToolbarState = (root = document) => {
  const controls = root.querySelectorAll?.('.oneworks-device-toolbar-button') ?? [];
  for (const control of controls) {
    if (!(control instanceof HTMLElement)) continue;
    control.classList.toggle('oneworks-device-toolbar-active', isDeviceToolbarOpen);
    control.setAttribute('aria-pressed', String(isDeviceToolbarOpen));
  }
};

const updateDeviceToolbarStateForAllRoots = () => {
  for (const root of collectRoots()) {
    updateDeviceToolbarState(root);
  }
};

const applyDevtoolsPatch = (root = document) => {
  injectRootStyle(root);
  injectDockSideMenus(root);
  updateDockSideState(root);
  updateDeviceToolbarState(root);
  discoverShadowRoots(root);
};

const observeRoot = (root) => {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  debugDevtools('observe root', {
    kind: root instanceof Document ? 'document' : 'shadow-root',
    host: root.host?.tagName?.toLowerCase?.() ?? null
  });
  applyDevtoolsPatch(root);
  let isPatchScheduled = false;
  const schedulePatch = () => {
    if (isPatchScheduled) return;
    isPatchScheduled = true;
    requestAnimationFrame(() => {
      isPatchScheduled = false;
      applyDevtoolsPatch(root);
    });
  };
  const observer = new MutationObserver(schedulePatch);
  observer.observe(root instanceof Document ? root.documentElement : root, {
    childList: true,
    subtree: true
  });
};

const applyPatchToAllRoots = () => {
  for (const root of collectRoots()) {
    applyDevtoolsPatch(root);
  }
};

applyToolbarMetrics();
scheduleDevtoolsDiagnostics('after-toolbar-metrics');

document.addEventListener('click', (event) => {
  const dockSide = getDockSideFromEvent(event);
  if (dockSide == null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postDockSide(dockSide);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const dockSide = getDockSideFromEvent(event);
  if (dockSide == null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  postDockSide(dockSide);
}, true);

observeRoot(document);
document.documentElement.dataset.oneworksDockSide = currentDockSide;
scheduleDevtoolsDiagnostics('after-observe-document');

let retryPatchCount = 0;
const retryPatchTimer = window.setInterval(() => {
  retryPatchCount += 1;
  applyPatchToAllRoots();
  if ([1, 4, 12, 40].includes(retryPatchCount)) {
    scheduleDevtoolsDiagnostics('retry-patch-' + retryPatchCount);
  }
  if (retryPatchCount >= 40) {
    window.clearInterval(retryPatchTimer);
  }
}, 250);

window.addEventListener('message', (event) => {
  if (hostOrigin !== '*' && event.origin !== hostOrigin) return;
  const data = event.data;
  if (data?.source !== ONE_WORKS_HOST_SOURCE) return;
  debugDevtools('received host message', {
    dockSide: data.dockSide,
    isOpen: data.isOpen,
    origin: event.origin,
    type: data.type
  });

  if (data.type === 'dock-side-changed') {
    if (!['left', 'right', 'bottom'].includes(data.dockSide)) return;
    currentDockSide = data.dockSide;
    document.documentElement.dataset.oneworksDockSide = currentDockSide;
    updateDockSideStateForAllRoots();
    scheduleDevtoolsDiagnostics('host-dock-side-changed');
    return;
  }

  if (data.type === 'device-toolbar-state-changed') {
    isDeviceToolbarOpen = data.isOpen === true;
    updateDeviceToolbarStateForAllRoots();
    scheduleDevtoolsDiagnostics('host-device-toolbar-state-changed');
  }
});

debugDevtools('patch installed', {
  assetVersion: ONE_WORKS_DEVTOOLS_ASSET_VERSION,
  currentDockSide,
  dockControlsMode,
  hostOrigin,
  location: location.href,
  shouldShowDockMenuFallback
});
`

const readChiiAppHtml = () =>
  readFileSync(
    nodeRequire.resolve('chii/public/front_end/chii_app.html'),
    'utf8'
  )

const readChiiLegacyScript = () =>
  readFileSync(
    nodeRequire.resolve('chii/public/front_end/ui/legacy/legacy.js'),
    'utf8'
  )

const patchChiiLegacyScript = (source: string) => {
  const patchedSource = source.replace(
    /registerToolbarItem:function\((\w+)\)\{(\w+)\.push\(\1\)\}/,
    'registerToolbarItem:function($1){const t=globalThis.__ONEWORKS_DEVTOOLS_REWRITE_TOOLBAR_ITEM__?.($1);t!==null&&$2.push(t||$1)}'
  )
  return patchedSource
}

export const injectOneWorksDevtoolsAssets = (basePath: string) => {
  const html = readChiiAppHtml()
  if (html.includes(ONE_WORKS_DEVTOOLS_PATCH_SCRIPT_PATH)) return html

  const appScript = '<script type="module" src="./entrypoints/chii_app/chii_app.js"></script>'
  const tagsBeforeApp = [
    `<link rel="stylesheet" href="${basePath}${ONE_WORKS_DEVTOOLS_STYLE_PATH}?v=${ONE_WORKS_DEVTOOLS_ASSET_VERSION}">`,
    `<script type="module" src="${basePath}${ONE_WORKS_DEVTOOLS_BOOTSTRAP_SCRIPT_PATH}?v=${ONE_WORKS_DEVTOOLS_ASSET_VERSION}"></script>`
  ].join('\n')
  const tagsAfterApp =
    `<script defer src="${basePath}${ONE_WORKS_DEVTOOLS_PATCH_SCRIPT_PATH}?v=${ONE_WORKS_DEVTOOLS_ASSET_VERSION}"></script>`

  return html.includes(appScript)
    ? html.replace(appScript, `${tagsBeforeApp}\n${appScript}\n${tagsAfterApp}`)
    : `${html}\n${tagsBeforeApp}\n${tagsAfterApp}`
}

export const getOneWorksDevtoolsAsset = (path: string, basePath: string) => {
  if (path === `${basePath}${ONE_WORKS_DEVTOOLS_LEGACY_SCRIPT_PATH}`) {
    return {
      body: patchChiiLegacyScript(readChiiLegacyScript()),
      contentType: 'application/javascript; charset=utf-8'
    }
  }

  if (path === `${basePath}${ONE_WORKS_DEVTOOLS_BOOTSTRAP_SCRIPT_PATH}`) {
    return {
      body: oneWorksDevtoolsBootstrapScript,
      contentType: 'application/javascript; charset=utf-8'
    }
  }

  if (path === `${basePath}${ONE_WORKS_DEVTOOLS_PATCH_SCRIPT_PATH}`) {
    return {
      body: oneWorksDevtoolsPatchScript,
      contentType: 'application/javascript; charset=utf-8'
    }
  }

  if (path === `${basePath}${ONE_WORKS_DEVTOOLS_STYLE_PATH}`) {
    return {
      body: oneWorksDevtoolsStyle,
      contentType: 'text/css; charset=utf-8'
    }
  }

  return undefined
}
