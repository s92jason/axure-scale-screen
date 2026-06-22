# Repository Guidelines（儲存庫指南）

## 專案結構與模組規劃
本專案目前以 Safari Web Extension 為主，請維持下列結構：
- `src/`：外掛主要程式碼（`background`、`content`、`popup`、`shared`）
- `tests/`：測試程式（`unit`、`integration`）
- `scripts/`：開發與部署輔助腳本
- `dist/`：建置輸出（由 Vite 產生，不手動編輯）

新增功能時優先採「按功能分層」，避免把 UI、儲存與縮放邏輯混在同一檔案。

## 建置、測試與開發指令
- `npm run dev`：監看模式建置
- `npm run build`：正式建置並輸出 `dist/manifest.json`
- `npm test`：執行 Vitest 測試
- `npm run lint`：以 TypeScript 檢查型別

常見流程：
```bash
npm install
npm run build
npm test
```

## 程式風格與命名規範
- 縮排統一 2 個空白（TS/JSON/Markdown）。
- 變數與函式使用 `camelCase`。
- 型別與介面使用 `PascalCase`。
- 檔名使用 `kebab-case`（例如：`axure-zoom.ts`）。
- 共用常數與型別放在 `src/shared/`，避免重複定義。

## 測試指南
- 測試框架：Vitest + jsdom。
- 單元測試放在 `tests/unit/`，整合測試放在 `tests/integration/`。
- 檔名使用 `*.test.ts`。
- 新功能至少涵蓋：倍率邊界、URL key 正規化、縮放套用/重置流程。

## Commit 與 PR 規範
- Commit 採**帶 scope 的** Conventional Commits：
  - `feat(zoom): 新增 Axure 縮放快捷鍵`
  - `fix(popup): 修正重置後倍率未同步`
- PR 請附：
  - 變更摘要與動機
  - 測試結果（指令與輸出）
  - UI 變更截圖或錄影
  - 已知限制與回歸風險

## 安全與設定建議
- 不可提交憑證、Token、簽章檔與本機設定。
- Safari 簽章與 Bundle ID 請使用本機或 CI 安全憑證管理。
- 若調整權限（manifest permissions），PR 必須說明必要性與風險。
