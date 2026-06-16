# 功能規劃:Axure 連結管理中心(Link Hub)

> 版本目標:v0.3.0 / 撰寫日期:2026-06-12
> 定位:plugin 內建管理頁為 source of truth;Chrome 真實書籤為選配單向同步;Safari 以匯出 bookmarks.html 補位。

## 0. 設計決策(已確認)

| 決策點 | 結論 | 理由 |
|---|---|---|
| Safari 無 bookmarks API | 內建管理頁為主,真實書籤降為 Chrome 選配 | Safari Web Extension 不支援 `browser.bookmarks`(Apple 至今未實作);管理頁兩瀏覽器通用 |
| 提示 UX | 頁面內浮動卡片(預設)+ badge 模式,可在設定切換 | 兼顧直覺與低干擾 |
| 去重粒度 | 以「專案」為單位(忽略 `#p=` page hash) | 書籤列乾淨,符合「管理 Axure 網址」初衷 |
| 縮放快捷鍵 | 放棄搶 `Cmd +/-`,改用非保留組合(詳見附錄 A) | `Cmd +/-` 在 Safari 是保留鍵攔不住,`chrome.commands` 又不接受 `+/-/=`;與其硬碰不如選相鄰自由鍵 |

## 1. 功能需求

### F1 — Axure 連結偵測
- 判定條件(任一):
  - host 符合 `*.axshare.com`、`*.axure.cloud`
  - `file://` 且 content script 偵測到 Axure 容器(複用現有 `content/engine.ts` 偵測邏輯)
- **專案 key 正規化**:
  - axshare:子網域 ID(`https://abc123.axshare.com` → `axshare:abc123`)
  - axure.cloud:`/app/project/{id}` 路徑段
  - file:// :匯出資料夾根路徑(`.../index.html` 與 `.../start.html` 視為同根)
- 流程:content script 偵測到 Axure → 傳訊息給 background → 查 store,未收藏且不在 ignore list → 觸發提示

### F2 — 加入詢問
- **浮動卡片(預設)**:shadow DOM 注入頁面右上角,內容:自動命名(可編輯)、分組下拉、`加入` / `略過` / `不再提醒此專案`。約 8 秒無互動自動收合(收合 ≠ 略過,badge 仍亮)。
- **badge 模式**:action 圖示顯示 `+` badge,popup 上方出現加入區塊。
- `略過`:本次瀏覽器 session 不再問;`不再提醒`:寫入永久 ignore list(管理頁可復原)。

### F3 — 儲存層(source of truth)
`chrome.storage.local`,schema:

```ts
interface AxureBookmark {
  id: string;            // uuid
  projectKey: string;    // 去重 key,見 F1
  url: string;           // 正規化後的專案首頁 URL
  name: string;
  folder: string;        // plugin 內分組;同步 Chrome 書籤時對應真實資料夾
  createdAt: number;
  lastVisitedAt: number;
  visitCount: number;
}
interface Settings {
  promptMode: 'card' | 'badge';
  ignoredProjectKeys: string[];
  chromeSync: { enabled: boolean; parentFolderId: string | null };
}
```

### F4 — 智慧命名
優先序:
1. `$axure.document.configuration.projectName`(Axure 原型頁的全域物件,content script 可讀)
2. `document.title` 去除頁面名後綴
3. host(如 `abc123.axshare.com`)

確認框內永遠可改;同名不同專案允許並存(以 projectKey 區分)。

### F5 — 書籤快速清單(popup 內,主要入口)
> 2026-06-12 設計修正:快速開啟是書籤的核心價值,不能藏在 options 頁。
- popup 縮放區下方常駐書籤列表:點擊直接開啟該專案(新分頁)
- 超過 4 筆顯示搜尋框;每列顯示名稱 + 分組 pill
- 開啟時更新 `lastVisitedAt` / `visitCount`
- 「管理 →」連到 options 頁做進階操作

### F6 — 管理頁(options page,進階管理)
- 書籤列表:名稱、分組、最後開啟時間、開啟次數;支援搜尋、依分組篩選、排序;點名稱直接開啟
- 操作:改名、換分組、刪除、復原 ignore
- **匯出 bookmarks.html**(Netscape Bookmark File 格式)→ Safari/任何瀏覽器「匯入書籤」即可進真實書籤,這是 Safari 端寫入真實書籤的唯一正規途徑
- **Chrome 限定**:`同步到 Chrome 書籤` 開關 + 目標資料夾選擇器(`chrome.bookmarks.getTree` 渲染)。同步為**單向 push**(plugin → 書籤),不做雙向,避免衝突解決的複雜度

## 2. 技術變更

### Manifest
- 新增 `options_ui`(或 `options_page`)
- `"bookmarks"` 放 **`optional_permissions`**:Chrome 端使用者開啟同步時才 `permissions.request()`;Safari 端不申請,runtime 以 `typeof chrome.bookmarks !== 'undefined'` feature-detect

### 新增檔案
```
src/shared/bookmarkStore.ts    # storage CRUD + 去重
src/shared/projectKey.ts       # URL 正規化(擴充現有 url.ts 亦可)
src/shared/naming.ts           # 自動命名
src/content/promptCard.ts      # shadow DOM 浮動卡片
src/options/                   # 管理頁 (main.ts / index.html / style.css)
src/background/index.ts        # +偵測訊息路由、badge、Chrome 同步
tests/unit/projectKey.test.ts
tests/unit/bookmarkStore.test.ts
tests/unit/naming.test.ts
```
現有 zoom 縮放邏輯不動;**唯一變更是縮放快捷鍵組合**,詳見附錄 A。

## 3. 分期交付

| 里程碑 | 內容 | 價值 |
|---|---|---|
| M1 | F1 偵測 + F2 浮動卡片 + F3 儲存 + F4 命名 + F5 popup 快速清單 | 核心體驗閉環:偵測→詢問→收藏→**一鍵開啟** |
| M2 | F6 管理頁 + bookmarks.html 匯出 | Safari 端完整可用 |
| M3 | Chrome 書籤同步 + badge 模式 + 設定頁 | Chrome 端「真實書籤」到位 |

## 4. 開放問題

> 2026-06-16:Q1–Q4 已定案,結論見 **附錄 B.5**;下方保留原始問題脈絡。

1. **file:// 專案的 key 穩定性**:本機路徑搬移後會被視為新專案。可接受?或加「合併書籤」功能?
2. **頁面層級需求**:去重以專案為單位,但若日後常需直達特定頁,可在卡片加「儲存目前頁面」副選項(已預留 schema 擴充空間)。
3. **lastVisitedAt 更新頻率**:每次造訪都寫 storage,或 debounce(建議 session 內一次)。
4. **Chrome 同步刪除行為**:plugin 刪書籤時,是否連動刪 Chrome 真實書籤?(建議:問使用者一次,記住選擇)

---

## 附錄 A — 縮放快捷鍵重新設計(2026-06-16 補充)

### A.1 問題的真正根因
原本想沿用 `Cmd +/-`,但它做不到,且不是「衝突」一句話帶過——是**兩套機制的限制剛好相反**,把這組合夾死:

| 機制 | 位置 | 能用 `+ / - / =`? | Safari 能攔 `Cmd +/-`? |
|---|---|---|---|
| 頁面內 keydown 監聽 | `src/content/engine.ts` `getShortcutDelta` | ✅ 任意鍵 | ❌ `Cmd +/-` 為瀏覽器保留鍵,頁面 `preventDefault` 搶不過 |
| `chrome.commands`(瀏覽器層) | `manifest.json` + `src/background/index.ts` | ❌ API 不接受 `Plus/Minus/Equal` | ✅ 但僅限 A–Z、0–9、方向鍵等,且須含 Ctrl 或 Alt |

結論:`Cmd +/-` 在 Safari **結構性無解**(頁面攔不住、commands 又不收這幾個鍵)。現行 `Alt+Shift+方向鍵` 就是被這兩道牆逼出來的妥協,但不直覺。

> 來源:[chrome.commands | Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/commands)、[commands | MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/commands)。`chrome.commands` 合法鍵為 A–Z、0–9、Comma、Period、Home/End、PageUp/Down、Space、Insert、Delete、方向鍵、媒體鍵,且組合必須含 Ctrl 或 Alt。

### A.2 設計轉向
不再嘗試「搶回」保留鍵,改選**相鄰、無人佔用**的組合——如此一來整個 `preventDefault` 搶鍵時序問題直接消失(沒有原生行為要打敗)。
依據:現行 `Alt+Shift+方向鍵` fallback 在 Safari 可運作,已證明**頁面內監聽在 Safari 對非保留組合會觸發**,因此換成更直覺的非保留組合即可。

### A.3 決定的快捷鍵(分層)

| 層級 | 快捷鍵 | 機制 | 理由 |
|---|---|---|---|
| **主**(對外宣傳) | `Cmd/Ctrl + Option + =` 放大 / `+ Option + -` 縮小 / `+ Option + 0` 重置 | 頁面內監聽 | 與原生只差一個 Option,肌肉記憶幾乎無痛;非保留鍵,Chrome/Safari 皆通,且不必搶鍵 |
| **後備**(可重綁) | `Cmd+Shift+↑ / ↓ / 0` | `chrome.commands` | 焦點不在 Axure iframe、頁面收不到事件時,瀏覽器層仍可觸發;為 commands 合法且有「上=放大」隱喻 |
| **選配**(預設關閉) | 無修飾鍵 `+ / - / 0` | 頁面內監聽 | 類 PDF/地圖檢視器,最簡;風險為 Axure 原型自身可能綁同鍵,故不預設啟用 |

### A.4 需變更的檔案
- `src/content/engine.ts` — `getShortcutDelta`:主對應由 `Cmd+=` 改為 `Cmd+Opt+=`(保留 `0` 重置),fallback 改為選配。
- `src/manifest.json` — `commands` 加 `suggested_key`(mac: `Command+Shift+Up/Down/0`,default: `Ctrl+Shift+Up/Down/0`)。
- `README.md` — 更新快捷鍵說明;建議 popup 顯示目前生效快捷鍵。

### A.5 待驗證 / 開放問題
- **(待實測)** Safari 是否完全不攔 `Cmd+Opt+=`。推論為「不攔」(非 Safari 選單捷徑 + fallback 已證明頁面監聽可用),屬高信度推理而非實測,需各按一次確認。
- 是否在 popup 顯示目前快捷鍵提示,降低學習成本。
- 選配的無修飾鍵 `+/-` 是否真有 Axure 原型衝突案例,決定要不要做成設定開關。

---

## 附錄 B — 實作計畫(M1–M3 全功能,2026-06-16)

> 這份計畫刻意「貼著現有程式碼」寫,而不是把第 1 節需求重抄一遍。每一塊都標明接到既有的哪個模式,以及哪裡是新的風險。

### B.0 與現有架構的五個接點(後面全靠這些)

1. **儲存模式**:`src/shared/storage.ts` 是 `chrome.storage.local` 的 Promise 包裝(`getStorageValue/setStorageValue/removeStorageValue`),以 `STORAGE_PREFIX + key` 命名。`bookmarkStore.ts` **照抄同一套包裝**,不要另立風格。
2. **訊息模式**:型別集中在 `src/shared/types.ts` 的 `RuntimeMessage`(content→background)與 `ContentMessage`(popup/background→content)兩個 union,加上 `isRuntimeMessage` type guard。**每新增一個書籤訊息,要同步改三處**:union、type guard、background 的 `onMessage` switch。漏改 guard 會被靜默吞掉。
3. **偵測已現成**:`src/content/engine.ts` 的 `findAxureRoot` + `isLikelyAxureDocument` 已能判定 Axure 頁,content script 也已 `all_frames: true`。**F1 偵測直接複用,不重寫**——這讓 M1 的風險集中在 UI 與資料層,而非偵測。
4. **build 是顯式 entry**:`scripts/build.mjs` 對 popup / background / content 各寫一個 build()。**新增 options 頁必須加一個 `buildOptions()`**(複製 `buildPopup()`,入口 `options.html`)。promptCard 不另開 entry,直接被 content 匯入打包進 `content.js`。
5. **三套 key 並存,別混用**:
   - zoom 用 `toUrlKey()`(origin+pathname,**逐頁**)
   - 書籤去重用新的 `projectKey`(**逐專案**,見 F1)
   - storage 命名前綴沿用 `STORAGE_PREFIX`,但書籤建議獨立成 `axure-scale::bm::` 命名空間,避免和 zoom 狀態混在同一 key 空間掃描。

### B.1 Phase 0 — 技術探針(建議 0.5–1 天,**先驗證再蓋 UI**)

doc 的里程碑把「偵測+卡片+儲存+命名+清單」全塞進 M1,等於把最不確定的假設壓在最底層,卻先做最花工的 shadow-DOM 卡片。**這是我對既定順序的主要異議**:下面三個假設只要有一個不成立,M1 的 UI 就要重畫。先用最低成本各驗一次:

| # | 載重假設 | 為什麼有風險 | 探針做法 | 若不成立的退路 |
|---|---|---|---|---|
| P0-1 | content script 讀得到 `$axure.document.configuration.projectName`(F4 主命名源) | MV3 content script 跑在 **isolated world**,看不到頁面 `window.$axure`;`isLikelyAxureDocument` 目前其實是靠 `hasAxureAssets`(DOM)成立,`$axure` 那條在 isolated world 幾乎永遠 false | 寫一個 `world:"MAIN"` 的小 content script 或注入 web-accessible `<script>`,讀到值後 `postMessage` 回 isolated world,在 Chrome 與 **Safari** 各跑一次 | 退到 `document.title`(DOM 可讀,穩);MAIN-world 注入失敗時 F4 直接降級,不阻斷 M1 |
| P0-2 | 浮動卡片該注入哪個 frame | axshare 常把原型包在 iframe 裡;偵測發生在**子 frame**,但卡片要浮在**頂層視窗**角落 | 在 axshare 真實頁試:子 frame 偵測 → 訊息給 background → background 轉發給 **頂層 frame(frameId 0)** 顯示卡片 | 若頂層拿不到,退而求其次注入偵測到的 frame(體驗較差但可用) |
| P0-3 | `file://` 偵測與存取 | Safari 對擴充功能存取 `file://` 需使用者手動授權 | 在 Safari 開啟匯出的本機 Axure,確認 content script 有跑 | file:// 列為「Chrome 完整、Safari 視授權情況」 |
| P0-4 | **file:// 專案是否有路徑無關的穩定 ID**(Q1 定案的前提) | 官方文件未公開 `document.js`/`$axure.document.configuration` 是否含專案 GUID,**我無法從文件確認** | 打開實際產生的原型,翻 `resources/data/document.js`、`$axure.document.configuration`、`sitemap.js`,找有無不隨路徑變的 id | 有→當穩定身份;無→退路徑指紋(頁面清單 hash)或管理頁手動「重新連結」 |

**探針首跑結果(2026-06-16,僅 axshare 線上原型;Chrome 與 Safari 一致):**
- **P0-1 ✅** `projectName` 有值(實測例:「CUBE卡權益方案頁開關」)→ F4 主命名源確定存在,值得用。但它在**頁面 main world**,content script(isolated world)仍讀不到 → M1 要用 MAIN-world 注入 / web-accessible `<script>` 把它 postMessage 回來。
- **P0-2:** `$axure` 同時存在於 `top` 與 `frame[0]` → 卡片可直接鎖定 top frame,frame 轉發機制仍是保險。
- **P0-4:** axshare 頁面**無**內嵌穩定 ID;但 axshare 的**子網域本身就是穩定身份**(URL 不會變),所以 axshare 根本不需要額外 ID。穩定 ID 只對 file:// 有意義,而使用者目前用不到 file:// / axure.cloud,**故 Q1 的身份/位置分離降級為「僅 file:// 需要時才做」**(見 B.5.1 修訂)。

P0-2 帶出一個 M1 的**架構定案**:偵測在子 frame、顯示在頂層 frame,兩者用既有的 background 轉發機制(`background/index.ts` 的 `discoverFrameIds` + `sendMessageToFrame` 已經是這個 pattern,直接複用)。

### B.2 M1 — 核心閉環(偵測→詢問→收藏→一鍵開啟)

逐檔交付:

- **`src/shared/projectKey.ts`**(+`tests/unit/projectKey.test.ts`):純函式 `toProjectKey(url)`。axshare→`axshare:{子網域}`;axure.cloud→`axurecloud:{/app/project/{id}}`;file://→`file:{資料夾根}`(`index.html`/`start.html` 視為同根)。**純字串邏輯,優先寫測試**,因為去重正確性全押在這。
- **`src/shared/bookmarkStore.ts`**(+`tests/unit/bookmarkStore.test.ts`):照 `storage.ts` 包裝做 CRUD;`add` 時以 `projectKey` 去重(已存在則更新 `lastVisitedAt`/`visitCount` 而非新增);`ignoredProjectKeys` 讀寫。schema 用第 1 節 F3 的 `AxureBookmark`/`Settings`。
- **`src/shared/types.ts`**:擴充 `RuntimeMessage`,新增 `BOOKMARK_DETECTED`、`BOOKMARK_ADD`、`BOOKMARK_GET_ALL`、`BOOKMARK_IGNORE`;`ContentMessage` 新增 `SHOW_PROMPT_CARD`。**同步更新 `isRuntimeMessage`**。
- **`src/shared/naming.ts`**(+`tests/unit/naming.test.ts`):F4 優先序(`projectName` → `document.title` 去後綴 → host)。`projectName` 取得依 P0-1 結論;測試只測「給定三個輸入時的選擇邏輯」,注入方式另測。
- **`src/content/`**:
  - `axureZoom.ts bootstrap()` 末尾:當 `state.isAxure`,送 `BOOKMARK_DETECTED { projectKey, name, url }` 給 background。
  - 新 `promptCard.ts`:shadow DOM 卡片(F2),由 `SHOW_PROMPT_CARD` 觸發、只在頂層 frame render;含命名(可編輯)、分組、`加入/略過/不再提醒`;8 秒自動收合。
- **`src/background/index.ts`**:`onMessage` switch 加書籤分支;收到 `BOOKMARK_DETECTED` → 查 store + ignore list → 該問就轉發 `SHOW_PROMPT_CARD` 給頂層 frame。
- **`popup`(F5,主入口)**:`popup.html` 在 actions 下方加書籤清單區;`src/popup/main.ts` 開啟時發 `BOOKMARK_GET_ALL`,render 每列(名稱+分組 pill),點擊 `chrome.tabs.create` 開新分頁並更新 `lastVisitedAt`;>4 筆顯示搜尋框。

**M1 驗收**:在 axshare 開未收藏專案→卡片出現→加入→popup 點一下開新分頁。

### B.3 M2 — 管理頁 + 匯出(Safari 端補完)

- **`src/options/`**(`index.html`/`main.ts`/`style.css`)+ manifest `options_ui`。
- **`scripts/build.mjs`** 加 `buildOptions()`(對齊 `buildPopup()`)。
- 列表:名稱/分組/最後開啟/次數,搜尋、分組篩選、排序、改名、換分組、刪除、復原 ignore——全走 background CRUD。
- **bookmarks.html 匯出**:產生 Netscape Bookmark 格式字串,用 **blob + `<a download>`** 觸發下載(**刻意不要 `downloads` 權限**,blob 方式零權限即可)。這是 Safari 寫入真實書籤的唯一正規途徑。

### B.4 M3 — Chrome 同步 + badge + 設定

- manifest `optional_permissions: ["bookmarks"]`;使用者開同步時才 `chrome.permissions.request()`;runtime 用 `typeof chrome.bookmarks !== 'undefined'` feature-detect(Safari 端自動隱藏)。
- 同步為**單向 push**(plugin→書籤),目標資料夾用 `chrome.bookmarks.getTree` 渲染選擇器。
- badge 模式:`chrome.action.setBadgeText`(F2 替代 UX)。
- 設定頁:`promptMode`(card/badge)、同步開關+資料夾、ignore 復原。

### B.5 開放問題的決定(2026-06-16 定案)

- **Q1 file:// key 穩定性** → **定案(2026-06-16 探針後簡化)**:axshare 子網域本身即穩定身份、url 不變,**故單層 schema 即可,projectKey 同時當身份與去重 key**。身份/位置分離(Project+Location)只對 file:// 搬移有意義,使用者目前用不到 → **延後,需要時才補**。
  - file:// 將來若要支援搬移自動辨識:先看 P0-4 有無穩定 ID;無則退「路徑指紋」(頁面清單 hash)或管理頁手動「重新連結」。
- **Q2 頁面層級** → **定案:維持專案層級**;schema 已預留,日後加「儲存目前頁面」副選項即可。
- **Q3 lastVisitedAt 頻率** → **定案:session 內一次**(content/background 各放一個 in-memory guard)。
- **Q4 Chrome 同步刪除連動** → **定案:每次刪除都詢問**(不記住選擇)。日後嫌煩可再加「不再詢問」,但預設保持每次確認,避免誤刪真實書籤。

### B.5.1 schema(2026-06-16 探針後定版:單層)

探針顯示 axshare url 穩定,不需要身份/位置分離,**維持第 1 節 F3 的單層表**(已實作於 `src/shared/bookmarkStore.ts`),並以 `projectKey` 為儲存 key:

```ts
interface AxureBookmark {
  projectKey: string;        // 身份 + 去重 key(URL 正規化，見 projectKey.ts)
  url: string;               // 開啟目標(專案首頁)
  name: string;
  folder: string;
  createdAt: number;
  lastVisitedAt: number | null;
  visitCount: number;
}
```

儲存配置:`axure-scale::bm::items`(`Record<projectKey, AxureBookmark>`)、`axure-scale::bm::ignored`(string[])、`axure-scale::bm::settings`。去重:`addBookmark` 命中既有 projectKey 就只更新 `url`(不覆寫名稱/分組/造訪數),否則新增。

> 若日後支援 file:// 搬移,再升級為 `Project`(穩定身份)+`Location`(可變路徑)兩層;當前刻意不做(YAGNI)。

### B.6 測試計畫

- **單元**:`projectKey`(各 host/file 形態)、`bookmarkStore`(去重、ignore、visitCount)、`naming`(三層優先序)。
- **整合**:沿用 jsdom,測 background 訊息路由 + guard。
- **手動**:P0 三項;Safari 卡片注入頂層 frame;`file://`;Chrome 同步 push 與刪除連動。
- 每階段 `npm test` + `npm run lint` 綠燈;改完 `npm run build` 並重新打包 Safari app 實測。

### B.7 建議建置順序(與 doc 里程碑的差異)

doc:M1 全包 → M2 → M3。
建議:**先插 B.1 Phase 0 探針**,再 M1;且 M1 內部順序為 `projectKey/bookmarkStore`(純邏輯、可測)→ background 路由 → popup 清單(**先讓「手動加一筆就能在 popup 開啟」跑通**)→ 最後才做最花工的 shadow-DOM 卡片。這樣最早一個可用的閉環不依賴卡片 UI,卡片可獨立迭代。
