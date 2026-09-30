import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windowListeners = vi.spyOn(window, 'addEventListener');
const documentListeners = vi.spyOn(document, 'addEventListener');
const timers = vi.spyOn(window, 'setTimeout');

beforeEach(() => {
  vi.resetModules();
  windowListeners.mockClear();
  documentListeners.mockClear();
  timers.mockClear();
  document.body.innerHTML = '<div id="base"></div>';
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      sendMessage: vi.fn((_message, callback) => callback({ ok: true })),
      onMessage: { addListener: vi.fn() }
    }
  });
});

afterEach(() => {
  for (const [type, listener, options] of windowListeners.mock.calls) {
    window.removeEventListener(type, listener, options);
  }
  for (const [type, listener, options] of documentListeners.mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  for (const result of timers.mock.results) {
    if (result.type === 'return') {
      window.clearTimeout(result.value);
    }
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function loadContent(isAxure: boolean): Promise<HTMLElement> {
  if (isAxure) {
    const script = document.createElement('script');
    script.src = '/resources/scripts/axure/axure.js';
    document.body.appendChild(script);
  }
  await import('../../src/content/axureZoom');
  await vi.dynamicImportSettled();
  return document.getElementById('base')!;
}

function horizontalWheel(target: HTMLElement, ctrlKey = false): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -100, ctrlKey });
  target.dispatchEvent(event);
  return event;
}

function gesture(type: string, scale = 1): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  window.dispatchEvent(event);
  return event;
}

describe('content script gesture integration', () => {
  it('keeps horizontal navigation native on non-Axure pages with a generic #base', async () => {
    const root = await loadContent(false);
    expect(horizontalWheel(root).defaultPrevented).toBe(false);
    expect(root.style.transform).toBe('');
  });

  it('installs horizontal navigation protection on detected Axure documents', async () => {
    const root = await loadContent(true);
    expect(horizontalWheel(root).defaultPrevented).toBe(true);
    expect(root.style.transform).toBe('scale(1)');
  });

  it('lets Safari pinch gestures run, then resumes horizontal protection', async () => {
    const root = await loadContent(true);
    expect(gesture('gesturestart').defaultPrevented).toBe(true);
    expect(horizontalWheel(root).defaultPrevented).toBe(false);
    expect(gesture('gesturechange', 1.7).defaultPrevented).toBe(true);
    expect(root.style.transform).toBe('scale(1.7)');
    gesture('gestureend');
    expect(horizontalWheel(root).defaultPrevented).toBe(true);
  });

  it('preserves pinch bounds and keyboard reset alongside horizontal panning', async () => {
    const root = await loadContent(true);
    gesture('gesturestart');
    gesture('gesturechange', 0.1);
    expect(root.style.transform).toBe('scale(0.5)');
    gesture('gesturechange', 10);
    expect(root.style.transform).toBe('scale(4)');
    gesture('gestureend');

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, altKey: true }));
    expect(root.style.transform).toBe('scale(1)');
    expect(horizontalWheel(root).defaultPrevented).toBe(true);
  });

  it('preserves the Ctrl+wheel zoom path', async () => {
    const root = await loadContent(true);
    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, ctrlKey: true, deltaX: 20, deltaY: -30
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(root.style.transform).toBe('scale(1.3)');
  });
});
