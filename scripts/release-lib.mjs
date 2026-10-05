import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 版號的唯一來源是 src/manifest.json；package.json / package-lock.json 跟著同步，
// Xcode 專案（不進版）存在時也同步 MARKETING_VERSION，讓 Safari 設定顯示的版號一致。
export const MANIFEST_PATH = 'src/manifest.json';
export const CHANGELOG_PATH = 'CHANGELOG.md';
export const XCODE_PROJECT_PATH = 'safari-app/AxureScaleScreen/AxureScaleScreen.xcodeproj/project.pbxproj';

// 只有使用者看得到的類型寫進 CHANGELOG；其餘（docs、build、refactor、test…）視為內部調整。
const CHANGELOG_SECTIONS = [
  { type: 'feat', title: '新功能' },
  { type: 'fix', title: '修正' },
  { type: 'perf', title: '效能' }
];
export const USER_FACING_TYPES = CHANGELOG_SECTIONS.map((section) => section.type);

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function parseCommit(subject, body = '') {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject.trim());
  if (!match) {
    return null;
  }
  const [, type, scope, bang, description] = match;
  return {
    type,
    scope: scope ?? null,
    breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body),
    description
  };
}

// 0.x 階段不相容變更也只進 minor（semver 對 0.x 的慣例），1.0 之後才進 major。
export function inferBump(commits, currentVersion) {
  const major = Number(currentVersion.split('.')[0]);
  if (commits.some((commit) => commit.breaking)) {
    return major === 0 ? 'minor' : 'major';
  }
  if (commits.some((commit) => commit.type === 'feat')) {
    return 'minor';
  }
  return 'patch';
}

export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

export function bumpVersion(version, bump) {
  if (VERSION_PATTERN.test(bump)) {
    if (compareVersions(bump, version) <= 0) {
      throw new Error(`指定的版號 ${bump} 必須大於目前的 ${version}`);
    }
    return bump;
  }
  const [major, minor, patch] = version.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`不支援的進版類型：${bump}（可用 patch / minor / major / x.y.z）`);
  }
}

function formatEntry(commit) {
  return commit.scope ? `- **${commit.scope}**：${commit.description}` : `- ${commit.description}`;
}

export function renderChangelogSection(version, date, commits) {
  const lines = [`## [${version}] - ${date}`, ''];
  const breaking = commits.filter((commit) => commit.breaking);
  if (breaking.length > 0) {
    lines.push('### 不相容變更', '', ...breaking.map(formatEntry), '');
  }
  let hasUserFacing = breaking.length > 0;
  for (const section of CHANGELOG_SECTIONS) {
    const entries = commits.filter((commit) => commit.type === section.type && !commit.breaking);
    if (entries.length === 0) {
      continue;
    }
    hasUserFacing = true;
    lines.push(`### ${section.title}`, '', ...entries.map(formatEntry), '');
  }
  if (!hasUserFacing) {
    lines.push('- 內部調整（建置、文件或重構），沒有使用者可見的變更。', '');
  }
  return lines.join('\n');
}

// 新段落插在第一個版本標題之前，檔頭說明保持在最上面。
export function insertChangelogSection(changelog, section) {
  const index = changelog.search(/^## \[/m);
  if (index === -1) {
    return `${changelog.trimEnd()}\n\n${section}`;
  }
  return `${changelog.slice(0, index)}${section}\n${changelog.slice(index)}`;
}

export function readVersion(rootDir) {
  return JSON.parse(readFileSync(resolve(rootDir, MANIFEST_PATH), 'utf8')).version;
}

function git(rootDir, args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// HEAD 上的版號；和工作目錄不同代表已進版但還沒 commit，再跑一次會重複進版。
export function committedVersion(rootDir) {
  try {
    return JSON.parse(git(rootDir, ['show', `HEAD:${MANIFEST_PATH}`])).version;
  } catch {
    return null;
  }
}

// 上次進版 = 最後一個改動 manifest 版號的 commit，不依賴 tag（tag 容易忘了推）。
export function lastReleaseCommit(rootDir) {
  return git(rootDir, ['log', '-1', '--format=%H', '-G"version"', '--', MANIFEST_PATH]).trim() || null;
}

export function commitsSince(rootDir, ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  return git(rootDir, ['log', '--no-merges', '--format=%h%x1f%s%x1f%b%x1e', range])
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');
      const parsed = parseCommit(subject, body);
      return parsed ? { hash, subject, ...parsed } : null;
    })
    .filter((commit) => commit && !(commit.type === 'chore' && commit.scope === 'release'))
    .reverse();
}

// 給 build 用的提醒：自上次進版後有多少使用者可見的 commit 尚未進版；沒有 git（例如隔離副本）時回 null。
export function pendingRelease(rootDir) {
  try {
    const commits = commitsSince(rootDir, lastReleaseCommit(rootDir));
    const userFacing = commits.filter((commit) => commit.breaking || USER_FACING_TYPES.includes(commit.type));
    return { version: readVersion(rootDir), count: userFacing.length };
  } catch {
    return null;
  }
}

export function changedSince(rootDir, ref, path) {
  try {
    git(rootDir, ['diff', '--quiet', ref, '--', path]);
    return false;
  } catch {
    return true;
  }
}

export function hasUncommittedChanges(rootDir) {
  return git(rootDir, ['status', '--porcelain']).trim().length > 0;
}

function replaceFirstVersion(rootDir, path, version) {
  const file = resolve(rootDir, path);
  const content = readFileSync(file, 'utf8');
  const next = content.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  writeFileSync(file, next);
}

export function writeVersion(rootDir, version) {
  const written = [MANIFEST_PATH, 'package.json'];
  // 用字串替換保留 manifest 的手排格式（例如單行的 suggested_key 物件）。
  for (const path of written) {
    replaceFirstVersion(rootDir, path, version);
  }

  const lockFile = resolve(rootDir, 'package-lock.json');
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages?.['']) {
      lock.packages[''].version = version;
    }
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    written.push('package-lock.json');
  }

  const xcodeProject = resolve(rootDir, XCODE_PROJECT_PATH);
  if (existsSync(xcodeProject)) {
    const content = readFileSync(xcodeProject, 'utf8');
    const next = content.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
    if (next !== content) {
      writeFileSync(xcodeProject, next);
      written.push(XCODE_PROJECT_PATH);
    }
  }
  return written;
}
