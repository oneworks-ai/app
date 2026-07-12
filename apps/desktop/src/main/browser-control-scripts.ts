import { createBrowserCursorActionScript } from './browser-control-cursor'
import type { BrowserAgentCursorVisual } from './browser-control-cursor'

export const createSnapshotScript = (generation: number) =>
  String.raw`
(() => {
  const attr = 'data-oneworks-agent-ref';
  document.querySelectorAll('[' + attr + ']').forEach((element) => element.removeAttribute(attr));
  const candidates = Array.from(document.querySelectorAll(
    'a[href],button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]'
  ));
  const visible = candidates.filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  const elements = visible.slice(0, 300).map((element, index) => {
    const ref = 's${generation}e' + (index + 1);
    element.setAttribute(attr, ref);
    const rect = element.getBoundingClientRect();
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const label = element.getAttribute('aria-label') || element.getAttribute('title') ||
      (element.labels && element.labels[0] && element.labels[0].innerText) ||
      element.innerText || element.getAttribute('placeholder') || element.getAttribute('name') || '';
    const value = element instanceof HTMLInputElement && element.type === 'password'
      ? undefined
      : ('value' in element ? String(element.value || '') : undefined);
    return {
      ref,
      role,
      name: String(label).replace(/\s+/g, ' ').trim().slice(0, 240),
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      ...(element.getAttribute('data-testid') ? { test_id: element.getAttribute('data-testid') } : {}),
      ...(value ? { value: value.slice(0, 240) } : {}),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      }
    };
  });
  return {
    snapshot_id: 's${generation}',
    title: document.title,
    url: location.href,
    text: String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000),
    elements
  };
})()
`

export const createElementActionScript = (
  operation: 'click' | 'select' | 'type',
  ref: string,
  value: string | undefined,
  cursor: BrowserAgentCursorVisual
) =>
  String.raw`
(async () => {
  const element = document.querySelector(${JSON.stringify(`[data-oneworks-agent-ref="${ref}"]`)});
  if (!element) return { ok: false, code: 'TARGET_NOT_FOUND', message: 'The element reference is stale. Take a new snapshot.' };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
${createBrowserCursorActionScript(cursor)}
  element.focus();
  if (${JSON.stringify(operation)} === 'click') {
    void playCursorFeedback(true);
    element.click();
    return { ok: true };
  }
  const nextValue = ${JSON.stringify(value ?? '')};
  if (${JSON.stringify(operation)} === 'select') {
    if (!(element instanceof HTMLSelectElement)) {
      return { ok: false, code: 'TARGET_NOT_SELECT', message: 'The referenced element is not a native select.' };
    }
    const option = Array.from(element.options).find(candidate =>
      candidate.value === nextValue || candidate.label.trim() === nextValue
    );
    if (!option) {
      return { ok: false, code: 'OPTION_NOT_FOUND', message: 'The requested select option was not found.' };
    }
    if (option.disabled) {
      return { ok: false, code: 'OPTION_DISABLED', message: 'The requested select option is disabled.' };
    }
    element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    void playCursorFeedback(false);
    return { ok: true, label: option.label, value: option.value };
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, nextValue); else element.value = nextValue;
  } else if (element.isContentEditable) {
    element.textContent = nextValue;
  } else {
    return { ok: false, code: 'TARGET_NOT_EDITABLE', message: 'The referenced element is not editable.' };
  }
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  void playCursorFeedback(false);
  return { ok: true };
})()
`

export const createWaitProbeScript = (input: { ref?: string; text?: string }) =>
  String.raw`
(() => {
  const ref = ${JSON.stringify(input.ref)};
  if (ref) return document.querySelector('[data-oneworks-agent-ref="' + CSS.escape(ref) + '"]') != null;
  const text = ${JSON.stringify(input.text)};
  if (text) return String(document.body && document.body.innerText || '').includes(text);
  return true;
})()
`

export const createScrollScript = (x: number, y: number) =>
  String.raw`
(async () => {
  const startX = window.scrollX;
  const startY = window.scrollY;
  const maxX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const targetX = Math.min(maxX, Math.max(0, startX + ${x}));
  const targetY = Math.min(maxY, Math.max(0, startY + ${y}));
  const deltaX = targetX - startX;
  const deltaY = targetY - startY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1) return { ok: true, x: window.scrollX, y: window.scrollY };
  const duration = Math.min(1000, Math.max(480, Math.round(360 + distance * .65)));
  const startedAt = performance.now();
  await new Promise(resolve => {
    const step = now => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      const eased = progress < .5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      window.scrollTo({
        behavior: 'instant',
        left: startX + deltaX * eased,
        top: startY + deltaY * eased
      });
      if (progress < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return { ok: true, x: window.scrollX, y: window.scrollY };
})()
`
