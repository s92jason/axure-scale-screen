#!/usr/bin/env bash
set -euo pipefail

APP_NAME=${1:-AxureScaleScreen}
BUNDLE_ID=${2:-com.example.axurescalescreen}
OUTPUT_DIR=${3:-safari-app}
PROJECT_DIR="$OUTPUT_DIR/$APP_NAME"
EXTENSION_ID="$BUNDLE_ID.Extension"

if [[ ! -d "dist" ]]; then
  echo "找不到 dist/，請先執行 npm run build。" >&2
  exit 1
fi

# Xcode 專案直接引用 dist/，只需轉換一次。重新產生專案會讓 Safari 把外掛當成重新安裝，
# 並清除外掛的儲存資料（書籤、分組、縮放記錄），所以已有專案時一律停止。
if [[ -d "$PROJECT_DIR" ]]; then
  cat >&2 <<EOF
已有 Safari Xcode 專案：$PROJECT_DIR
專案直接引用 dist/，更新外掛只需要：
  1. npm run build
  2. 在 Xcode 按 Run
不要重新產生專案：Safari 可能會清除外掛資料（包含所有書籤）。
EOF
  exit 1
fi

# 專案資料夾不在、但 Safari 仍登記著這個外掛：多半是手動刪掉專案想重建，同樣會清資料。
if [[ "${ALLOW_REGENERATE:-}" != "1" ]] &&
  pluginkit -m -i "$EXTENSION_ID" 2>/dev/null | grep -qF "$EXTENSION_ID"; then
  cat >&2 <<EOF
Safari 已安裝這個外掛（$EXTENSION_ID）。
重新產生專案可能讓 Safari 清除外掛資料（包含所有書籤）。
請先到「管理書籤」頁按「匯出備份（JSON）」，確認備份檔存在後再執行：
  ALLOW_REGENERATE=1 $0 $*
EOF
  exit 1
fi

xcrun safari-web-extension-converter dist \
  --project-location "$OUTPUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift

echo "已建立 Safari App 專案：$OUTPUT_DIR"
echo "之後更新外掛只需要 npm run build，再到 Xcode 按 Run；不要再重新執行這個腳本。"
