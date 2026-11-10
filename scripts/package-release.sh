#!/usr/bin/env bash
# Builds the macOS DMG and the Chrome extension ZIP for a GitHub release.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$DIR/dist"
VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$DIR/manifest.json")"

if [[ -z "$VERSION" ]]; then
  echo "manifest.json has no version" >&2
  exit 1
fi

APP_NAME="TranscribeThem.app"
EXT_DIR_NAME="TranscribeThem"
DMG="$DIST/TranscribeThem-${VERSION}.dmg"
ZIP="$DIST/TranscribeThem-extension-${VERSION}.zip"
RAW="$DIST/TranscribeThem-${VERSION}-readwrite.dmg"

read_me() {
  cat <<'EOF'
TranscribeThem

The Chrome extension works independently with Whisper. The Mac app is optional.
See INSTALLATION.md for the complete guide and third-party notices for licenses.

Chrome extension
1. Unzip the archive and open chrome://extensions.
2. Enable Developer mode, choose Load unpacked, and select the extracted folder.
3. Reload WhatsApp Web and X tabs after installing or updating.

Mac app (Apple Silicon, macOS 14+)
1. Open the DMG and drag TranscribeThem to Applications.
2. The app is not notarized. If blocked, use System Settings > Privacy & Security > Open Anyway.
3. Choose your language in Settings and your model in Engine & Models.
4. Optional full transcript history can be enabled and cleared in Settings.

EOF
}

echo "Building extension ${VERSION}..."
(cd "$DIR" && npm run build)

rm -rf "$DIST"
mkdir -p "$DIST/ext-root/$EXT_DIR_NAME" "$DIST/dmg-root"

cp "$DIR/manifest.json" "$DIST/ext-root/$EXT_DIR_NAME/"
cp -R "$DIR/src" "$DIR/vendor" "$DIR/_locales" "$DIST/ext-root/$EXT_DIR_NAME/"
mkdir -p "$DIST/ext-root/$EXT_DIR_NAME/icons"
cp "$DIR/icons/icon16.png" "$DIR/icons/icon32.png" "$DIR/icons/icon48.png" "$DIR/icons/icon128.png" "$DIST/ext-root/$EXT_DIR_NAME/icons/"
find "$DIST/ext-root" -name '*.map' -delete
find "$DIST/ext-root" -name '.DS_Store' -delete
read_me > "$DIST/ext-root/$EXT_DIR_NAME/LEEME.txt"
cp "$DIR/docs/INSTALLATION.md" "$DIR/LICENSE" "$DIR/THIRD_PARTY_NOTICES.md" "$DIST/ext-root/$EXT_DIR_NAME/"
cp -R "$DIR/third-party-licenses" "$DIST/ext-root/$EXT_DIR_NAME/"

rm -f "$ZIP"
find "$DIST/ext-root" -name '._*' -delete
# --norsrc keeps AppleDouble files out of the ZIP Chrome loads unpacked.
COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent "$DIST/ext-root/$EXT_DIR_NAME" "$ZIP"
unzip -t "$ZIP" >/dev/null
unzip -l "$ZIP" > "$DIST/extension-zip-list.txt"
grep -q "manifest.json" "$DIST/extension-zip-list.txt"
rm -f "$DIST/extension-zip-list.txt"

echo "Building app..."
"$DIR/scripts/package-companion.sh"
APP_SRC="$DIR/companion/build/$APP_NAME"
if [[ ! -d "$APP_SRC" ]]; then
  echo "App bundle missing at $APP_SRC" >&2
  exit 1
fi

# Ad-hoc signature so the bundle is intact. It is not an Apple Developer ID
# signature, so Gatekeeper still asks the user to open it manually.
codesign --force --deep --sign - "$APP_SRC"
codesign --verify --strict "$APP_SRC"

cp -R "$APP_SRC" "$DIST/dmg-root/$APP_NAME"
read_me > "$DIST/dmg-root/.LEEME.txt"
mkdir -p "$DIST/dmg-root/.background"
swift "$DIR/scripts/dmg-background.swift" "$DIST/dmg-root/.background/installer.png"

rm -f "$RAW" "$DMG"
hdiutil create \
  -volname "Install TranscribeThem" \
  -fs HFS+ \
  -srcfolder "$DIST/dmg-root" \
  -ov \
  -format UDRW \
  "$RAW"

ATTACH="$(hdiutil attach -readwrite -noverify -noautoopen "$RAW")"
MOUNT="$(printf '%s\n' "$ATTACH" | sed -n 's/.*\(\/Volumes\/.*\)/\1/p' | tail -1)"
if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  echo "Could not mount $RAW" >&2
  echo "$ATTACH" >&2
  exit 1
fi

cleanup_mount() {
  if [[ -n "${MOUNT:-}" && -d "$MOUNT" ]]; then
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || hdiutil detach -force "$MOUNT" >/dev/null 2>&1 || true
  fi
}
trap cleanup_mount EXIT

ln -s /Applications "$MOUNT/Applications"
if [[ ! -L "$MOUNT/Applications" ]]; then
  echo "Refusing to leave a real Applications folder inside the disk image" >&2
  exit 1
fi

DMG_TOOLS="$DIR/companion/build/dmg-tools"
python3 -m venv "$DMG_TOOLS"
"$DMG_TOOLS/bin/pip" install --disable-pip-version-check -q -r "$DIR/scripts/dmg-requirements.txt"
"$DMG_TOOLS/bin/python" "$DIR/scripts/layout-dmg.py" "$MOUNT"
sync
hdiutil detach "$MOUNT"
MOUNT=""
trap - EXIT

python3 "$DIR/scripts/dmg-autoopen.py" "$RAW"

hdiutil convert "$RAW" -format UDZO -ov -o "$DMG"
rm -f "$RAW"
rm -rf "$DIST/ext-root" "$DIST/dmg-root"

echo "Release files:"
echo "$DMG"
echo "$ZIP"
ls -lh "$DMG" "$ZIP"
