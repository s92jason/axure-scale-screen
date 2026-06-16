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
    expect(
      isRuntimeMessage({ type: 'BOOKMARK_ADD', projectKey: 'axshare:a', name: 'n', url: 'u' })
    ).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_REMOVE', projectKey: 'axshare:a' })).toBe(true);
    expect(isRuntimeMessage({ type: 'BOOKMARK_RECORD_VISIT', projectKey: 'axshare:a' })).toBe(true);
  });

  it('rejects bookmark messages missing required fields', () => {
    expect(isRuntimeMessage({ type: 'BOOKMARK_ADD', name: 'n', url: 'u' })).toBe(false);
    expect(isRuntimeMessage({ type: 'BOOKMARK_REMOVE' })).toBe(false);
    expect(isRuntimeMessage({ type: 'NOPE' })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
  });
});
