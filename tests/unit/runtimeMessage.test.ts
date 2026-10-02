import { describe, expect, it } from 'vitest';
import { isRuntimeMessage } from '../../src/shared/types';

describe('isRuntimeMessage', () => {
  it('accepts zoom messages', () => {
    expect(isRuntimeMessage({ type: 'GET_ZOOM', urlKey: 'k' })).toBe(true);
    expect(isRuntimeMessage({ type: 'SET_ZOOM', urlKey: 'k', zoom: 110 })).toBe(true);
    expect(isRuntimeMessage({ type: 'SET_ZOOM', urlKey: 'k' })).toBe(false);
  });

  it('accepts bookmark messages with required fields', () => {
    expect(isRuntimeMessage({ type: 'BOOKMARK_GET_ALL' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_DETECTED' })).toBe(true);
    expect(
      isRuntimeMessage({ type: 'BOOKMARK_ADD', projectKey: 'axshare:a', name: 'n', url: 'u' })
    ).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_REMOVE', projectKey: 'axshare:a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RECORD_VISIT', projectKey: 'axshare:a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_IGNORE', projectKey: 'axshare:a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_GET_IGNORED' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_UNIGNORE', projectKey: 'axshare:a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RENAME', projectKey: 'a', name: 'n' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_SET_FOLDER', projectKey: 'a', folder: '' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_GET_FOLDERS' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_ADD_FOLDER', name: 'WIP' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RENAME_FOLDER', name: 'a', newName: 'b' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_REMOVE_FOLDER', name: 'a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'SETTINGS_GET' })).toBe(true);
    expect(
      isRuntimeMessage({ type: 'SETTINGS_SET', settings: { promptMode: 'badge', chromeSync: { enabled: false, parentFolderId: null } } })
    ).toBe(true);
    expect(isRuntimeMessage({ type: 'SYNC_NOW' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_IMPORT', backup: { format: 'axure-scale-screen-backup' } })).toBe(true);
  });

  it('rejects import messages without a backup object', () => {
    expect(isRuntimeMessage({ type: 'BOOKMARK_IMPORT' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_IMPORT', backup: null })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_IMPORT', backup: '{}' })).toBe(false);
  });

  it('rejects bookmark messages missing required fields', () => {
    expect(isRuntimeMessage({ type: 'BOOKMARK_ADD', name: 'n', url: 'u' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_REMOVE' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_IGNORE' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RENAME', projectKey: 'a' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_SET_FOLDER', projectKey: 'a' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_ADD_FOLDER' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RENAME_FOLDER', name: 'a' })).toBe(false);
    expect(isRuntimeMessage({ type: 'SETTINGS_SET' })).toBe(false);
    expect(isRuntimeMessage({ type: 'NOPE' })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
  });

  it('accepts completed-tab queries and valid tab IDs', () => {
    expect(isRuntimeMessage({ type: 'AXURE_GET_COMPLETED_TABS' })).toBe(true);
    expect(isRuntimeMessage({ type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: [0, 7, 12] })).toBe(true);
    expect(isRuntimeMessage({ type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: [] })).toBe(true);
  });

  it('rejects missing tab IDs and unsafe values before tabs can be closed', () => {
    expect(isRuntimeMessage({ type: 'AXURE_CLOSE_COMPLETED_TABS' })).toBe(false);
    expect(isRuntimeMessage({ type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: '7' })).toBe(false);
    for (const id of [-1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '7', null]) {
      expect(isRuntimeMessage({ type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: [id] })).toBe(false);
    }
  });
});
