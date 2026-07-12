export interface BrowserAgentCursorVisual {
  color: string
  svg: string
}

export const createBrowserCursorActionScript = (cursor: BrowserAgentCursorVisual) =>
  String.raw`
  const cursorId = '__oneworks_browser_driver_cursor';
  const cursorSize = 28;
  const cursorHotspot = { x: 5, y: 5 };
  let cursorHost = document.getElementById(cursorId);
  if (!cursorHost) {
    cursorHost = document.createElement('div');
    cursorHost.id = cursorId;
    cursorHost.setAttribute('aria-hidden', 'true');
    cursorHost.style.position = 'fixed';
    cursorHost.style.left = '0';
    cursorHost.style.top = '0';
    cursorHost.style.width = cursorSize + 'px';
    cursorHost.style.height = cursorSize + 'px';
    cursorHost.style.pointerEvents = 'none';
    cursorHost.style.zIndex = '2147483647';
    cursorHost.style.opacity = '0';
    cursorHost.style.willChange = 'transform, opacity';
    cursorHost.style.contain = 'layout style';
    cursorHost.style.overflow = 'visible';
    const shadow = cursorHost.attachShadow({ mode: 'open' });
    const graphic = document.createElement('div');
    graphic.setAttribute('data-oneworks-browser-driver-cursor-graphic', '');
    graphic.style.width = cursorSize + 'px';
    graphic.style.height = cursorSize + 'px';
    graphic.style.filter = 'drop-shadow(0 2px 3px rgba(15, 23, 42, .28))';
    graphic.innerHTML = ${JSON.stringify(cursor.svg)};
    const svg = graphic.querySelector('svg');
    if (svg) {
      svg.style.display = 'block';
      svg.style.width = cursorSize + 'px';
      svg.style.height = cursorSize + 'px';
    }
    shadow.appendChild(graphic);
    document.documentElement.appendChild(cursorHost);
  }
  cursorHost.dataset.color = ${JSON.stringify(cursor.color)};
  const graphic = cursorHost.shadowRoot &&
    cursorHost.shadowRoot.querySelector('[data-oneworks-browser-driver-cursor-graphic]');
  const rect = element.getBoundingClientRect();
  const targetX = Math.min(window.innerWidth - cursorHotspot.x, Math.max(cursorHotspot.x, rect.left + rect.width / 2));
  const targetY = Math.min(window.innerHeight - cursorHotspot.y, Math.max(cursorHotspot.y, rect.top + rect.height / 2));
  const fromX = Number(cursorHost.dataset.x || window.innerWidth / 2);
  const fromY = Number(cursorHost.dataset.y || window.innerHeight / 2);
  const toTransform = (x, y) =>
    'translate3d(' + (x - cursorHotspot.x) + 'px,' + (y - cursorHotspot.y) + 'px,0)';
  cursorHost.style.opacity = '1';
  cursorHost.style.transform = toTransform(fromX, fromY);
  const distance = Math.hypot(targetX - fromX, targetY - fromY);
  const duration = Math.min(900, Math.max(360, Math.round(260 + distance * .75)));
  const movement = cursorHost.animate(
    [
      { transform: toTransform(fromX, fromY) },
      { transform: toTransform(targetX, targetY) }
    ],
    { duration, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'forwards' }
  );
  await movement.finished.catch(() => undefined);
  cursorHost.style.transform = toTransform(targetX, targetY);
  cursorHost.dataset.x = String(targetX);
  cursorHost.dataset.y = String(targetY);
  const playCursorFeedback = async withRipple => {
    const animations = [];
    if (graphic && typeof graphic.animate === 'function') {
      animations.push(graphic.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(.86)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'cubic-bezier(.25,.1,.25,1)' }
      ).finished.catch(() => undefined));
    }
    let rippleHost;
    if (withRipple) {
      rippleHost = document.createElement('div');
      rippleHost.setAttribute('data-oneworks-browser-driver-click-ripple', '');
      rippleHost.setAttribute('aria-hidden', 'true');
      rippleHost.style.position = 'fixed';
      rippleHost.style.left = (targetX - 22) + 'px';
      rippleHost.style.top = (targetY - 22) + 'px';
      rippleHost.style.width = '44px';
      rippleHost.style.height = '44px';
      rippleHost.style.pointerEvents = 'none';
      rippleHost.style.zIndex = '2147483646';
      rippleHost.style.contain = 'layout style';
      const rippleShadow = rippleHost.attachShadow({ mode: 'open' });
      const ripple = document.createElement('span');
      ripple.style.display = 'block';
      ripple.style.width = '44px';
      ripple.style.height = '44px';
      ripple.style.border = '2px solid ' + ${JSON.stringify(cursor.color)};
      ripple.style.borderRadius = '999px';
      ripple.style.boxSizing = 'border-box';
      ripple.style.pointerEvents = 'none';
      ripple.style.opacity = '.78';
      rippleShadow.appendChild(ripple);
      document.documentElement.appendChild(rippleHost);
      animations.push(ripple.animate(
        [
          { opacity: .78, transform: 'scale(.14)' },
          { opacity: .48, offset: .48, transform: 'scale(.8)' },
          { opacity: 0, transform: 'scale(1.55)' }
        ],
        { duration: 680, easing: 'cubic-bezier(.2,.65,.25,1)' }
      ).finished.catch(() => undefined));
    }
    await Promise.all(animations);
    rippleHost && rippleHost.remove();
  };
`
