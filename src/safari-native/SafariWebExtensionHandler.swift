//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  版控來源：src/safari-native/SafariWebExtensionHandler.swift
//  npm run build 會把這個檔案同步到 safari-app/AxureScaleScreen/Shared (Extension)/，
//  不要直接改 safari-app 裡的副本。
//

import Foundation
import SafariServices
import os.log

// 書籤自動備份：外掛透過 browser.runtime.sendNativeMessage 送來完整備份，寫進這個 App Extension
// 自己的沙盒容器（~/Library/Containers/<extension bundle id>/Data/Library/Application Support/
// AxureScaleScreen/Backups/<Safari 設定檔>/）。Safari 把外掛當成重新安裝時會清掉外掛的 storage，
// 但不會動這個容器，所以這裡的檔案能拿來還原。
struct BookmarkBackupStore {
    static let historyLimit = 30

    let directory: URL

    init(baseDirectory: URL, profile: UUID?) {
        directory = baseDirectory
            .appendingPathComponent("AxureScaleScreen", isDirectory: true)
            .appendingPathComponent("Backups", isDirectory: true)
            .appendingPathComponent(profile?.uuidString ?? "default", isDirectory: true)
    }

    private var latestURL: URL {
        directory.appendingPathComponent("latest.json")
    }

    // latest.json 永遠是最新一份；另外每天留一份 backup-yyyyMMdd.json，最多保留 30 天，
    // 就算 latest.json 被較少的資料覆蓋，也還能從前幾天的檔案救回。
    func write(_ backup: [String: Any], now: Date = Date()) throws -> Date {
        guard JSONSerialization.isValidJSONObject(backup) else {
            throw StoreError.invalidBackup
        }
        let data = try JSONSerialization.data(withJSONObject: backup, options: [.prettyPrinted, .sortedKeys])
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: latestURL, options: .atomic)
        try data.write(to: directory.appendingPathComponent("backup-\(Self.dayStamp(now)).json"), options: .atomic)
        try pruneHistory()
        return now
    }

    func readLatest() throws -> (backup: [String: Any], savedAt: Date)? {
        guard FileManager.default.fileExists(atPath: latestURL.path) else {
            return nil
        }
        let data = try Data(contentsOf: latestURL)
        guard let backup = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StoreError.invalidBackup
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: latestURL.path)
        return (backup, attributes[.modificationDate] as? Date ?? Date())
    }

    private func pruneHistory() throws {
        // yyyyMMdd 的字典序就是時間序，由新到舊排序後刪掉超出上限的舊檔。
        let history = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasPrefix("backup-") && $0.hasSuffix(".json") }
            .sorted(by: >)
        for name in history.dropFirst(Self.historyLimit) {
            try FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    static func dayStamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd"
        return formatter.string(from: date)
    }

    enum StoreError: LocalizedError {
        case invalidBackup

        var errorDescription: String? {
            "備份內容不是有效的 JSON 物件。"
        }
    }
}

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let reply = handle(message, profile: profile)

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: reply ]
        } else {
            response.userInfo = [ "message": reply ]
        }

        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

    // 協定(與 src/background/native-backup.ts 一致)：
    //   { type: "backup.write", backup }  → { ok: true, savedAt }
    //   { type: "backup.read" }           → { ok: true, backup | null, savedAt | null }
    //   失敗                               → { ok: false, error }
    func handle(_ message: Any?, profile: UUID?, baseDirectory: URL? = nil) -> [String: Any] {
        guard let base = baseDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return [ "ok": false, "error": "找不到 Application Support 資料夾。" ]
        }
        let store = BookmarkBackupStore(baseDirectory: base, profile: profile)
        let body = message as? [String: Any]

        do {
            switch body?["type"] as? String {
            case "backup.write":
                guard let backup = body?["backup"] as? [String: Any] else {
                    return [ "ok": false, "error": "缺少備份內容。" ]
                }
                let savedAt = try store.write(backup)
                return [ "ok": true, "savedAt": Self.milliseconds(savedAt) ]
            case "backup.read":
                guard let latest = try store.readLatest() else {
                    return [ "ok": true, "backup": NSNull(), "savedAt": NSNull() ]
                }
                return [ "ok": true, "backup": latest.backup, "savedAt": Self.milliseconds(latest.savedAt) ]
            default:
                return [ "ok": false, "error": "不支援的訊息：\(String(describing: body?["type"]))" ]
            }
        } catch {
            os_log(.error, "Axure bookmark backup failed: %{public}@", error.localizedDescription)
            return [ "ok": false, "error": error.localizedDescription ]
        }
    }

    private static func milliseconds(_ date: Date) -> Double {
        (date.timeIntervalSince1970 * 1000).rounded()
    }

}
