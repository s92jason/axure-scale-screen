# Axure Scale Screen（Safari Web Extension）

這是一個針對 Safari 的 Axure 縮放外掛，提供滑桿、快捷鍵與一鍵重置，讓瀏覽原型文件更容易。

## 功能
- 縮放範圍：`50%` 到 `200%`（`10%` 步進）
- 控制方式：popup 滑桿、`+/-` 按鈕、`Reset`
- 快捷鍵：`Cmd/Ctrl +`、`Cmd/Ctrl -`、`Cmd/Ctrl 0`
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
6. 打開 Axure 頁面後，點選外掛圖示開始調整縮放。

## 使用方式
- 滑桿：拖曳到目標倍率。
- 快速按鈕：`-`、`Reset`、`+`。
- 鍵盤：`Cmd/Ctrl +`、`Cmd/Ctrl -`、`Cmd/Ctrl 0`。

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
