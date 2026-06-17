import { toNetscapeBookmarks } from '../shared/netscape';
import type { AxureBookmark, RuntimeMessage, RuntimeResponse } from '../shared/types';

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

let bookmarks: AxureBookmark[] = [];
let ignored: string[] = [];
let folders: string[] = [];

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
  const [all, ign, fld] = await Promise.all([
    send({ type: 'BOOKMARK_GET_ALL' }),
    send({ type: 'BOOKMARK_GET_IGNORED' }),
    send({ type: 'BOOKMARK_GET_FOLDERS' })
  ]);
  bookmarks = all.ok && all.bookmarks ? all.bookmarks : [];
  ignored = ign.ok && ign.ignored ? ign.ignored : [];
  folders = fld.ok && fld.folders ? fld.folders : [];
  renderFilterOptions();
  render();
  renderFolders();
  renderIgnored();
}

async function openBookmark(bm: AxureBookmark): Promise<void> {
  chrome.tabs.create({ url: bm.url });
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

void load();
