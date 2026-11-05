#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPANION_DIR="$DIR/companion"
BUILD_DIR="$COMPANION_DIR/build"
APP_NAME="TranscribeThem.app"
APP_BUNDLE="$BUILD_DIR/$APP_NAME"

echo "Building release binary with Swift..."
(cd "$COMPANION_DIR" && swift build -c release)
BIN_DIR="$(cd "$COMPANION_DIR" && swift build -c release --show-bin-path)"

echo "Creating App Bundle at $APP_BUNDLE..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BIN_DIR/WACompanion" "$APP_BUNDLE/Contents/MacOS/WACompanion"
chmod +x "$APP_BUNDLE/Contents/MacOS/WACompanion"
cp "$COMPANION_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

echo "TranscribeThem.app created successfully at:"
echo "$APP_BUNDLE"

# Include SwiftPM resources and redistribution notices in the app bundle.
for resource in "$BIN_DIR"/*.bundle; do
  [[ -d "$resource" ]] && cp -R "$resource" "$APP_BUNDLE/Contents/Resources/"
done
cp "$DIR/LICENSE" "$DIR/THIRD_PARTY_NOTICES.md" "$APP_BUNDLE/Contents/Resources/"
cp -R "$DIR/third-party-licenses" "$APP_BUNDLE/Contents/Resources/"
