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

La extensión funciona sola con Whisper; la app para Mac es opcional y usa Parakeet.
Chrome Web Store todavía no publica la extensión.

Extensión
1. Descomprimí el ZIP.
2. En Chrome abrí chrome://extensions
3. Activá Modo de desarrollador.
4. Cargar descomprimida y elegí la carpeta que tiene manifest.json.
5. Abrí https://web.whatsapp.com o https://x.com/i/chat y recargá la pestaña.
6. En una nota de voz, tocá Transcribir. En X aparece al pasar el cursor junto a las acciones del audio.
7. Después de actualizar la extensión, recargá también las pestañas de WhatsApp y X.

App para Mac (Apple Silicon, macOS 14 o más nuevo)
1. Abrí el DMG y arrastrá TranscribeThem a Aplicaciones.
2. La app no está notarizada. Si macOS la bloquea, revisá Configuración del Sistema > Privacidad y seguridad > Abrir de todos modos.
3. Queda en la barra de menú. La primera vez baja el modelo en esta Mac.

La ventana de la app muestra el estado. No tiene un tutorial adentro.
EOF
}

echo "Building extension ${VERSION}..."
(cd "$DIR" && npm run build)

rm -rf "$DIST"
mkdir -p "$DIST/ext-root/$EXT_DIR_NAME" "$DIST/dmg-root"

cp "$DIR/manifest.json" "$DIST/ext-root/$EXT_DIR_NAME/"
cp -R "$DIR/icons" "$DIR/src" "$DIR/vendor" "$DIST/ext-root/$EXT_DIR_NAME/"
find "$DIST/ext-root" -name '*.map' -delete
find "$DIST/ext-root" -name '.DS_Store' -delete
read_me > "$DIST/ext-root/$EXT_DIR_NAME/LEEME.txt"
cp "$DIR/docs/INSTALLATION.md" "$DIST/ext-root/$EXT_DIR_NAME/INSTALLATION.md"
cp "$DIR/LICENSE" "$DIR/THIRD_PARTY_NOTICES.md" "$DIST/ext-root/$EXT_DIR_NAME/"
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
read_me > "$DIST/dmg-root/LEEME.txt"
cp "$DIR/docs/INSTALLATION.md" "$DIST/dmg-root/INSTALLATION.md"
cp "$DIR/LICENSE" "$DIR/THIRD_PARTY_NOTICES.md" "$DIST/dmg-root/"
cp -R "$DIR/third-party-licenses" "$DIST/dmg-root/"

rm -f "$RAW" "$DMG"
hdiutil create \
  -volname "TranscribeThem" \
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

hdiutil detach "$MOUNT"
MOUNT=""
trap - EXIT

hdiutil convert "$RAW" -format UDZO -ov -o "$DMG"
rm -f "$RAW"
rm -rf "$DIST/ext-root" "$DIST/dmg-root"

echo "Release files:"
echo "$DMG"
echo "$ZIP"
ls -lh "$DMG" "$ZIP"
