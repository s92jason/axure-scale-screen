import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBookmark,
  getAllBookmarks,
  getBookmark,
  getSettings,
  ignoreProject,
  isIgnored,
  recordVisit,
  removeBookmark,
  renameBookmark,
  setFolder,
  unignoreProject
} from '../../src/shared/bookmarkStore';

function installChromeMock(): void {
  const data: Record<string, unknown> = {};
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
});
