# Axure Scale Screen（Safari Web Extension）

這是一個針對 Safari 的 Axure 工具：既是縮放外掛（滑桿、快捷鍵、一鍵重置），也是 Axure 連結管理中心（自動偵測、收藏、分組、匯出／同步）。程式碼採用標準 Manifest V3 與 `chrome.*` API，因此也可以直接在 Chrome 上使用（見下方〈在 Chrome 執行〉）。

## 功能

### 縮放
- 縮放範圍：`50%` 到 `400%`（`10%` 步進）
- 控制方式：popup 滑桿、`+/-` 按鈕、`Reset`、觸控板雙指縮放（pinch；Safari 走手勢事件、Chrome 走 Ctrl+滾輪/雙指）
- 快捷鍵：`Cmd/Ctrl + Option + =`（放大）、`Cmd/Ctrl + Option + -`（縮小）、`Cmd/Ctrl + Option + 0`（重置）
  - 刻意避開原生縮放的 `Cmd +/-`：那是瀏覽器保留鍵（Safari 攔不住、`chrome.commands` 也不收 `+/-`），改用加上 Option 的非保留組合，兩瀏覽器皆通且不衝突。
- 瀏覽器層快捷鍵（可重新指派）：`Cmd/Ctrl + Shift + ↑ / ↓ / 0`，由 `chrome.commands` 提供預設鍵。
- 偏好儲存：依 `origin + pathname` 記住每頁倍率
- 觸控板雙指左右平移：在偵測到 Axure 的文件內攔截水平捲動，快速滑到邊界時停在原型內，避免誤觸 Safari 上一頁／下一頁手勢；支援動態面板與斜向捲動。

### Axure 連結管理中心（Link Hub）
- 自動偵測：開啟未收藏的 Axure 原型時，右上角浮動卡片詢問是否收藏（名稱取自 Axure 專案名 `$axure...projectName`，可即時修改）。
- popup 書籤清單：點一下一鍵開新分頁；超過 4 筆出現搜尋框。
- popup 固定高度，書籤與清理頁籤共用切換區域；只捲動清單，縮放控制、管理／關閉按鈕與底部快捷提示保持可見。Chrome 側欄沿用相同布局並填滿視窗高度。
- 管理頁（外掛選項）：清單／搜尋／分組篩選／排序、改名、換組、刪除、每列「忽略」、以及已忽略專案的復原。
- 分組：「已完成」是固定分組，不能改名或刪除；更新時會自動補回曾被刪除的「已完成」。其他分組可新增／改名／刪除（改名連動更新書籤、刪除把書籤退回未分組）。
- 清理 Axure 頁籤：popup、側欄與管理頁會列出所有視窗中屬於「已完成」專案的頁籤，建議關閉並提供一鍵全關。同一專案的不同頁面與重複頁籤都會列入；關閉前重新比對，只關閉清單中仍屬於「已完成」的頁籤。
- 匯出 `bookmarks.html`（Netscape 格式）：任何瀏覽器「匯入書籤」皆可，是 Safari 寫入真實書籤的正規途徑。
- JSON 完整備份與還原：管理頁「備份與還原」可匯出含書籤（含造訪次數）、分組與忽略清單的 JSON；匯入只補上目前沒有的書籤，不修改現有書籤，重複匯入同一份也沒有副作用。超過 7 天未備份會以紅字提醒。外掛資料只存在瀏覽器裡，Safari 把外掛當成重新安裝時會整個清除，請把備份檔存在外掛以外的地方。
- Safari 自動備份：每次書籤有變動，就透過 native messaging 把完整備份寫進外掛 App Extension 自己的容器（`~/Library/Containers/com.example.axurescalescreen.Extension/Data/Library/Application Support/AxureScaleScreen/Backups/<Safari 設定檔>/`），保留 `latest.json` 與最近 30 天的每日備份。Safari 清除外掛資料時不會動到這個容器；偵測到資料被清除時會**暫停自動備份**（不會用空資料蓋掉備份），並在管理頁與 popup 提示「還原自動備份」。Chrome 不支援，相關介面自動隱藏。
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
2. 轉換成 Safari App 專案（**只需要做一次**）：
   ```bash
   ./scripts/convert-to-safari-app.sh AxureScaleScreen com.example.axurescalescreen safari-app
   ```
3. 用 Xcode 開啟 `safari-app/AxureScaleScreen/AxureScaleScreen.xcodeproj`。
4. 設定 Signing Team 與唯一 Bundle ID。
5. 執行一次 App，然後到 Safari 設定中啟用外掛。
6. 若要在本機 `file://` Axure 匯出檔使用，請在 Safari 的外掛網站權限中允許本機檔案存取。
7. 打開 Axure 頁面後，點選外掛圖示開始調整縮放。

### 更新 Safari 外掛
Xcode 專案直接引用 `dist/`，之後每次更新只需要：
1. `npm run build`（也會把 `src/safari-native/SafariWebExtensionHandler.swift` 同步進 `safari-app/AxureScaleScreen/`，自動備份需要它）
2. 在 Xcode 按 Run

> ⚠️ **不要重新執行轉換腳本或刪掉 `safari-app/` 重建。** 重新產生專案會讓 Safari 把外掛當成重新安裝，並清除外掛的儲存資料（所有書籤、分組與縮放記錄）。轉換腳本偵測到既有專案，或 Safari 已安裝這個外掛時會直接停止；真的必須重建時，先到管理頁「匯出備份（JSON）」，再以 `ALLOW_REGENERATE=1` 執行，完成後用「匯入備份」還原。

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
- 清理：在管理頁把專案移到「已完成」，開啟外掛後切換到「清理頁籤」（或使用管理頁的「清理 Axure 頁籤」）即可查看建議，按「一鍵關閉 N 個頁籤」關閉清單中的頁籤。

## 測試
```bash
npm test
npm run lint
npm run test:native   # Safari 原生備份 handler（需要 Xcode）
```

Safari 手動回歸（更新外掛並重新整理 Axure 頁面後）：
1. 開啟同一已收藏專案的兩個頁籤，再在管理頁移到「已完成」：確認該分組只顯示「固定分組」，清理區列出兩個頁籤；按一鍵關閉後，確認兩個頁籤關閉且其他分組／一般網站的頁籤仍保留。再驗證本機 file:// 原型（需允許本機檔案存取），以及將專案移出「已完成」後不再建議關閉。
2. 從另一頁進入寬版 Axure 原型，先橫向捲到中間，再快速雙指左右滑到兩端，確認能平移且不觸發上一頁／下一頁；也測試縮小到沒有水平捲軸的情況。
3. 在動態面板內水平／斜向捲動，確認面板與頁面移動正常；垂直捲動、雙指縮放及重置仍可使用。
4. 若原型位於 iframe，也在該 frame 內測試；開啟一般網站，確認原本的 Safari 手勢仍可使用。

Vitest 使用 jsdom 驗證事件取消與捲動位移，無法模擬 Safari 原生歷史導覽手勢；上述步驟需在實際 Safari 驗證。

## 部署（第一階段）
1. 產出建置：`npm run build`。
2. 第一次部署才需要轉換 Safari 專案：`./scripts/convert-to-safari-app.sh`；之後沿用既有專案（見〈更新 Safari 外掛〉）。
3. 在 Xcode 簽章並封裝（內部發佈或 TestFlight）。
4. 附上測試證據（`npm test` 與手動驗證清單）。

## 常見問題
- `Failed to resolve import "@shared/..."`：已改為相對路徑匯入；請先拉最新程式，再重新 `npm run build`。
- 安裝後無效果：通常是網站權限未開、開在 `file://` 但未允許本機檔案存取，或未重新建置/重新安裝 extension。
- Popup 顯示「此分頁尚未準備好 Axure 縮放功能」：代表無法連到 content script。請依序檢查：
  1. 是否開在一般網頁或 Axure 頁面（非 Safari 系統頁）。
  2. 是否已重新整理頁面（安裝/更新外掛後需 reload）。
  3. Safari 外掛網站權限是否允許該網域（含 `file://` 本機檔案）。
