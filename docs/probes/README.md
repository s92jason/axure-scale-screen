# P0 探針 — 跑法與判讀

對應 plan 附錄 B.1 的 **P0-1**($axure / projectName 可讀性)與 **P0-4**(file:// 是否有路徑無關的穩定 ID)。
不需要 build、不需要裝外掛——純 console 貼上。

## 怎麼跑

請在**三種**頁面各跑一次,涵蓋我們要支援的情境:

1. axshare 線上原型(`*.axshare.com`)
2. axure.cloud 原型(若有)
3. **本機匯出的 Axure**(`file://.../index.html`)— 這是 P0-4 的重點

每種頁面:

1. 開 DevTools → Console。
2. 把 `axure-probe.js` 整個檔案內容貼上、Enter。
3. 看輸出的表格與兩行 log。
4. **(P0-4 關鍵)** 把同一個本機原型**複製到另一個資料夾**,再跑一次,比對「疑似穩定 ID 欄位」有沒有變。

> Chrome 與 Safari 都要各跑一次。Safari 需先在「開發」選單啟用,且對 `file://` 可能要先授權擴充功能存取(這本身也是 P0-3 的觀察點)。

## 怎麼判讀

| 看什麼 | 代表 |
|---|---|
| `hasAxure = true` 出現在哪個 frame | 偵測/注入要鎖定那個 frame;若在 `frame[n]` 而非 `top`,印證附錄 B.1 P0-2「子 frame 偵測、頂層顯示」 |
| `projectName` 有值 | F4 主命名源存在 → 值得做 MAIN-world 注入把它取出;為空 → F4 直接退 `document.title` |
| `疑似穩定 ID 欄位` 在搬移資料夾後**不變** | P0-4 成功:可用它當 file:// 的穩定身份,搬移自動認回 |
| 搬移後 ID **變了 / 根本沒有 ID** | 退「路徑指紋」(頁面清單 hash)或管理頁手動「重新連結」(見附錄 B.5 Q1) |

## 回報格式(貼回來給我即可)

- 三種頁面 × (Chrome/Safari) 的 `hasAxure` 在哪個 frame
- `projectName` 有沒有值、長相
- `疑似穩定 ID 欄位` 的內容,以及**搬移前後是否一致**

有了這些,F4 命名與 Q1 的 file:// 身份就能定最終做法,不必再猜。
