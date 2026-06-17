import { describe, expect, it } from 'vitest';
import { planSync } from '../../src/shared/syncPlan';
import type { AxureBookmark } from '../../src/shared/types';

function bm(partial: Partial<AxureBookmark>): AxureBookmark {
  return {
    projectKey: 'axshare:a',
    url: 'https://a.axshare.com/',
    name: 'Demo',
    folder: '',
    createdAt: 1,
    lastVisitedAt: null,
    visitCount: 0,
    ...partial
  };
}

describe('planSync', () => {
  it('separates ungrouped from grouped', () => {
    const plan = planSync([
      bm({ name: 'Top', folder: '' }),
      bm({ name: 'A', folder: '進行中' }),
      bm({ name: 'B', folder: '進行中' }),
      bm({ name: 'C', folder: '已完成' })
    ]);
    expect(plan.ungrouped.map((b) => b.name)).toEqual(['Top']);
    expect(plan.groups).toHaveLength(2);
    const wip = plan.groups.find((g) => g.name === '進行中');
    expect(wip?.items.map((b) => b.name)).toEqual(['A', 'B']);
  });

  it('returns empty structure for no bookmarks', () => {
    const plan = planSync([]);
    expect(plan.ungrouped).toEqual([]);
    expect(plan.groups).toEqual([]);
  });
});
