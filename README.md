# Axure Scale Screen（Safari Web Extension）

這是一個針對 Safari 的 Axure 工具：既是縮放外掛（滑桿、快捷鍵、一鍵重置），也是 Axure 連結管理中心（自動偵測、收藏、分組、匯出／同步）。程式碼採用標準 Manifest V3 與 `chrome.*` API，因此也可以直接在 Chrome 上使用（見下方〈在 Chrome 執行〉）。

## 功能

### 縮放
- 縮放範圍：`50%` 到 `200%`（`10%` 步進）
- 控制方式：popup 滑桿、`+/-` 按鈕、`Reset`
- 快捷鍵：`Cmd/Ctrl + Option + =`（放大）、`Cmd/Ctrl + Option + -`（縮小）、`Cmd/Ctrl + Option + 0`（重置）
  - 刻意避開原生縮放的 `Cmd +/-`：那是瀏覽器保留鍵（Safari 攔不住、`chrome.commands` 也不收 `+/-`），改用加上 Option 的非保留組合，兩瀏覽器皆通且不衝突。
- 瀏覽器層快捷鍵（可重新指派）：`Cmd/Ctrl + Shift + ↑ / ↓ / 0`，由 `chrome.commands` 提供預設鍵。
- 偏好儲存：依 `origin + pathname` 記住每頁倍率

### Axure 連結管理中心（Link Hub）
- 自動偵測：開啟未收藏的 Axure 原型時，右上角浮動卡片詢問是否收藏（名稱取自 Axure 專案名 `$axure...projectName`，可即時修改）。
- popup 書籤清單：點一下一鍵開新分頁；超過 4 筆出現搜尋框。
- 管理頁（外掛選項）：清單／搜尋／分組篩選／排序、改名、換組、刪除、每列「忽略」、以及已忽略專案的復原。
- 分組：內建預設分組，可新增／改名／刪除（改名連動更新書籤、刪除把書籤退回未分組）。
- 匯出 `bookmarks.html`（Netscape 格式）：任何瀏覽器「匯入書籤」皆可，是 Safari 寫入真實書籤的正規途徑。
- 提示模式：浮動卡片，或工具列圖示顯示 `＋` 的 badge 模式（設定頁切換）。
- Chrome 真實書籤同步（單向 push）：把書籤推送到所選 Chrome 書籤資料夾並維護「Axure 書籤」資料夾；Safari 不支援，介面會自動隱藏該區。

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

## 在 Chrome 執行
1. 先建置 extension：
   ```bash
   npm run build
   ```
2. 打開 `chrome://extensions`，開啟右上角「開發人員模式」。
3. 點「載入未封裝項目」，選擇 `dist/` 資料夾。
4. 若要在本機 `file://` Axure 匯出檔使用，請到該擴充功能的「詳細資料」頁面，開啟「允許存取檔案網址」。
5. 打開 Axure 頁面後，點選外掛圖示開始調整縮放。

注意事項：
- 縮放快捷鍵 `Cmd/Ctrl + Option + =/-/0` 由 content script 處理，安裝後即可使用，且不與瀏覽器內建縮放（`Cmd +/-`）衝突。
- `Cmd/Ctrl + Shift + ↑/↓/0` 由 `chrome.commands` 提供並附預設鍵；可到 `chrome://extensions/shortcuts`（Chrome）或 Safari 擴充功能設定頁重新指派。
- Chrome 真實書籤同步需要 `bookmarks` 權限（optional）：到管理頁設定開啟時才會請求。

## 使用方式
- 滑桿：拖曳到目標倍率。
- 快速按鈕：`-`、`Reset`、`+`。
- 鍵盤：`Cmd/Ctrl + Option + =`（放大）、`Cmd/Ctrl + Option + -`（縮小）、`Cmd/Ctrl + Option + 0`（重置）。
- 瀏覽器層備援（可重新指派）：`Cmd/Ctrl + Shift + ↑/↓/0`。
- 快捷鍵僅在偵測到 Axure 文件容器時生效，其他頁面不會套用縮放。
- 書籤：偵測到 Axure 原型時依浮動卡片或 popup「收藏此頁」加入；於 popup「管理書籤 →」進入管理頁做改名／分組／匯出／同步。

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
