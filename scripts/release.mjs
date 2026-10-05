// 進版：同步各處版號並依 Conventional Commits 產生 CHANGELOG 段落。
// 用法：npm run release [-- patch|minor|major|x.y.z] [--dry-run]
// 不指定類型時依自上次進版以來的 commit 推斷（feat → minor、其餘 → patch）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANGELOG_PATH,
  USER_FACING_TYPES,
  bumpVersion,
  changedSince,
  commitsSince,
  committedVersion,
  hasUncommittedChanges,
  inferBump,
  insertChangelogSection,
  lastReleaseCommit,
  readVersion,
  renderChangelogSection,
  writeVersion
} from './release-lib.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_HEADER = `# 更新紀錄

本檔記錄每個版本中使用者看得到的變更，由 \`npm run release\` 依 Conventional Commits 產生後再人工潤飾。
`;

function localDate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const requested = args.find((arg) => !arg.startsWith('--'));

  const currentVersion = readVersion(rootDir);
  const headVersion = committedVersion(rootDir);
  if (headVersion && headVersion !== currentVersion) {
    throw new Error(
      `已進版到 ${currentVersion}（HEAD 仍是 ${headVersion}）但尚未 commit。` +
        `請先 commit「chore(release): 進版至 ${currentVersion}」；若要重來，先還原版號與 CHANGELOG 再執行。`
    );
  }
  const base = lastReleaseCommit(rootDir);
  const commits = commitsSince(rootDir, base);

  if (commits.length === 0 && !requested) {
    console.log(`自 ${currentVersion} 以來沒有新的 commit，不需要進版。`);
    return;
  }

  const bump = requested ?? inferBump(commits, currentVersion);
  const nextVersion = bumpVersion(currentVersion, bump);
  const changelogFile = resolve(rootDir, CHANGELOG_PATH);
  const changelog = existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : CHANGELOG_HEADER;
  if (changelog.includes(`## [${nextVersion}]`)) {
    throw new Error(`${CHANGELOG_PATH} 已經有 ${nextVersion} 的段落`);
  }
  const section = renderChangelogSection(nextVersion, localDate(), commits);

  console.log(`版號：${currentVersion} → ${nextVersion}（${requested ? '指定' : `依 commit 推斷為 ${bump}`}）`);
  console.log(`納入 ${commits.length} 個 commit（自 ${base ? base.slice(0, 7) : '第一個 commit'} 之後）\n`);
  console.log(section);

  const warnings = [];
  if (hasUncommittedChanges(rootDir)) {
    warnings.push('工作目錄有未提交的變更，這些變更不會出現在 CHANGELOG。');
  }
  const userFacing = commits.some((commit) => commit.breaking || USER_FACING_TYPES.includes(commit.type));
  if (userFacing && base) {
    if (!changedSince(rootDir, base, 'README.md')) {
      warnings.push('有使用者可見的變更，但自上次進版後 README.md 沒有改動，請確認功能說明是否需要更新。');
    }
    if (!changedSince(rootDir, base, 'src/_locales')) {
      warnings.push('有使用者可見的變更，但外掛描述（src/_locales/*/messages.json 的 extensionDescription）沒有改動，請確認是否需要更新。');
    }
  }

  if (dryRun) {
    console.log('（--dry-run：沒有寫入任何檔案）');
  } else {
    const written = writeVersion(rootDir, nextVersion);
    writeFileSync(changelogFile, insertChangelogSection(changelog, section));
    written.push(CHANGELOG_PATH);
    console.log(`已更新：${written.join('、')}`);
  }

  for (const warning of warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  console.log(`
下一步：
  1. 潤飾 ${CHANGELOG_PATH}：寫給使用者看，合併重複條目、刪掉內部雜訊
  2. npm run lint && npm test
  3. git add package.json package-lock.json src/manifest.json ${CHANGELOG_PATH}
  4. git commit -m "chore(release): 進版至 ${nextVersion}"`);
}

try {
  main();
} catch (error) {
  console.error(`進版失敗：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
