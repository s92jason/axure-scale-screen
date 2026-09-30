import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { AxureBookmark, RuntimeMessage, RuntimeResponse } from '../../src/shared/types';

const optionsHtml = readFileSync(resolve('options.html'), 'utf8');
let bookmarks: AxureBookmark[];
let folders: string[];
let sendMessage: ReturnType<typeof vi.fn<(message: RuntimeMessage, callback: (response: RuntimeResponse) => void) => void>>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(optionsHtml, 'text/html').body.innerHTML;
  folders = ['已完成', '進行中'];
  bookmarks = [{
    projectKey: 'axshare:project',
    name: '範例原型',
    url: 'https://project.axshare.com/',
    folder: '進行中',
    createdAt: 1,
    lastVisitedAt: null,
    visitCount: 0
  }];
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  sendMessage = vi.fn((message, callback) => {
    switch (message.type) {
      case 'BOOKMARK_GET_ALL':
        callback({ ok: true, bookmarks });
        break;
      case 'BOOKMARK_GET_FOLDERS':
        callback({ ok: true, folders });
        break;
      case 'BOOKMARK_GET_IGNORED':
        callback({ ok: true, ignored: [] });
        break;
      case 'AXURE_GET_COMPLETED_TABS':
        callback({ ok: true, completedTabs: [] });
        break;
      case 'BOOKMARK_SET_FOLDER':
        bookmarks = bookmarks.map((bookmark) => bookmark.projectKey === message.projectKey
          ? { ...bookmark, folder: message.folder }
          : bookmark);
        callback({ ok: true });
        break;
      case 'SETTINGS_GET':
        callback({ ok: true, settings: { promptMode: 'card', chromeSync: { enabled: false, parentFolderId: null } } });
        break;
      default:
        callback({ ok: true });
    }
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { onCreated: event(), onRemoved: event(), onUpdated: event() },
    storage: {
      onChanged: event(),
      local: {
        get: vi.fn((key: string, callback: (result: Record<string, unknown>) => void) => {
          const data: Record<string, unknown> = {
            [`${STORAGE_PREFIX}bm::items`]: Object.fromEntries(bookmarks.map((bookmark) => [bookmark.projectKey, bookmark])),
            [`${STORAGE_PREFIX}bm::folders`]: folders,
            [`${STORAGE_PREFIX}bm::ignored`]: [],
            [`${STORAGE_PREFIX}bm::settings`]: { promptMode: 'card', chromeSync: { enabled: false, parentFolderId: null } }
          };
          callback({ [key]: data[key] });
        }),
        set: vi.fn(),
        remove: vi.fn()
      }
    }
  });
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function loadOptions(): Promise<void> {
  await import('../../src/options/main');
  await vi.dynamicImportSettled();
}

function groupRow(name: string): HTMLLIElement {
  return [...document.querySelectorAll<HTMLLIElement>('#folderList li')]
    .find((row) => row.querySelector('.folder-name')!.textContent!.startsWith(`${name}（`))!;
}

describe('options fixed completed group', () => {
  it('labels 已完成 as fixed with no rename or delete controls while other groups remain editable', async () => {
    await loadOptions();

    const completed = groupRow('已完成');
    expect(completed.querySelector('.folder-fixed')!.textContent).toBe('固定分組');
    expect(completed.querySelectorAll('button')).toHaveLength(0);
    expect([...groupRow('進行中').querySelectorAll('button')].map((button) => button.textContent))
      .toEqual(['改名', '刪除']);
    expect(document.querySelector<HTMLParagraphElement>('#folderEmpty')!.hidden).toBe(true);
  });

  it('keeps 已完成 available for assigning bookmarks and filtering the list', async () => {
    await loadOptions();

    const select = document.querySelector<HTMLSelectElement>('#rows .folder-select')!;
    expect([...select.options].map((option) => option.value)).toContain('已完成');
    select.value = '已完成';
    select.dispatchEvent(new Event('change'));
    await vi.dynamicImportSettled();

    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'BOOKMARK_SET_FOLDER', projectKey: 'axshare:project', folder: '已完成' },
      expect.any(Function)
    );
    expect(groupRow('已完成').querySelector('.folder-name')!.textContent).toBe('已完成（1）');
    expect(document.querySelector<HTMLSelectElement>('#rows .folder-select')!.value).toBe('已完成');
    const filter = document.querySelector<HTMLSelectElement>('#folder')!;
    filter.value = '已完成';
    filter.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('#rows tr')).toHaveLength(1);
    filter.value = '進行中';
    filter.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('#rows tr')).toHaveLength(0);
  });

  it('preserves rename and delete actions for user-created groups', async () => {
    await loadOptions();
    vi.spyOn(window, 'prompt').mockReturnValue('待驗收');

    groupRow('進行中').querySelector<HTMLButtonElement>('button')!.click();
    await vi.dynamicImportSettled();
    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'BOOKMARK_RENAME_FOLDER', name: '進行中', newName: '待驗收' },
      expect.any(Function)
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    groupRow('進行中').querySelectorAll<HTMLButtonElement>('button')[1].click();
    await vi.dynamicImportSettled();
    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'BOOKMARK_REMOVE_FOLDER', name: '進行中' },
      expect.any(Function)
    );
    expect(groupRow('已完成').querySelectorAll('button')).toHaveLength(0);
  });
});
