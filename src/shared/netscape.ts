import type { AxureBookmark } from './types';

// 產生 Netscape Bookmark File 格式(各家瀏覽器「匯入書籤」皆吃這個格式)。
// 這是 Safari 端把書籤寫進「真實書籤」的唯一正規途徑。

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char
  );
}

export function toNetscapeBookmarks(bookmarks: AxureBookmark[]): string {
  const groups = new Map<string, AxureBookmark[]>();
  for (const bm of bookmarks) {
    const folder = bm.folder || '';
    const arr = groups.get(folder) ?? [];
    arr.push(bm);
    groups.set(folder, arr);
  }

  const line = (bm: AxureBookmark, indent: string): string =>
    `${indent}<DT><A HREF="${escapeHtml(bm.url)}" ADD_DATE="${Math.floor(bm.createdAt / 1000)}">` +
    `${escapeHtml(bm.name || bm.projectKey)}</A>\n`;

  let body = '';
  for (const bm of groups.get('') ?? []) {
    body += line(bm, '    ');
  }
  for (const [folder, items] of groups) {
    if (!folder) {
      continue;
    }
    body += `    <DT><H3>${escapeHtml(folder)}</H3>\n    <DL><p>\n`;
    for (const bm of items) {
      body += line(bm, '        ');
    }
    body += '    </DL><p>\n';
  }

  return (
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n' +
    '<H1>Axure Bookmarks</H1>\n' +
    '<DL><p>\n' +
    body +
    '</DL><p>\n'
  );
}
