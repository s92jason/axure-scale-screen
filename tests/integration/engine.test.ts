import { describe, expect, it } from 'vitest';
import {
  applyZoom,
  findAxureRoot,
  getShortcutDelta,
  isEditableTarget,
  isLikelyAxureDocument,
  resetZoom
} from '../../src/content/engine';

function createAxureDom(): HTMLElement {
  document.body.innerHTML = `
    <div id="host">
      <div id="base" style="width: 1000px; height: 800px"></div>
    </div>
  `;

  const root = document.querySelector<HTMLElement>('#base');
  if (!root) {
    throw new Error('failed to create root');
  }

  return root;
}

describe('content engine', () => {
  it('finds axure root', () => {
    createAxureDom();
    expect(findAxureRoot()).not.toBeNull();
  });

  it('detects likely axure document with runtime hint', () => {
    const root = createAxureDom();
    const win = window as Window & { $axure?: unknown };
    win.$axure = {};

    expect(isLikelyAxureDocument(root)).toBe(true);

    delete win.$axure;
  });

  it('rejects non-axure document when hints are missing', () => {
    const root = createAxureDom();
    expect(isLikelyAxureDocument(root)).toBe(false);
  });

  it('applies zoom and creates wrapper', () => {
    const root = createAxureDom();
    const zoom = applyZoom(root, 130);

    expect(zoom).toBe(130);
    expect(root.style.transform).toContain('scale(1.3)');
    expect(root.parentElement?.getAttribute('data-axure-scale-wrapper')).toBe('true');
  });

  it('resets zoom back to 100%', () => {
    const root = createAxureDom();
    applyZoom(root, 170);
    const zoom = resetZoom(root);

    expect(zoom).toBe(100);
    expect(root.style.transform).toContain('scale(1)');
  });

  it('recognizes editable targets', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
  });

  it('maps keyboard shortcuts to zoom actions', () => {
    const zoomIn = new KeyboardEvent('keydown', { key: '+', ctrlKey: true });
    const zoomOut = new KeyboardEvent('keydown', { key: '-', metaKey: true });
    const reset = new KeyboardEvent('keydown', { key: '0', metaKey: true });
    const fallbackIn = new KeyboardEvent('keydown', { code: 'ArrowUp', altKey: true, shiftKey: true });
    const fallbackOut = new KeyboardEvent('keydown', { code: 'ArrowDown', altKey: true, shiftKey: true });
    const fallbackReset = new KeyboardEvent('keydown', { code: 'Digit0', altKey: true, shiftKey: true });

    expect(getShortcutDelta(zoomIn)).toBe(10);
    expect(getShortcutDelta(zoomOut)).toBe(-10);
    expect(getShortcutDelta(reset)).toBe(0);
    expect(getShortcutDelta(fallbackIn)).toBe(10);
    expect(getShortcutDelta(fallbackOut)).toBe(-10);
    expect(getShortcutDelta(fallbackReset)).toBe(0);
  });
});
