---
name: release
description: 開發完成後的收尾：同步 README、外掛描述等文件，依 Conventional Commits 進版號並產生 CHANGELOG。當使用者說「進版」「發版」「release」「收尾」「準備開 PR」「這個功能做完了」，或一個 feat/fix 完成、準備合併前使用。
---

# 開發收尾：文件 → 進版 → 驗證

每次功能或修正完成、開 PR 之前都要跑一次。版號、CHANGELOG、文件必須和程式一起進同一個 PR。

## 1. 看範圍

```bash
npm run release -- --dry-run
```

列出自上次進版以來的 commit、推斷的版號（feat → minor、其餘 → patch；0.x 的不相容變更也是 minor）與 CHANGELOG 草稿，不寫檔。
沒有使用者可見的 commit（只有 docs / build / refactor / test）時，問使用者要不要進 patch 或留給下次一起進。

## 2. 更新文件（先做，獨立一個 `docs(...)` commit）

逐一對照每個 feat / fix，確認：

- **README.md**：開頭介紹、〈功能〉段落、〈使用方式〉、Safari 手動回歸步驟是否反映新行為；移除已不正確的描述。
- **外掛描述**：`src/_locales/zh_TW/messages.json` 與 `src/_locales/en/messages.json` 的 `extensionDescription`。
  - 只在主打功能改變時更新；中英文意思要對齊。
  - Chrome Web Store 上限 132 字元（`tests/unit/release.test.ts` 會擋）。
- **manifest 的使用者可見字串**：`commands.*.description`、`action.default_title` 等。
- **AGENTS.md / CLAUDE.md**：結構、指令或流程有變時才改。
- UI 有變時，`docs/screenshots/` 是否需要新截圖（請使用者提供，不要自己編）。

i18n 一律改 `src/`，不要改 `dist/`。

改完**先 commit 再進版**（腳本只讀已 commit 的歷史，且 manifest 的版號變更不能混進 docs commit）：

```bash
git add README.md src/_locales src/manifest.json   # 依實際改動
git commit -m "docs(extension): 更新說明與外掛描述"
```

## 3. 進版（獨立一個 `chore(release)` commit）

```bash
npm run release              # 依 commit 推斷
npm run release -- minor     # 或指定 patch / minor / major / x.y.z
```

腳本會同步 `src/manifest.json`、`package.json`、`package-lock.json`，存在 Xcode 專案時也改 `MARKETING_VERSION`（`safari-app/` 不進版），並在 `CHANGELOG.md` 最上方加入新段落。

接著**潤飾 CHANGELOG**：寫給使用者看的繁體中文，合併同一功能的多個條目、把技術描述改成使用者語言、刪掉內部雜訊。腳本對 README / 描述沒改動的警告要逐一確認處理。

## 4. 驗證

```bash
npm run lint
npm test
```

依 CLAUDE.md：在沙盒裡 `npm test` 要在隔離副本跑。

## 5. Commit

```bash
git add package.json package-lock.json src/manifest.json CHANGELOG.md
git commit -m "chore(release): 進版至 X.Y.Z"
```

在沙盒裡依 CLAUDE.md〈進版流程〉把 git 指令交給使用者在 Mac 上執行。

## 注意

- 並行的 PR 會在版號上衝突：合併前 rebase 到最新 master，捨棄自己的版號變更後重跑 `npm run release`。
- 不要用 `xcodebuild` 驗證 Safari 專案，也不要重新產生 `safari-app/`（會清除外掛資料）。
