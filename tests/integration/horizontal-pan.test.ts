import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installHorizontalPan } from '../../src/content/horizontal-pan';

let cleanup: () => void;
let canvas: HTMLElement;
const page = document.documentElement;

function setSize(element: HTMLElement, width = 1600, height = 1200): void {
  Object.defineProperties(element, {
    scrollWidth: { configurable: true, value: width },
    clientWidth: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: 400 }
  });
}

function wheel(target: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="base"><div id="panel"></div></div>';
  document.body.style.cssText = '';
  page.style.cssText = '';
  page.scrollLeft = 0;
  page.scrollTop = 0;
  setSize(page);
  canvas = document.getElementById('base')!;
  cleanup = installHorizontalPan();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.body.style.cssText = '';
  page.style.cssText = '';
});

describe('Axure horizontal panning', () => {
  it('cancels the first horizontal event while preserving page movement', () => {
    page.scrollLeft = 500;
    const event = wheel(canvas, { deltaX: -120 });
    expect(event.defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(380);
  });

  it('absorbs a fast left swipe and its momentum at the left boundary', () => {
    page.scrollLeft = 500;
    for (const deltaX of [-900, -400, -50]) {
      expect(wheel(canvas, { deltaX }).defaultPrevented).toBe(true);
      expect(page.scrollLeft).toBe(0);
    }
  });

  it('absorbs forward swipes at the right boundary', () => {
    page.scrollLeft = 900;
    expect(wheel(canvas, { deltaX: 700 }).defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(1000);
    expect(wheel(canvas, { deltaX: 50 }).defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(1000);
  });

  it('also prevents navigation when the page has no horizontal overflow', () => {
    setSize(page, 600);
    expect(wheel(document.body, { deltaX: -500 }).defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(0);
  });

  it('preserves both axes even when a diagonal swipe is mostly vertical', () => {
    page.scrollLeft = 100;
    const event = wheel(canvas, { deltaX: -2, deltaY: 80 });
    expect(event.defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(98);
    expect(page.scrollTop).toBe(80);
  });

  it('keeps pure vertical scrolling native', () => {
    expect(wheel(canvas, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(page.scrollTop).toBe(0);
  });

  it('scrolls the nearest panel first, passing only its excess to the page', () => {
    const panel = document.getElementById('panel')!;
    panel.style.overflow = 'auto';
    setSize(panel);
    panel.scrollLeft = 970;
    wheel(panel, { deltaX: 80, deltaY: 60 });
    expect(panel.scrollLeft).toBe(1000);
    expect(panel.scrollTop).toBe(60);
    expect(page.scrollLeft).toBe(50);
    expect(page.scrollTop).toBe(0);
  });

  it.each(['contain', 'none'])('honors a panel with overscroll-behavior-x: %s', (behavior) => {
    const panel = document.getElementById('panel')!;
    panel.style.overflow = 'auto';
    panel.style.overscrollBehaviorX = behavior;
    setSize(panel);
    panel.scrollLeft = 970;
    expect(wheel(panel, { deltaX: 80 }).defaultPrevented).toBe(true);
    expect(panel.scrollLeft).toBe(1000);
    expect(page.scrollLeft).toBe(0);
  });

  it('skips panels with hidden overflow', () => {
    const panel = document.getElementById('panel')!;
    panel.style.overflow = 'hidden';
    setSize(panel);
    wheel(panel, { deltaX: 80 });
    expect(panel.scrollLeft).toBe(0);
    expect(page.scrollLeft).toBe(80);
  });

  it('passes scrolling to the viewport when an ancestor cannot actually scroll', () => {
    document.body.style.overflow = 'auto';
    setSize(document.body);
    Object.defineProperty(document.body, 'scrollLeft', {
      configurable: true, get: () => 0, set: () => {}
    });
    try {
      wheel(canvas, { deltaX: 80 });
      expect(page.scrollLeft).toBe(80);
    } finally {
      Reflect.deleteProperty(document.body, 'scrollLeft');
    }
  });

  it.each(['html', 'body'])('respects hidden viewport overflow on %s', (tag) => {
    document.querySelector<HTMLElement>(tag)!.style.overflow = 'hidden';
    expect(wheel(canvas, { deltaX: 80, deltaY: 60 }).defaultPrevented).toBe(true);
    expect(page.scrollLeft).toBe(0);
    expect(page.scrollTop).toBe(0);
  });

  it('leaves Ctrl+wheel to the pinch zoom handler', () => {
    expect(wheel(canvas, { deltaX: 20, deltaY: -40, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(page.scrollLeft).toBe(0);
  });

  it('does not pan during Safari pinch gestures', () => {
    cleanup();
    cleanup = installHorizontalPan(() => true);
    expect(wheel(canvas, { deltaX: 20, deltaY: -40 }).defaultPrevented).toBe(false);
    expect(page.scrollLeft).toBe(0);
  });

  it('does not manually scroll events already handled by the page', () => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80 });
    event.preventDefault();
    canvas.dispatchEvent(event);
    expect(page.scrollLeft).toBe(0);
  });

  it('does not double-scroll noncancelable events', () => {
    expect(wheel(canvas, { deltaX: 80, cancelable: false }).defaultPrevented).toBe(false);
    expect(page.scrollLeft).toBe(0);
  });

  it('converts line deltas to pixels using the target line height', () => {
    canvas.style.lineHeight = '24px';
    wheel(canvas, { deltaX: 2, deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(page.scrollLeft).toBe(48);
    expect(page.scrollTop).toBe(72);
  });

  it('converts page deltas using the viewport dimensions', () => {
    wheel(canvas, { deltaX: 0.5, deltaY: 0.5, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(page.scrollLeft).toBe(window.innerWidth * 0.5);
    expect(page.scrollTop).toBe(window.innerHeight * 0.5);
  });

  it('handles negative horizontal offsets in RTL panels', () => {
    const panel = document.getElementById('panel')!;
    panel.style.cssText = 'overflow: auto; direction: rtl';
    setSize(panel);
    wheel(panel, { deltaX: -80 });
    expect(panel.scrollLeft).toBe(-80);
    expect(page.scrollLeft).toBe(0);
  });

  it('finds scrolling panels inside Shadow DOM', () => {
    const shadow = canvas.attachShadow({ mode: 'open' });
    const panel = document.createElement('div');
    panel.style.overflow = 'auto';
    setSize(panel);
    shadow.appendChild(panel);
    wheel(panel, { deltaX: 80 });
    expect(panel.scrollLeft).toBe(80);
    expect(page.scrollLeft).toBe(0);
  });

  it('can remove the wheel listener', () => {
    cleanup();
    expect(wheel(canvas, { deltaX: -80 }).defaultPrevented).toBe(false);
  });
});
