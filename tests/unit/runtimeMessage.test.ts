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
});
