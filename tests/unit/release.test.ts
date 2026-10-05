import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  inferBump,
  insertChangelogSection,
  parseCommit,
  renderChangelogSection,
  type ParsedCommit
} from '../../scripts/release-lib.mjs';

const rootDir = resolve(__dirname, '../..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'));

const commit = (overrides: Partial<ParsedCommit>): ParsedCommit => ({
  type: 'fix',
  scope: null,
  breaking: false,
  description: '描述',
  ...overrides
});

describe('release metadata', () => {
  const manifest = readJson('src/manifest.json');

  it('keeps every version field in sync with the manifest', () => {
    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    expect(pkg.version).toBe(manifest.version);
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].version).toBe(manifest.version);
  });

  it('has a CHANGELOG entry for the current version at the top', () => {
    const changelog = readFileSync(resolve(rootDir, 'CHANGELOG.md'), 'utf8');
    expect(/^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1]).toBe(manifest.version);
  });

  it('keeps locale files aligned and within Chrome Web Store limits', () => {
    const zh = readJson('src/_locales/zh_TW/messages.json');
    const en = readJson('src/_locales/en/messages.json');
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const messages of [zh, en]) {
      expect(messages.extensionName.message.length).toBeLessThanOrEqual(75);
      expect(messages.extensionDescription.message.length).toBeLessThanOrEqual(132);
    }
    expect(manifest.description).toBe('__MSG_extensionDescription__');
  });
});

describe('parseCommit', () => {
  it('parses type, scope and description', () => {
    expect(parseCommit('feat(zoom): 縮放上限提高到 400%')).toEqual({
      type: 'feat',
      scope: 'zoom',
      breaking: false,
      description: '縮放上限提高到 400%'
    });
  });

  it('detects breaking changes from ! or the footer', () => {
    expect(parseCommit('feat!: 移除舊設定')?.breaking).toBe(true);
    expect(parseCommit('fix(store): 改格式', 'BREAKING CHANGE: 舊資料需重新匯入')?.breaking).toBe(true);
  });

  it('ignores non-conventional subjects', () => {
    expect(parseCommit('Merge pull request #8 from s92jason/branch')).toBeNull();
  });
});

describe('inferBump / bumpVersion', () => {
  it('bumps minor for features and patch otherwise', () => {
    expect(inferBump([commit({ type: 'fix' }), commit({ type: 'feat' })], '0.3.0')).toBe('minor');
    expect(inferBump([commit({ type: 'fix' }), commit({ type: 'docs' })], '0.3.0')).toBe('patch');
  });

  it('keeps breaking changes at minor before 1.0', () => {
    expect(inferBump([commit({ breaking: true })], '0.3.0')).toBe('minor');
    expect(inferBump([commit({ breaking: true })], '1.2.0')).toBe('major');
  });

  it('computes the next version and rejects downgrades', () => {
    expect(bumpVersion('0.3.4', 'patch')).toBe('0.3.5');
    expect(bumpVersion('0.3.4', 'minor')).toBe('0.4.0');
    expect(bumpVersion('0.3.4', 'major')).toBe('1.0.0');
    expect(bumpVersion('0.3.4', '0.10.0')).toBe('0.10.0');
    expect(() => bumpVersion('0.3.4', '0.3.4')).toThrow();
    expect(() => bumpVersion('0.3.4', 'huge')).toThrow();
  });
});

describe('changelog rendering', () => {
  it('groups user-facing commits and skips internal ones', () => {
    const section = renderChangelogSection('0.4.0', '2026-10-05', [
      commit({ type: 'feat', scope: 'bookmarks', description: '新增備份' }),
      commit({ type: 'fix', description: '修正高度' }),
      commit({ type: 'build', description: '調整建置' })
    ]);
    expect(section).toBe(
      ['## [0.4.0] - 2026-10-05', '', '### 新功能', '', '- **bookmarks**：新增備份', '', '### 修正', '', '- 修正高度', ''].join(
        '\n'
      )
    );
  });

  it('notes internal-only releases', () => {
    expect(renderChangelogSection('0.3.1', '2026-10-05', [commit({ type: 'docs' })])).toContain('沒有使用者可見的變更');
  });

  it('inserts the newest section above older ones', () => {
    const changelog = '# 更新紀錄\n\n說明\n\n## [0.3.0] - 2026-10-01\n\n- 舊\n';
    expect(insertChangelogSection(changelog, '## [0.4.0] - 2026-10-05\n\n- 新\n')).toBe(
      '# 更新紀錄\n\n說明\n\n## [0.4.0] - 2026-10-05\n\n- 新\n\n## [0.3.0] - 2026-10-01\n\n- 舊\n'
    );
  });
});
