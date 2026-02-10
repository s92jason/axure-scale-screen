#!/usr/bin/env bash
set -euo pipefail

APP_NAME=${1:-AxureScaleScreen}
BUNDLE_ID=${2:-com.example.axurescalescreen}
OUTPUT_DIR=${3:-safari-app}

if [[ ! -d "dist" ]]; then
  echo "找不到 dist/，請先執行 npm run build。" >&2
  exit 1
fi

xcrun safari-web-extension-converter dist \
  --project-location "$OUTPUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift

echo "已建立 Safari App 專案：$OUTPUT_DIR"
