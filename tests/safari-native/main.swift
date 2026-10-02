// Safari 原生備份 handler 的測試：npm run test:native（需要 Xcode）。
// 直接編譯 src/safari-native/SafariWebExtensionHandler.swift，在暫存資料夾驗證讀寫、設定檔隔離與每日備份上限。

import Foundation

var failures = 0
func check(_ condition: Bool, _ label: String) {
    print(condition ? "✓ \(label)" : "✗ \(label)")
    if !condition { failures += 1 }
}

let base = FileManager.default.temporaryDirectory.appendingPathComponent("axure-backup-test-\(UUID().uuidString)")
let handler = SafariWebExtensionHandler()
let profileA = UUID()
let profileB = UUID()
let backup: [String: Any] = [
    "format": "axure-scale-screen-backup", "version": 1, "exportedAt": "2026-10-02T03:00:00.000Z",
    "bookmarks": [["projectKey": "axshare:abc", "url": "https://abc.axshare.com/", "name": "首頁改版", "folder": "進行中",
                   "createdAt": 1790824177243, "lastVisitedAt": NSNull(), "visitCount": 3]],
    "folders": ["進行中", "已完成"], "ignored": []
]

let empty = handler.handle(["type": "backup.read"], profile: profileA, baseDirectory: base)
check(empty["ok"] as? Bool == true && empty["backup"] is NSNull && empty["savedAt"] is NSNull, "讀取不存在的備份回傳 null")

let written = handler.handle(["type": "backup.write", "backup": backup], profile: profileA, baseDirectory: base)
check(written["ok"] as? Bool == true && (written["savedAt"] as? Double ?? 0) > 1_700_000_000_000, "寫入回傳毫秒 savedAt")

let read = handler.handle(["type": "backup.read"], profile: profileA, baseDirectory: base)
let readBackup = read["backup"] as? [String: Any]
let bookmarks = readBackup?["bookmarks"] as? [[String: Any]]
check(read["ok"] as? Bool == true && bookmarks?.first?["name"] as? String == "首頁改版", "讀回同一份備份（含中文）")
check(bookmarks?.first?["lastVisitedAt"] is NSNull && (bookmarks?.first?["createdAt"] as? NSNumber)?.int64Value == 1790824177243, "null 與毫秒時間戳原樣保留")

let other = handler.handle(["type": "backup.read"], profile: profileB, baseDirectory: base)
check(other["backup"] is NSNull, "不同 Safari 設定檔的備份互相獨立")

let noProfile = handler.handle(["type": "backup.write", "backup": backup], profile: nil, baseDirectory: base)
let defaultDir = base.appendingPathComponent("AxureScaleScreen/Backups/default/latest.json")
check(noProfile["ok"] as? Bool == true && FileManager.default.fileExists(atPath: defaultDir.path), "沒有設定檔時寫到 default")

let missing = handler.handle(["type": "backup.write"], profile: profileA, baseDirectory: base)
check(missing["ok"] as? Bool == false && (missing["error"] as? String)?.contains("缺少備份內容") == true, "缺少備份內容時回報錯誤")

let unknown = handler.handle(["type": "nope"], profile: profileA, baseDirectory: base)
check(unknown["ok"] as? Bool == false, "未知訊息回報錯誤")

let invalid = handler.handle(["type": "backup.write", "backup": ["bad": Date()]], profile: profileA, baseDirectory: base)
check(invalid["ok"] as? Bool == false && (invalid["error"] as? String)?.contains("不是有效的 JSON") == true, "非 JSON 內容回報錯誤")

let store = BookmarkBackupStore(baseDirectory: base, profile: profileA)
for day in 0..<35 {
    _ = try store.write(backup, now: Date(timeIntervalSince1970: 1_790_000_000 + Double(day) * 86_400))
}
let files = try FileManager.default.contentsOfDirectory(atPath: store.directory.path)
let history = files.filter { $0.hasPrefix("backup-") }.sorted()
check(history.count == BookmarkBackupStore.historyLimit, "每日備份最多保留 30 份（實際 \(history.count)）")
check(history.last == "backup-\(BookmarkBackupStore.dayStamp(Date(timeIntervalSince1970: 1_790_000_000 + 34 * 86_400))).json", "保留的是最新的 30 天")
check(files.contains("latest.json"), "latest.json 仍在")

try? FileManager.default.removeItem(at: base)
print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
