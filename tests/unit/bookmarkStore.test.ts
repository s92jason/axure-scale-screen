import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPLETED_FOLDER, STORAGE_PREFIX } from '../../src/shared/constants';
import {
  DEFAULT_FOLDERS,
  addBookmark,
  addFolder,
  getAllBookmarks,
  getBookmark,
  getFolders,
  getSettings,
  ignoreBookmark,
  ignoreProject,
  isIgnored,
  recordVisit,
  removeBookmark,
  removeFolder,
  renameBookmark,
  renameFolder,
  setFolder,
  unignoreProject
} from '../../src/shared/bookmarkStore';

function installChromeMock(data: Record<string, unknown> = {}): void {
  vi.stubGlobal('chrome', {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get: (key: string, cb: (result: Record<string, unknown>) => void) => cb({ [key]: data[key] }),
        set: (items: Record<string, unknown>, cb: () => void) => {
          Object.assign(data, items);
          cb();
        },
        remove: (key: string, cb: () => void) => {
          delete data[key];
          cb();
        }
      }
    }
  });
}

describe('bookmarkStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('adds a new bookmark keyed by projectKey', async () => {
    const bm = await addBookmark({ projectKey: 'axshare:abc', name: 'Demo', url: 'https://abc.axshare.com/' });
    expect(bm.projectKey).toBe('axshare:abc');
    expect(bm.visitCount).toBe(0);
    expect(bm.lastVisitedAt).toBeNull();

    const all = await getAllBookmarks();
    expect(all).toHaveLength(1);
    expect(all[0].projectKey).toBe('axshare:abc');
  });

  it('dedups by projectKey and only updates last known url', async () => {
    await addBookmark({ projectKey: 'axshare:abc', name: 'Demo', url: 'https://abc.axshare.com/a.html' });
    await addBookmark({ projectKey: 'axshare:abc', name: 'ignored name', url: 'https://abc.axshare.com/b.html' });

    const all = await getAllBookmarks();
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe('https://abc.axshare.com/b.html');
    expect(all[0].name).toBe('Demo'); // 既有名稱不被覆寫
  });

  it('records visits by incrementing count and timestamp', async () => {
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u' });
    await recordVisit('k');
    await recordVisit('k');

    const bm = await getBookmark('k');
    expect(bm?.visitCount).toBe(2);
    expect(bm?.lastVisitedAt).toBeTypeOf('number');
  });

  it('renames and re-folders a bookmark', async () => {
    await addBookmark({ projectKey: 'k', name: 'old', url: 'u' });
    await renameBookmark('k', 'new');
    await setFolder('k', 'WIP');

    const bm = await getBookmark('k');
    expect(bm?.name).toBe('new');
    expect(bm?.folder).toBe('WIP');
  });

  it('removes a bookmark', async () => {
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u' });
    await removeBookmark('k');
    expect(await getAllBookmarks()).toHaveLength(0);
  });

  it('manages the ignore list', async () => {
    expect(await isIgnored('k')).toBe(false);
    await ignoreProject('k');
    await ignoreProject('k'); // 不重複
    expect(await isIgnored('k')).toBe(true);
    await unignoreProject('k');
    expect(await isIgnored('k')).toBe(false);
  });

  it('returns default settings when none stored', async () => {
    const settings = await getSettings();
    expect(settings.promptMode).toBe('card');
    expect(settings.chromeSync.enabled).toBe(false);
  });

  it('seeds default folders on first read', async () => {
    expect(await getFolders()).toEqual(DEFAULT_FOLDERS);
  });

  it('restores the completed folder for existing users without restoring optional defaults', async () => {
    const foldersKey = `${STORAGE_PREFIX}bm::folders`;
    const data = { [foldersKey]: ['客製分組', '舊的完成名稱'] };
    installChromeMock(data);
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u', folder: '舊的完成名稱' });

    expect(await getFolders()).toEqual(['客製分組', '舊的完成名稱', COMPLETED_FOLDER]);
    expect(data[foldersKey]).toEqual(['客製分組', '舊的完成名稱', COMPLETED_FOLDER]);
    expect(await getFolders()).toEqual(['客製分組', '舊的完成名稱', COMPLETED_FOLDER]);
    expect((await getBookmark('k'))?.folder).toBe('舊的完成名稱');
  });

  it('restores only the completed folder when all folders were removed', async () => {
    installChromeMock({ [`${STORAGE_PREFIX}bm::folders`]: [] });

    expect(await getFolders()).toEqual([COMPLETED_FOLDER]);
  });

  it('preserves the existing position of the completed folder', async () => {
    installChromeMock({ [`${STORAGE_PREFIX}bm::folders`]: [COMPLETED_FOLDER, '客製分組'] });

    expect(await getFolders()).toEqual([COMPLETED_FOLDER, '客製分組']);
  });

  it('adds a folder without duplicating', async () => {
    await addFolder('新組');
    await addFolder('新組');
    const folders = await getFolders();
    expect(folders.filter((f) => f === '新組')).toHaveLength(1);
  });

  it('renames a folder and updates bookmarks using it', async () => {
    await addFolder('舊');
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u', folder: '舊' });
    await renameFolder('舊', '新');
    expect(await getFolders()).toContain('新');
    expect(await getFolders()).not.toContain('舊');
    expect((await getBookmark('k'))?.folder).toBe('新');
  });

  it('rejects renaming the completed folder and preserves its bookmarks', async () => {
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u', folder: COMPLETED_FOLDER });
    const folders = await getFolders();
    const bookmark = await getBookmark('k');

    await expect(renameFolder(COMPLETED_FOLDER, '新名稱')).rejects.toThrow('不能改名');
    await expect(renameFolder(COMPLETED_FOLDER, '進行中')).rejects.toThrow('不能改名');

    expect(await getFolders()).toEqual(folders);
    expect(await getBookmark('k')).toEqual(bookmark);
  });

  it('allows merging a normal folder into the completed folder', async () => {
    await addFolder('待歸檔');
    await addBookmark({ projectKey: 'pending', name: 'Pending', url: 'u', folder: '待歸檔' });
    await addBookmark({ projectKey: 'completed', name: 'Completed', url: 'v', folder: COMPLETED_FOLDER });

    await renameFolder('待歸檔', ` ${COMPLETED_FOLDER} `);

    expect(await getFolders()).not.toContain('待歸檔');
    expect((await getFolders()).filter((folder) => folder === COMPLETED_FOLDER)).toHaveLength(1);
    expect((await getBookmark('pending'))?.folder).toBe(COMPLETED_FOLDER);
    expect((await getBookmark('completed'))?.folder).toBe(COMPLETED_FOLDER);
  });

  it('removes a folder and sends its bookmarks back to ungrouped', async () => {
    await addFolder('暫存');
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u', folder: '暫存' });
    await removeFolder('暫存');
    expect(await getFolders()).not.toContain('暫存');
    expect((await getBookmark('k'))?.folder).toBe('');
  });

  it('rejects removing the completed folder and preserves its bookmarks', async () => {
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u', folder: COMPLETED_FOLDER });
    const folders = await getFolders();
    const bookmark = await getBookmark('k');

    await expect(removeFolder(COMPLETED_FOLDER)).rejects.toThrow('不能刪除');

    expect(await getFolders()).toEqual(folders);
    expect(await getBookmark('k')).toEqual(bookmark);
  });

  it('ignoreBookmark removes the bookmark and adds to ignore list', async () => {
    await addBookmark({ projectKey: 'k', name: 'n', url: 'u' });
    await ignoreBookmark('k');
    expect(await getBookmark('k')).toBeNull();
    expect(await isIgnored('k')).toBe(true);
  });
});
