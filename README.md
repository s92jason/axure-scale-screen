# Axure Scale Screen（Safari Web Extension）

這是一個針對 Safari 的 Axure 縮放外掛，提供滑桿、快捷鍵與一鍵重置，讓瀏覽原型文件更容易。

## 功能
- 縮放範圍：`50%` 到 `200%`（`10%` 步進）
- 控制方式：popup 滑桿、`+/-` 按鈕、`Reset`
- 快捷鍵：`Cmd/Ctrl +`、`Cmd/Ctrl -`、`Cmd/Ctrl 0`
- 備援快捷鍵（Safari 相容）：`Option + Shift + ↑`、`Option + Shift + ↓`、`Option + Shift + 0`
- 可在 Safari 擴充功能設定頁自訂 `zoom-in / zoom-out / zoom-reset` 三個快捷鍵
- 偏好儲存：依 `origin + pathname` 記住每頁倍率

## 技術堆疊
- TypeScript
- Vite（建置）
- Vitest + jsdom（測試）

## 本機開發
```bash
npm install
npm run build
```

建置輸出位於 `dist/`。

## 在 Safari 執行（macOS 14+ / Safari 17+）
1. 先建置 extension：
   ```bash
   npm run build
   ```
2. 轉換成 Safari App 專案：
   ```bash
   ./scripts/convert-to-safari-app.sh AxureScaleScreen com.example.axurescalescreen safari-app
   ```
3. 用 Xcode 開啟 `safari-app/AxureScaleScreen.xcodeproj`。
4. 設定 Signing Team 與唯一 Bundle ID。
5. 執行一次 App，然後到 Safari 設定中啟用外掛。
6. 若要在本機 `file://` Axure 匯出檔使用，請在 Safari 的外掛網站權限中允許本機檔案存取。
7. 打開 Axure 頁面後，點選外掛圖示開始調整縮放。

## 使用方式
- 滑桿：拖曳到目標倍率。
- 快速按鈕：`-`、`Reset`、`+`。
- 鍵盤：`Cmd/Ctrl +`、`Cmd/Ctrl -`、`Cmd/Ctrl 0`。
- 若主快捷鍵被瀏覽器攔截，可改用：`Option + Shift + ↑/↓/0`。
- 快捷鍵僅在偵測到 Axure 文件容器時生效，其他頁面不會套用縮放。

## 測試
```bash
npm test
npm run lint
```

## 部署（第一階段）
1. 產出建置：`npm run build`。
2. 轉換 Safari 專案：`./scripts/convert-to-safari-app.sh`。
3. 在 Xcode 簽章並封裝（內部發佈或 TestFlight）。
4. 附上測試證據（`npm test` 與手動驗證清單）。

## 常見問題
- `Failed to resolve import "@shared/..."`：已改為相對路徑匯入；請先拉最新程式，再重新 `npm run build`。
- 安裝後無效果：通常是網站權限未開、開在 `file://` 但未允許本機檔案存取，或未重新建置/重新安裝 extension。
- Popup 顯示「此分頁尚未準備好 Axure 縮放功能」：代表無法連到 content script。請依序檢查：
  1. 是否開在一般網頁或 Axure 頁面（非 Safari 系統頁）。
  2. 是否已重新整理頁面（安裝/更新外掛後需 reload）。
  3. Safari 外掛網站權限是否允許該網域（含 `file://` 本機檔案）。
