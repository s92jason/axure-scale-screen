import { describe, expect, it } from 'vitest';
import { applyZoom, findAxureRoot, getShortcutDelta, isEditableTarget, resetZoom } from '../../src/content/engine';

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

    expect(getShortcutDelta(zoomIn)).toBe(10);
    expect(getShortcutDelta(zoomOut)).toBe(-10);
    expect(getShortcutDelta(reset)).toBe(0);
  });
});
