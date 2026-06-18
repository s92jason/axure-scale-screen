export function toUrlKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

// 書籤要「重新開啟整個原型」用的進入點 URL。
// Axure 的頁面指標放在 hash(#id=/#p=/&g=)，PM 重新發佈後 hash 可能變動，
// 但網域與路徑(進入點)穩定。因此去掉 hash、保留 origin+pathname+query
// (query 可能含 access code，刻意保留)。file:// 也安全(URL.toString 會還原)。
export function toEntryUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
