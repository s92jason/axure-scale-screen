import { toNetscapeBookmarks } from '../shared/netscape';
import type { AxureBookmark, RuntimeMessage, RuntimeResponse, Settings } from '../shared/types';
import { toEntryUrl } from '../shared/url';

const FILTER_ALL = '__all__';
const FILTER_NONE = '__none__';
const UNGROUPED_LABEL = '未分組';

function must<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`找不到 UI 元件：${selector}`);
  }
  return el;
}

const searchEl = must<HTMLInputElement>('#search');
const folderFilterEl = must<HTMLSelectElement>('#folder');
const sortEl = must<HTMLSelectElement>('#sort');
const rowsEl = must<HTMLTableSectionElement>('#rows');
const emptyEl = must<HTMLParagraphElement>('#empty');
const ignoredListEl = must<HTMLUListElement>('#ignoredList');
const ignoredEmptyEl = must<HTMLParagraphElement>('#ignoredEmpty');
const exportEl = must<HTMLButtonElement>('#export');
const newFolderEl = must<HTMLInputElement>('#newFolder');
const addFolderEl = must<HTMLButtonElement>('#addFolder');
const folderListEl = must<HTMLUListElement>('#folderList');
const folderEmptyEl = must<HTMLParagraphElement>('#folderEmpty');
const promptModeEl = must<HTMLSelectElement>('#promptMode');
const syncSectionEl = must<HTMLDivElement>('#syncSection');
const syncEnabledEl = must<HTMLInputElement>('#syncEnabled');
const syncDetailEl = must<HTMLDivElement>('#syncDetail');
const syncLocationEl = must<HTMLElement>('#syncLocation');
const syncChangeEl = must<HTMLButtonElement>('#syncChange');
const syncPickerEl = must<HTMLDivElement>('#syncPicker');
const pickerPathEl = must<HTMLInputElement>('#pickerPath');
const pickerNewFolderEl = must<HTMLButtonElement>('#pickerNewFolder');
const pickerTreeEl = must<HTMLUListElement>('#pickerTree');
const pickerCancelEl = must<HTMLButtonElement>('#pickerCancel');
const pickerConfirmEl = must<HTMLButtonElement>('#pickerConfirm');
const syncNowEl = must<HTMLButtonElement>('#syncNow');
const syncNoteEl = must<HTMLParagraphElement>('#syncNote');

const SYNC_FOLDER_TITLE = 'Axure 書籤';

let bookmarks: AxureBookmark[] = [];
let ignored: string[] = [];
let folders: string[] = [];
let settings: Settings = { promptMode: 'card', chromeSync: { enabled: false, parentFolderId: null } };

// 資料夾選擇器狀態
interface FolderRow {
  id: string;
  title: string;
  depth: number;
  path: string;
}
let pickerRows: FolderRow[] = [];
let pickerSelectedId: string | null = null;

function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? '背景沒有回應' });
        return;
      }
      resolve(response);
    });
  });
}

function fmtDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

function actionButton(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant ? `act ${variant}` : 'act';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function applyView(): AxureBookmark[] {
  const keyword = searchEl.value.trim().toLowerCase();
  const filter = folderFilterEl.value || FILTER_ALL;
  const sort = sortEl.value;

  const filtered = bookmarks.filter((bm) => {
    const matchFolder =
      filter === FILTER_ALL ? true : filter === FILTER_NONE ? bm.folder === '' : bm.folder === filter;
    const matchKeyword =
      !keyword || bm.name.toLowerCase().includes(keyword) || bm.folder.toLowerCase().includes(keyword);
    return matchFolder && matchKeyword;
  });

  return [...filtered].sort((a, b) => {
    if (sort === 'name') {
      return a.name.localeCompare(b.name);
    }
    if (sort === 'count') {
      return b.visitCount - a.visitCount;
    }
    return (b.lastVisitedAt ?? b.createdAt) - (a.lastVisitedAt ?? a.createdAt);
  });
}

// 每列的分組下拉：未分組 + 受管分組 +（若書籤的舊分組不在清單內也補上，避免遺失）。
function folderSelect(bm: AxureBookmark): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'folder-select';

  const options = ['', ...folders];
  if (bm.folder && !options.includes(bm.folder)) {
    options.push(bm.folder);
  }

  for (const value of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value || UNGROUPED_LABEL;
    if (value === bm.folder) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }

  select.addEventListener('change', () => {
    void send({ type: 'BOOKMARK_SET_FOLDER', projectKey: bm.projectKey, folder: select.value }).then(load);
  });
  return select;
}

function rowFor(bm: AxureBookmark): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const tdName = document.createElement('td');
  const open = document.createElement('button');
  open.className = 'link';
  open.textContent = bm.name || bm.projectKey;
  open.title = bm.url;
  open.addEventListener('click', () => void openBookmark(bm));
  tdName.appendChild(open);

  const tdFolder = document.createElement('td');
  tdFolder.appendChild(folderSelect(bm));

  const tdLast = document.createElement('td');
  tdLast.textContent = fmtDate(bm.lastVisitedAt);

  const tdCount = document.createElement('td');
  tdCount.className = 'num';
  tdCount.textContent = String(bm.visitCount);

  const tdAct = document.createElement('td');
  tdAct.className = 'actions';
  tdAct.append(
    actionButton('改名', () => void renameBm(bm)),
    actionButton('忽略', () => void ignoreBm(bm)),
    actionButton('刪除', () => void deleteBm(bm), 'danger')
  );

  tr.append(tdName, tdFolder, tdLast, tdCount, tdAct);
  return tr;
}

function render(): void {
  emptyEl.hidden = bookmarks.length > 0;
  rowsEl.replaceChildren(...applyView().map(rowFor));
}

function renderFilterOptions(): void {
  const current = folderFilterEl.value || FILTER_ALL;
  folderFilterEl.replaceChildren();
  const add = (value: string, label: string): void => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    folderFilterEl.appendChild(opt);
  };
  add(FILTER_ALL, '全部分組');
  add(FILTER_NONE, UNGROUPED_LABEL);
  for (const folder of folders) {
    add(folder, folder);
  }
  const values = [FILTER_ALL, FILTER_NONE, ...folders];
  folderFilterEl.value = values.includes(current) ? current : FILTER_ALL;
}

function countIn(folder: string): number {
  return bookmarks.filter((bm) => bm.folder === folder).length;
}

function renderFolders(): void {
  folderEmptyEl.hidden = folders.length > 0;
  folderListEl.replaceChildren();
  for (const folder of folders) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = `${folder}（${countIn(folder)}）`;

    const actions = document.createElement('span');
    actions.append(
      actionButton('改名', () => void renameFolderUI(folder)),
      actionButton('刪除', () => void removeFolderUI(folder), 'danger')
    );

    li.append(label, actions);
    folderListEl.appendChild(li);
  }
}

async function load(): Promise<void> {
  const [all, ign, fld, set] = await Promise.all([
    send({ type: 'BOOKMARK_GET_ALL' }),
    send({ type: 'BOOKMARK_GET_IGNORED' }),
    send({ type: 'BOOKMARK_GET_FOLDERS' }),
    send({ type: 'SETTINGS_GET' })
  ]);
  bookmarks = all.ok && all.bookmarks ? all.bookmarks : [];
  ignored = ign.ok && ign.ignored ? ign.ignored : [];
  folders = fld.ok && fld.folders ? fld.folders : [];
  if (set.ok && set.settings) {
    settings = set.settings;
  }
  promptModeEl.value = settings.promptMode;
  renderFilterOptions();
  render();
  renderFolders();
  renderIgnored();
  await renderSync();
}

// ── Chrome 真實書籤同步 UI ──────────────────────────────
// Safari 永不支援 chrome.bookmarks（且 Chrome 未授權前也是 undefined，無法只靠它判斷），
// 改用 navigator.vendor 判斷瀏覽器：Safari 整塊隱藏。
function isSafari(): boolean {
  return /apple/i.test(navigator.vendor);
}

function bookmarksAvailable(): boolean {
  return typeof chrome.bookmarks !== 'undefined';
}

function requestBookmarksPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: ['bookmarks'] }, (granted) => resolve(Boolean(granted)));
  });
}

function getBookmarkTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve) => chrome.bookmarks.getTree((tree) => resolve(tree)));
}

function folderTitle(id: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.bookmarks.get(id, (nodes) => {
      void chrome.runtime.lastError;
      resolve(nodes?.[0]?.title || '(資料夾)');
    });
  });
}

// 預設同步位置：書籤列(取不到就退最上層第一個資料夾)。
async function defaultParentId(): Promise<string | null> {
  const tree = await getBookmarkTree();
  const roots = tree[0]?.children ?? [];
  const bar = roots.find((node) => (node as { folderType?: string }).folderType === 'bookmarks-bar');
  return (bar ?? roots[0])?.id ?? null;
}

async function updateLocationText(): Promise<void> {
  const parentId = settings.chromeSync.parentFolderId;
  if (!parentId) {
    syncLocationEl.textContent = '';
    return;
  }
  syncLocationEl.textContent = `${await folderTitle(parentId)} › ${SYNC_FOLDER_TITLE}`;
}

function getChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve) =>
    chrome.bookmarks.getChildren(id, (nodes) => {
      void chrome.runtime.lastError;
      resolve(nodes ?? []);
    })
  );
}

function createFolder(parentId: string, title: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  return new Promise((resolve) =>
    chrome.bookmarks.create({ parentId, title }, (node) => {
      void chrome.runtime.lastError;
      resolve(node ?? null);
    })
  );
}

// 把整棵書籤樹(只取資料夾)攤平成可點選的列，含完整路徑字串。
async function buildPickerRows(): Promise<void> {
  const tree = await getBookmarkTree();
  const rows: FolderRow[] = [];
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], depth: number, parentPath: string): void => {
    for (const node of nodes) {
      if (node.url) {
        continue;
      }
      if (node.id === '0') {
        if (node.children) {
          walk(node.children, 0, '');
        }
        continue;
      }
      const title = node.title || '(資料夾)';
      const path = parentPath ? `${parentPath}/${title}` : title;
      rows.push({ id: node.id, title, depth, path });
      if (node.children) {
        walk(node.children, depth + 1, path);
      }
    }
  };
  walk(tree, 0, '');
  pickerRows = rows;
}

function renderPickerTree(): void {
  pickerTreeEl.replaceChildren();
  for (const row of pickerRows) {
    const li = document.createElement('li');
    li.className = row.id === pickerSelectedId ? 'picker-row selected' : 'picker-row';
    li.style.paddingLeft = `${8 + row.depth * 16}px`;
    li.textContent = row.title;
    li.addEventListener('click', () => selectPickerFolder(row.id));
    pickerTreeEl.appendChild(li);
  }
}

function selectPickerFolder(id: string): void {
  pickerSelectedId = id;
  const row = pickerRows.find((r) => r.id === id);
  if (row) {
    pickerPathEl.value = row.path;
  }
  renderPickerTree();
}

// 解析路徑字串，逐段 find-or-create，回傳最末資料夾 id。
async function resolvePath(input: string): Promise<string | null> {
  const segments = input
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const tree = await getBookmarkTree();
  const roots = tree[0]?.children ?? [];
  let current = roots.find((node) => (node.title || '') === segments[0]) ?? null;
  let startIndex = 1;
  if (!current) {
    current = roots.find((node) => (node as { folderType?: string }).folderType === 'bookmarks-bar') ?? roots[0] ?? null;
    startIndex = 0;
  }
  if (!current) {
    return null;
  }

  for (let i = startIndex; i < segments.length; i++) {
    const children = await getChildren(current.id);
    let next = children.find((node) => !node.url && (node.title || '') === segments[i]) ?? null;
    if (!next) {
      next = await createFolder(current.id, segments[i]);
    }
    if (!next) {
      return null;
    }
    current = next;
  }
  return current.id;
}

async function openPicker(): Promise<void> {
  await buildPickerRows();
  pickerSelectedId = settings.chromeSync.parentFolderId ?? (await defaultParentId());
  const row = pickerRows.find((r) => r.id === pickerSelectedId);
  pickerPathEl.value = row?.path ?? '';
  renderPickerTree();
  syncPickerEl.hidden = false;
}

async function newFolderInPicker(): Promise<void> {
  const parentId = pickerSelectedId ?? (await defaultParentId());
  if (!parentId) {
    return;
  }
  const name = window.prompt('新資料夾名稱');
  if (!name || !name.trim()) {
    return;
  }
  const created = await createFolder(parentId, name.trim());
  await buildPickerRows();
  if (created) {
    selectPickerFolder(created.id);
  } else {
    renderPickerTree();
  }
}

async function applyPathInput(): Promise<void> {
  const id = await resolvePath(pickerPathEl.value);
  if (!id) {
    return;
  }
  await buildPickerRows();
  selectPickerFolder(id);
}

async function confirmPicker(): Promise<void> {
  let id = pickerSelectedId;
  const typed = pickerPathEl.value.trim();
  const selectedRow = pickerRows.find((r) => r.id === pickerSelectedId);
  // 若使用者改了路徑文字卻沒按 Enter，確定時再解析一次
  if (typed && (!selectedRow || selectedRow.path !== typed)) {
    id = await resolvePath(typed);
  }
  if (!id) {
    return;
  }
  settings = { ...settings, chromeSync: { ...settings.chromeSync, parentFolderId: id } };
  await send({ type: 'SETTINGS_SET', settings });
  await updateLocationText();
  syncPickerEl.hidden = true;
  await runSyncNow();
}

function setSyncStatus(text: string): void {
  syncNoteEl.textContent = text;
  syncNoteEl.hidden = false;
}

// 立即同步 + 狀態回饋：同步中 → 已同步 N 筆 · 時間 / 失敗原因。
async function runSyncNow(): Promise<void> {
  syncNowEl.disabled = true;
  setSyncStatus('同步中…');
  try {
    const response = await send({ type: 'SYNC_NOW' });
    if (response.ok) {
      setSyncStatus(`已同步 ${response.syncedCount ?? 0} 筆書籤 · ${new Date().toLocaleTimeString()}`);
    } else {
      setSyncStatus(`同步失敗：${response.error}`);
    }
  } finally {
    syncNowEl.disabled = false;
  }
}

async function renderSync(): Promise<void> {
  if (isSafari()) {
    syncSectionEl.hidden = true; // Safari 不支援，整塊不顯示
    return;
  }
  syncSectionEl.hidden = false;
  const enabled = settings.chromeSync.enabled && bookmarksAvailable();
  syncEnabledEl.checked = enabled;
  syncDetailEl.hidden = !enabled;
  syncPickerEl.hidden = true;
  syncNoteEl.hidden = true;
  if (enabled) {
    await updateLocationText();
  }
}

async function openBookmark(bm: AxureBookmark): Promise<void> {
  chrome.tabs.create({ url: toEntryUrl(bm.url) });
  await send({ type: 'BOOKMARK_RECORD_VISIT', projectKey: bm.projectKey });
  await load();
}

async function renameBm(bm: AxureBookmark): Promise<void> {
  const name = window.prompt('新名稱', bm.name);
  if (name && name.trim()) {
    await send({ type: 'BOOKMARK_RENAME', projectKey: bm.projectKey, name: name.trim() });
    await load();
  }
}

async function ignoreBm(bm: AxureBookmark): Promise<void> {
  if (window.confirm(`忽略「${bm.name || bm.projectKey}」？\n會從書籤移除，且之後在此專案不再跳出收藏提示。`)) {
    await send({ type: 'BOOKMARK_IGNORE', projectKey: bm.projectKey });
    await load();
  }
}

async function deleteBm(bm: AxureBookmark): Promise<void> {
  if (window.confirm(`刪除「${bm.name || bm.projectKey}」？`)) {
    await send({ type: 'BOOKMARK_REMOVE', projectKey: bm.projectKey });
    await load();
  }
}

async function addFolderUI(): Promise<void> {
  const name = newFolderEl.value.trim();
  if (!name) {
    return;
  }
  await send({ type: 'BOOKMARK_ADD_FOLDER', name });
  newFolderEl.value = '';
  await load();
}

async function renameFolderUI(folder: string): Promise<void> {
  const newName = window.prompt('分組新名稱', folder);
  if (newName && newName.trim() && newName.trim() !== folder) {
    await send({ type: 'BOOKMARK_RENAME_FOLDER', name: folder, newName: newName.trim() });
    await load();
  }
}

async function removeFolderUI(folder: string): Promise<void> {
  const n = countIn(folder);
  const note = n > 0 ? `\n該分組的 ${n} 筆書籤會退回「未分組」（不會刪除書籤）。` : '';
  if (window.confirm(`刪除分組「${folder}」？${note}`)) {
    await send({ type: 'BOOKMARK_REMOVE_FOLDER', name: folder });
    await load();
  }
}

function renderIgnored(): void {
  ignoredEmptyEl.hidden = ignored.length > 0;
  ignoredListEl.replaceChildren();
  for (const key of ignored) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = key;
    li.append(span, actionButton('復原', () => void restore(key)));
    ignoredListEl.appendChild(li);
  }
}

async function restore(projectKey: string): Promise<void> {
  await send({ type: 'BOOKMARK_UNIGNORE', projectKey });
  await load();
}

function exportBookmarks(): void {
  const blob = new Blob([toNetscapeBookmarks(bookmarks)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'axure-bookmarks.html';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

searchEl.addEventListener('input', render);
folderFilterEl.addEventListener('change', render);
sortEl.addEventListener('change', render);
exportEl.addEventListener('click', exportBookmarks);
addFolderEl.addEventListener('click', () => void addFolderUI());
newFolderEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void addFolderUI();
  }
});
promptModeEl.addEventListener('change', () => {
  settings = { ...settings, promptMode: promptModeEl.value === 'badge' ? 'badge' : 'card' };
  void send({ type: 'SETTINGS_SET', settings });
});

syncEnabledEl.addEventListener('change', () => void onToggleSync());
syncChangeEl.addEventListener('click', () => {
  if (syncPickerEl.hidden) {
    void openPicker();
  } else {
    syncPickerEl.hidden = true;
  }
});
pickerNewFolderEl.addEventListener('click', () => void newFolderInPicker());
pickerPathEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void applyPathInput();
  }
});
pickerCancelEl.addEventListener('click', () => {
  syncPickerEl.hidden = true;
});
pickerConfirmEl.addEventListener('click', () => void confirmPicker());
syncNowEl.addEventListener('click', () => void runSyncNow());

async function onToggleSync(): Promise<void> {
  if (!syncEnabledEl.checked) {
    settings = { ...settings, chromeSync: { ...settings.chromeSync, enabled: false } };
    await send({ type: 'SETTINGS_SET', settings });
    syncDetailEl.hidden = true;
    syncPickerEl.hidden = true;
    return;
  }

  const granted = await requestBookmarksPermission();
  if (!granted || !bookmarksAvailable()) {
    syncEnabledEl.checked = false;
    syncNoteEl.hidden = false;
    syncNoteEl.textContent = '需要書籤權限才能同步，請再試一次或到瀏覽器設定允許。';
    return;
  }

  // 預設同步到書籤列，使用者不必先挑資料夾就能用。
  const parentFolderId = settings.chromeSync.parentFolderId ?? (await defaultParentId());
  syncNoteEl.hidden = true;
  settings = { ...settings, chromeSync: { enabled: true, parentFolderId } };
  await send({ type: 'SETTINGS_SET', settings });
  syncDetailEl.hidden = false;
  await updateLocationText();
  await runSyncNow();
}

void load();
