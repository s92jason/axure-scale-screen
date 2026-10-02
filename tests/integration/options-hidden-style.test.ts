import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const optionsHtml = readFileSync(resolve('options.html'), 'utf8');
const optionsCss = readFileSync(resolve('src/options/style.css'), 'utf8');

// jsdom 不會載入 <link rel="stylesheet">，改以 inline <style> 注入同一份 CSS，
// 才能讓 getComputedStyle 反映作者樣式與 [hidden] 的層疊結果。
beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = optionsCss;
  document.head.append(style);
  document.body.innerHTML = new DOMParser().parseFromString(optionsHtml, 'text/html').body.innerHTML;
});

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function syncDetail(): HTMLDivElement {
  return document.querySelector<HTMLDivElement>('#syncDetail')!;
}

describe('options hidden attribute styling', () => {
  it('hides the sync detail setting row while it carries the hidden attribute', () => {
    expect(syncDetail().hidden).toBe(true);
    expect(getComputedStyle(syncDetail()).display).toBe('none');
  });

  it('restores the flex layout when the sync detail row is shown and hides it again', () => {
    syncDetail().hidden = false;
    expect(getComputedStyle(syncDetail()).display).toBe('flex');

    syncDetail().hidden = true;
    expect(getComputedStyle(syncDetail()).display).toBe('none');
  });

  it('keeps every element marked hidden in the markup out of the layout', () => {
    const hidden = [...document.body.querySelectorAll<HTMLElement>('[hidden]')];

    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.filter((element) => getComputedStyle(element).display !== 'none').map((element) => element.id))
      .toEqual([]);
  });
});
