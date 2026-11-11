#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPANION_DIR="$DIR/companion"
BUILD_DIR="$COMPANION_DIR/build"
APP_NAME="TranscribeThem.app"
APP_BUNDLE="$BUILD_DIR/$APP_NAME"
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$DIR/manifest.json")"

if [[ -z "$VERSION" ]]; then
  echo "manifest.json has no version" >&2
  exit 1
fi

if [[ ! -f "$DIR/icons/AppIcon.icns" ]]; then
  echo "Missing app icon. Run npm run icons first." >&2
  exit 1
fi

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
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP_BUNDLE/Contents/Info.plist"
echo "Stamped companion version $VERSION"
# The update channel follows manifest.json "homepage_url": only a build whose
# manifest points at a GitHub repository looks for updates there. Private and
# development builds have no homepage_url and never check.
UPDATE_REPO="$(node -e "const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); const r = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)\/?$/.exec(m.homepage_url || ''); process.stdout.write(r ? r[1] : '')" "$DIR/manifest.json")"
if [[ -n "$UPDATE_REPO" ]]; then
  /usr/libexec/PlistBuddy -c "Add :TTUpdateRepo string $UPDATE_REPO" "$APP_BUNDLE/Contents/Info.plist"
  echo "Update channel: github.com/$UPDATE_REPO"
else
  echo "No update channel (manifest.json has no GitHub homepage_url)"
fi
cp -R "$COMPANION_DIR/Resources/en.lproj" "$COMPANION_DIR/Resources/es.lproj" "$APP_BUNDLE/Contents/Resources/"
cp "$DIR/icons/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/"
cp "$DIR/icons/MenuBarTemplate.png" "$DIR/icons/MenuBarTemplate@2x.png" "$APP_BUNDLE/Contents/Resources/"

echo "TranscribeThem.app created successfully at:"
echo "$APP_BUNDLE"

# Include SwiftPM resources and redistribution notices in the app bundle.
for resource in "$BIN_DIR"/*.bundle; do
  [[ -d "$resource" ]] && cp -R "$resource" "$APP_BUNDLE/Contents/Resources/"
done
cp "$DIR/LICENSE" "$DIR/THIRD_PARTY_NOTICES.md" "$APP_BUNDLE/Contents/Resources/"
cp -R "$DIR/third-party-licenses" "$APP_BUNDLE/Contents/Resources/"
