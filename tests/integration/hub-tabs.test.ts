import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindHubTabs } from '../../src/popup/hub-tabs';

function markup(): string {
  return `
    <div role="tablist" aria-label="專案工具">
      <button type="button" id="hubBookmarks" role="tab" aria-controls="bookmarkPanel" aria-selected="true" tabindex="0">書籤</button>
      <button type="button" id="hubCleanup" role="tab" aria-controls="tabCleanup" aria-selected="false" tabindex="-1">清理頁籤<span id="cleanupCount" hidden></span></button>
    </div>
    <section id="bookmarkPanel" role="tabpanel" aria-labelledby="hubBookmarks">
      <input id="bmSearch" aria-label="搜尋書籤">
      <ul><li>原型專案</li></ul>
    </section>
    <section id="tabCleanup" role="tabpanel" aria-labelledby="hubCleanup" hidden>
      <ul><li>已完成專案</li></ul>
      <button type="button">一鍵關閉全部</button>
    </section>
  `;
}

let root: HTMLElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  document.body.innerHTML = `<main>${markup()}</main>`;
  root = document.querySelector('main')!;
  dispose = bindHubTabs(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function tab(id: 'hubBookmarks' | 'hubCleanup'): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`#${id}`)!;
}

function expectSelected(id: 'hubBookmarks' | 'hubCleanup'): void {
  for (const tabId of ['hubBookmarks', 'hubCleanup'] as const) {
    const button = tab(tabId);
    const selected = tabId === id;
    const panel = root.querySelector<HTMLElement>(`#${button.getAttribute('aria-controls')}`)!;
    expect(button.getAttribute('aria-selected')).toBe(String(selected));
    expect(button.tabIndex).toBe(selected ? 0 : -1);
    expect(panel.hidden).toBe(!selected);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabId);
  }
}

function press(button: HTMLButtonElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  return event;
}

describe('bookmark and cleanup tabs', () => {
  it('starts on bookmarks without taking focus and switches panels on click', () => {
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(document.body);

    tab('hubCleanup').click();
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));

    tab('hubBookmarks').click();
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(tab('hubBookmarks'));
  });

  it('keeps each panel content and form state when switching tabs', () => {
    const search = root.querySelector<HTMLInputElement>('#bmSearch')!;
    const bookmarkRow = root.querySelector('#bookmarkPanel li')!;
    const cleanupRow = root.querySelector('#tabCleanup li')!;
    search.value = '原型';

    tab('hubCleanup').click();
    cleanupRow.textContent = '更新後的完成專案';
    tab('hubBookmarks').click();

    expect(root.querySelector('#bmSearch')).toBe(search);
    expect(search.value).toBe('原型');
    expect(root.querySelector('#bookmarkPanel li')).toBe(bookmarkRow);
    expect(root.querySelector('#tabCleanup li')).toBe(cleanupRow);
    expect(cleanupRow.textContent).toBe('更新後的完成專案');
  });

  it('moves focus and selection with left and right arrows, wrapping in both directions', () => {
    tab('hubBookmarks').focus();
    expect(press(tab('hubBookmarks'), 'ArrowRight').defaultPrevented).toBe(true);
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));

    press(tab('hubCleanup'), 'ArrowRight');
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(tab('hubBookmarks'));

    press(tab('hubBookmarks'), 'ArrowLeft');
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));

    press(tab('hubCleanup'), 'ArrowLeft');
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(tab('hubBookmarks'));
  });

  it('uses Home and End to select and focus the first and last tabs', () => {
    expect(press(tab('hubBookmarks'), 'End').defaultPrevented).toBe(true);
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));

    expect(press(tab('hubCleanup'), 'Home').defaultPrevented).toBe(true);
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(tab('hubBookmarks'));
  });

  it('does not intercept unrelated keys or key presses from panel content', () => {
    tab('hubBookmarks').focus();
    for (const key of ['Tab', 'Enter', 'Escape', 'ArrowDown', 'a']) {
      expect(press(tab('hubBookmarks'), key).defaultPrevented).toBe(false);
      expectSelected('hubBookmarks');
      expect(document.activeElement).toBe(tab('hubBookmarks'));
    }
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft', bubbles: true, cancelable: true, [modifier]: true
      });
      tab('hubBookmarks').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expectSelected('hubBookmarks');
    }
    const search = root.querySelector<HTMLInputElement>('#bmSearch')!;
    search.focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    search.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(search);
  });

  it('keeps the selected panel and current focus when cleanup count changes', () => {
    const search = root.querySelector<HTMLInputElement>('#bmSearch')!;
    search.focus();
    const count = root.querySelector<HTMLElement>('#cleanupCount')!;
    count.textContent = '12';
    count.hidden = false;

    expectSelected('hubBookmarks');
    expect(document.activeElement).toBe(search);
    count.click();
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));

    count.textContent = '0';
    count.hidden = true;
    expectSelected('hubCleanup');
    expect(document.activeElement).toBe(tab('hubCleanup'));
  });

  it('limits tab and panel changes to the given root', () => {
    const outside = document.createElement('aside');
    outside.innerHTML = markup();
    document.body.prepend(outside);

    tab('hubCleanup').click();

    expectSelected('hubCleanup');
    expect(outside.querySelector('#hubBookmarks')!.getAttribute('aria-selected')).toBe('true');
    expect(outside.querySelector<HTMLElement>('#tabCleanup')!.hidden).toBe(true);
  });

  it('ignores disabled tabs and removes interaction handlers when disposed', () => {
    tab('hubCleanup').disabled = true;
    tab('hubCleanup').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    press(tab('hubBookmarks'), 'ArrowRight');
    expectSelected('hubBookmarks');

    tab('hubCleanup').disabled = false;
    dispose!();
    tab('hubCleanup').click();
    expect(press(tab('hubBookmarks'), 'End').defaultPrevented).toBe(false);
    expectSelected('hubBookmarks');
  });
});
