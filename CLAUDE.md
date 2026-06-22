# CLAUDE.md — AI 代理操作守則

本檔補充 `AGENTS.md`（專案結構、程式風格、PR 規範請見該檔），專注於「AI 代理在**沙盒 / 掛載環境**中操作本 repo 時的陷阱」與**進版流程**。

## 核心原則

> 沙盒（Linux）對這個 repo 的存取是「掛載」使用者 macOS 上的**實體目錄**。任何在沙盒裡對掛載目錄的**寫入/安裝/刪除**，都會直接改到使用者本機的真實檔案，且常因**跨平台**或**檔案系統限制**造成破壞。預設：沙盒只用來「讀取、型別檢查、在隔離副本中驗證」，**會改動狀態的指令一律交給使用者在 Mac 上執行**。

## ⚠️ 環境陷阱（務必遵守）

### 1. 不要對掛載的 `node_modules` 跑套件安裝
- `node_modules` 是使用者 **macOS（darwin-arm64）** 的實體目錄，共用給 Linux 沙盒。
- 在沙盒（Linux）跑 `npm install` / `npm ci` / `npm install <pkg>` 會讓 npm 以 **Linux 平台**重新對齊依賴樹，**剪掉 macOS 專用的原生二進位**（典型：`@rollup/rollup-darwin-arm64`），導致使用者本機 `npm run build` 壞掉：
  `Error: Cannot find module @rollup/rollup-darwin-arm64`
- **規則：永遠不要在沙盒對掛載的 `node_modules` 執行任何會寫入的套件管理指令。**
- 已不慎發生時的修法（請使用者在 Mac 上跑）：`npm ci`（或 `rm -rf node_modules && npm install`）即可還原平台正確的二進位。

### 2. 要驗證 build / test 時，用隔離副本
- 需要跑 `npm run build` 或 `vitest` 時：把 repo 複製到暫存目錄（如 `/tmp/build-check`），在該目錄做**獨立的** `npm install`（產生自己的 `node_modules`）。
- **不要** symlink 或重用掛載的 `node_modules` 再 `npm install`——`install` 會穿透 symlink 寫回實體目錄，等同陷阱 1。
- 只「執行」而不安裝（例如 `node scripts/build.mjs`）時，唯讀使用 symlink 的 node_modules 沒問題；只要牽涉 `install` 就必須完全隔離。
- 型別檢查 `npx tsc --noEmit`（等同 `npm run lint`）不需要平台二進位，可直接在沙盒跑，是最安全的快速驗證。
- 反之，`npm test`（vitest）會載入依賴、需要平台正確的二進位，**同樣須在隔離副本中跑**，不要直接對掛載環境執行。

### 3. 掛載的 `.git` 是 append-only（可新增、不可刪除）
- 沙盒對 `.git/` 的 `unlink`（刪檔）被擋，但 `rename`（同目錄置換）可行。後果：
  - `git status` 等指令刷新 index 時建立的 `.git/index.lock` 會卡住、清不掉，後續 git 報「Another git process seems to be running」。
  - 一般 `git add` / `git commit` 會留下無法刪除的 `*.lock`，造成第二次操作卡死。
  - `git status` 可能因 index 過期，把**已 commit 的變更**誤報成「未提交」。
- **規則：預設把 git 寫入指令交給使用者在 Mac 上執行**（見〈進版流程〉）。

## 進版流程（commit / push）

### 慣例
> 基本 commit / PR 規範見 `AGENTS.md`；本節**收斂/覆蓋**其格式為「**帶 scope** 的 Conventional Commits」，其餘以下列沙盒進版注意事項為主。

- Commit 採**帶 scope 的 Conventional Commits**，描述用**繁體中文**（對齊現有歷史）：
  - `feat(zoom): 縮放上限提高到 400%`
  - `fix(popup): 狀態列文字隨快捷鍵同步`
- **一個邏輯變更一個 commit**（atomic）；安全性修補與功能分開。
- 變更 manifest permissions 的 commit，訊息須說明必要性與風險。

### 標準流程（使用者在 Mac 上執行）
```bash
git status                       # 確認改動
git add <files>                  # 依邏輯分組
git commit -m "type(scope): 中文描述"
git push                         # commit 只是本地，記得推送
npm run build                    # 若改到建置來源，重生 dist（dist 已 gitignore，不進版）
```

### 清掉沙盒殘留的 lock（git 卡住時；使用者在 Mac 上執行）
> 沙盒無法 unlink，以下 `rm` 必須由使用者在 Mac 上跑，不要在沙盒照貼。
```bash
rm -f .git/*.lock .git/objects/maintenance.lock
find .git/objects -name 'tmp_obj_*' -delete
git reset        # 用 HEAD 重新整理 index（不動工作目錄）
git status       # 應顯示 working tree clean
```

### 若 AI 代理被要求「直接在沙盒 commit」
1. **預設改為產生指令請使用者執行**，不要硬幹。
2. 真要從沙盒提交，只能用 plumbing 繞過 lock：
   - `GIT_INDEX_FILE=/tmp/idx git read-tree HEAD`（用暫存 index，避開卡住的 `.git/index.lock`）
   - `git add` → `git write-tree` → `git commit-tree <tree> -p HEAD -m "..."` 取得新 commit sha
   - 以**同目錄 rename** 更新 ref：`printf '%s\n' <sha> > .git/refs/heads/__tmp && mv .git/refs/heads/__tmp .git/refs/heads/master`（rename-replace 在掛載上可行，unlink 不行）
   - 完成後**務必告知使用者**：清理殘留 `*.lock`、`git reset` 刷新 index，且 commit 尚未 push。

## 建置 / 產物備忘
- `npm run build`（= `node scripts/build.mjs`）：跑三次 `vite build`——HTML 多入口（popup / sidepanel / options）+ background、content 各自獨立的 library build → 產出 `dist/`，並複製 `src/manifest.json`、`src/icons`、`src/_locales`。
- **i18n 的 source of truth 在 `src/`**：`src/_locales/{zh_TW,en}/messages.json` 與 `src/manifest.json`（`__MSG_*__` + `default_locale`）。改 i18n 一律改 `src/`，不要只改 `dist/`。
- `dist/` 不進版（gitignore），必須能由 `npm run build` 完整重現；改 `src/` 後記得重生。
- `safari-app/`（Safari 轉檔產物）不進版；`packages/` 是未追蹤的舊化石樹，與建置無關。
