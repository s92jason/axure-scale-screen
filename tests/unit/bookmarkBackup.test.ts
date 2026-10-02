import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  describeBackupAge,
  mergeBackup,
  normalizeBackup,
  parseBackup
} from '../../src/shared/bookmarkBackup';
import { COMPLETED_FOLDER } from '../../src/shared/constants';
import type { AxureBookmark } from '../../src/shared/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 3, 0, 0);

function bookmark(projectKey: string, overrides: Partial<AxureBookmark> = {}): AxureBookmark {
  return {
    projectKey,
    url: `https://${projectKey.replace('axshare:', '')}.axshare.com/`,
    name: projectKey,
    folder: '',
    createdAt: 1,
    lastVisitedAt: null,
    visitCount: 0,
    ...overrides
  };
}

describe('createBackup / parseBackup', () => {
  it('round-trips bookmarks, folders and ignored projects through JSON', () => {
    const data = {
      bookmarks: [bookmark('axshare:abc', { name: '首頁改版', folder: '進行中', lastVisitedAt: 5, visitCount: 3 })],
      folders: ['進行中', COMPLETED_FOLDER],
      ignored: ['axshare:skip']
    };

    const backup = createBackup(data, NOW);
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-10-02T03:00:00.000Z' });
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it('rejects files that are not JSON, not ours, or from an unknown version', () => {
    expect(() => parseBackup('<html>')).toThrow('不是有效的 JSON');
    expect(() => parseBackup(JSON.stringify({ bookmarks: [] }))).toThrow('不是 Axure Scale Screen 的備份檔');
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2, bookmarks: [] }))).toThrow('不支援的備份檔版本');
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }))).toThrow('缺少書籤清單');
  });

  it('rejects bookmarks without a projectKey or url and names the offending row', () => {
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, bookmarks: [bookmark('axshare:ok'), { name: 'no key' }] };
    expect(() => normalizeBackup(backup)).toThrow('第 2 筆書籤缺少 projectKey 或 url');
  });

  it('only accepts http, https and file urls because they are opened with tabs.create', () => {
    const withUrl = (url: string) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, bookmarks: [{ projectKey: 'k', url }] });
    expect(() => normalizeBackup(withUrl('javascript:alert(1)'))).toThrow('第 1 筆書籤的網址不是 http、https 或 file');
    expect(() => normalizeBackup(withUrl('data:text/html,hi'))).toThrow('不是 http、https 或 file');
    expect(normalizeBackup(withUrl('file:///Users/me/proto/index.html')).bookmarks).toHaveLength(1);
    expect(normalizeBackup(withUrl('HTTPS://abc.axshare.com/')).bookmarks).toHaveLength(1);
  });

  it('fills defaults for optional fields so hand-edited backups still import', () => {
    const backup = normalizeBackup(
      {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        bookmarks: [{ projectKey: 'axshare:min', url: 'https://min.axshare.com/', visitCount: -4 }],
        folders: [' 參考 ', '參考', ''],
        ignored: undefined
      },
      NOW
    );

    expect(backup.bookmarks[0]).toEqual({
      projectKey: 'axshare:min',
      url: 'https://min.axshare.com/',
      name: 'axshare:min',
      folder: '',
      createdAt: NOW,
      lastVisitedAt: null,
      visitCount: 0
    });
    expect(backup.folders).toEqual(['參考']);
    expect(backup.ignored).toEqual([]);
    expect(backup.exportedAt).toBe('');
  });

  it('rejects non-string folder or ignored lists', () => {
    const base = { format: BACKUP_FORMAT, version: BACKUP_VERSION, bookmarks: [] };
    expect(() => normalizeBackup({ ...base, folders: [1] })).toThrow('分組必須是文字清單');
    expect(() => normalizeBackup({ ...base, ignored: 'axshare:a' })).toThrow('忽略清單必須是文字清單');
  });
});

describe('mergeBackup', () => {
  it('adds only missing bookmarks and leaves existing ones untouched', () => {
    const existing = bookmark('axshare:keep', { name: '我改過的名字', folder: '進行中', visitCount: 9 });
    const backup = createBackup({
      bookmarks: [bookmark('axshare:keep', { name: '備份裡的舊名字', visitCount: 1 }), bookmark('axshare:new', { folder: '參考' })],
      folders: ['參考', '待確認'],
      ignored: ['axshare:skip']
    });

    const merged = mergeBackup({ items: { [existing.projectKey]: existing }, folders: ['進行中', COMPLETED_FOLDER], ignored: [] }, backup);

    expect(merged.added).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.items['axshare:keep']).toEqual(existing);
    expect(merged.items['axshare:new'].folder).toBe('參考');
    expect(merged.folders).toEqual(['進行中', COMPLETED_FOLDER, '參考', '待確認']);
    expect(merged.ignored).toEqual(['axshare:skip']);
  });

  it('is idempotent: importing the same backup twice adds nothing the second time', () => {
    const backup = createBackup({ bookmarks: [bookmark('axshare:a')], folders: [], ignored: ['axshare:x'] });
    const first = mergeBackup({ items: {}, folders: [COMPLETED_FOLDER], ignored: [] }, backup);
    const second = mergeBackup(first, backup);

    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.items).toEqual(first.items);
    expect(second.folders).toEqual(first.folders);
    expect(second.ignored).toEqual(['axshare:x']);
  });

  it('keeps the fixed completed folder and registers folders used by imported bookmarks', () => {
    const backup = createBackup({ bookmarks: [bookmark('axshare:a', { folder: '舊分組' })], folders: [], ignored: [] });
    const merged = mergeBackup({ items: {}, folders: [], ignored: [] }, backup);

    expect(merged.folders).toEqual(['舊分組', COMPLETED_FOLDER]);
  });
});

describe('describeBackupAge', () => {
  it('asks for a first backup, flagged only when there is something to lose', () => {
    expect(describeBackupAge(null, 3, NOW)).toEqual({ text: expect.stringContaining('尚未備份'), stale: true });
    expect(describeBackupAge(null, 0, NOW).stale).toBe(false);
  });

  it('reports the age and flags backups older than a week', () => {
    expect(describeBackupAge(NOW - 60_000, 3, NOW)).toEqual({ text: '上次備份：今天。', stale: false });
    expect(describeBackupAge(NOW - 6 * DAY, 3, NOW)).toEqual({ text: '上次備份：6 天前。', stale: false });
    expect(describeBackupAge(NOW - 7 * DAY, 3, NOW)).toEqual({ text: '上次備份：7 天前，建議重新匯出。', stale: true });
    expect(describeBackupAge(NOW - 30 * DAY, 0, NOW).stale).toBe(false);
  });
});

describe('backupFileName', () => {
  it('stamps the local date into the file name', () => {
    expect(backupFileName(new Date(2026, 0, 5, 12).getTime())).toBe('axure-bookmarks-backup-20260105.json');
  });
});
