// 專案去重 key 正規化。
// 與 toUrlKey 不同：toUrlKey 是「逐頁」(origin+pathname)用於 zoom 狀態；
// projectKey 是「逐專案」用於書籤去重，刻意忽略頁面 hash(#p=)與查詢字串。
//
// file:// 目前以資料夾根路徑當 fallback key；搬移資料夾會得到新 key。
// 這正是 plan 附錄 B.5/P0-4 要用「穩定 ID」取代的部分——屆時由
// resolveFileProjectKey() 之類的解析器覆寫，本檔的純 URL 版維持為退路。

export type ProjectKey = string;

const AXSHARE_SUFFIX = /\.axshare\.com$/i;
const AXURE_CLOUD_SUFFIX = /\.axure\.cloud$/i;
const NON_PROJECT_LABELS = new Set(['www', 'app', 'share', 'account', 'my', 'login']);

function firstLabel(host: string, suffix: RegExp): string | null {
  const base = host.replace(suffix, '');
  if (base === host || base.length === 0) {
    return null;
  }

  const label = base.split('.')[0];
  if (!label || NON_PROJECT_LABELS.has(label)) {
    return null;
  }

  return label;
}

function fileFolderRoot(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  // 去掉結尾的 xxx.html / xxx.htm；index.html 與 start.html 因而與所在資料夾同根。
  const withoutFile = decoded.replace(/\/[^/]*\.html?$/i, '');
  const trimmed = withoutFile.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

export function toProjectKey(rawUrl: string): ProjectKey | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol === 'file:') {
    return `file:${fileFolderRoot(parsed.pathname)}`;
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const host = parsed.hostname.toLowerCase();

    if (AXSHARE_SUFFIX.test(host)) {
      const id = firstLabel(host, AXSHARE_SUFFIX);
      return id ? `axshare:${id}` : null;
    }

    if (AXURE_CLOUD_SUFFIX.test(host)) {
      // 優先以路徑 /app/project/{id} 辨識；否則退回子網域 label。
      const match = parsed.pathname.match(/\/app\/project\/([^/]+)/i);
      if (match) {
        return `axurecloud:${match[1]}`;
      }

      const id = firstLabel(host, AXURE_CLOUD_SUFFIX);
      return id ? `axurecloud:${id}` : null;
    }
  }

  return null;
}
