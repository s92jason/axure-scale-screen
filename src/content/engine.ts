import {
  AXURE_ROOT_SELECTORS,
  DEFAULT_ZOOM,
  SCALE_WRAPPER_ATTR,
  ZOOM_STEP
} from '../shared/constants';
import type { ZoomLevel } from '../shared/types';
import { toZoomLevel } from '../shared/zoom';

function updateWrapperSize(root: HTMLElement, wrapper: HTMLDivElement, zoom: ZoomLevel): void {
  const scale = zoom / 100;
  const width = Math.ceil(root.scrollWidth * scale);
  const height = Math.ceil(root.scrollHeight * scale);

  wrapper.style.width = `${Math.max(width, 1)}px`;
  wrapper.style.height = `${Math.max(height, 1)}px`;
}

export function findAxureRoot(doc: Document = document): HTMLElement | null {
  for (const selector of AXURE_ROOT_SELECTORS) {
    const node = doc.querySelector(selector);
    if (node instanceof HTMLElement) {
      return node;
    }
  }

  return null;
}

export function isLikelyAxureDocument(
  root: HTMLElement | null,
  doc: Document = document,
  win: Window = window
): root is HTMLElement {
  if (!root) {
    return false;
  }

  const rootMatchesKnownSelector = AXURE_ROOT_SELECTORS.some((selector) => root.matches(selector));
  if (!rootMatchesKnownSelector) {
    return false;
  }

  const runtimeWindow = win as Window & { $axure?: unknown };
  const hasAxureRuntime = typeof runtimeWindow.$axure !== 'undefined';
  const hasAxureAssets = Boolean(
    doc.querySelector('script[src*="axure"], script[src*="/axshare"], link[href*="axure"]')
  );

  return hasAxureRuntime || hasAxureAssets;
}

export function ensureScaleWrapper(root: HTMLElement): HTMLDivElement {
  const parent = root.parentElement;
  if (!parent) {
    throw new Error('Axure root has no parent');
  }

  if (parent instanceof HTMLDivElement && parent.hasAttribute(SCALE_WRAPPER_ATTR)) {
    return parent;
  }

  const wrapper = document.createElement('div');
  wrapper.setAttribute(SCALE_WRAPPER_ATTR, 'true');
  wrapper.style.position = 'relative';
  wrapper.style.overflow = 'visible';
  wrapper.style.transformOrigin = 'top left';

  parent.insertBefore(wrapper, root);
  wrapper.appendChild(root);

  return wrapper;
}

export function applyZoom(root: HTMLElement, zoomInput: number): ZoomLevel {
  const zoom = toZoomLevel(zoomInput);
  const scale = zoom / 100;
  const wrapper = ensureScaleWrapper(root);

  root.style.transformOrigin = 'top left';
  root.style.transform = `scale(${scale})`;

  // 同步縮放後可視區尺寸，避免內容被裁切。
  updateWrapperSize(root, wrapper, zoom);

  return zoom;
}

export function resetZoom(root: HTMLElement): ZoomLevel {
  return applyZoom(root, DEFAULT_ZOOM);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

export function getShortcutDelta(event: KeyboardEvent): number | null {
  const code = event.code;

  // 主快捷鍵：Cmd/Ctrl + Option + =/-/0（放大鍵接受 = 或 +，故不限制 Shift）。
  // 刻意避開原生縮放的保留鍵 Cmd +/-（Safari 攔不住、chrome.commands 也不收 +/-）。
  // 用 event.code（實體鍵位）而非 event.key：按住 Option 時 Mac 的 key 會變成 ≠ / – 等特殊字元。
  if ((event.metaKey || event.ctrlKey) && event.altKey) {
    if (code === 'Equal' || code === 'NumpadAdd') {
      return ZOOM_STEP;
    }

    if (code === 'Minus' || code === 'NumpadSubtract') {
      return -ZOOM_STEP;
    }

    if (code === 'Digit0' || code === 'Numpad0') {
      return 0;
    }
  }

  return null;
}
