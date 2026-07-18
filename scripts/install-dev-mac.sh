#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "dev:install:mac only runs on macOS" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="cool.astrolabe.app"
APP_NAME="Astrolabe.app"
INSTALL_ROOT="${ASTROLABE_INSTALL_DIR:-/Applications}"
DEST="$INSTALL_ROOT/$APP_NAME"

case "$(uname -m)" in
  arm64) BUILD="$ROOT/dist/mac-arm64/$APP_NAME" ;;
  x86_64) BUILD="$ROOT/dist/mac/$APP_NAME" ;;
  *)
    echo "unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

requirement() {
  codesign -d -r- "$1" 2>&1 | sed -n 's/^designated => //p'
}

echo "Building and signing the development app..."
cd "$ROOT"
pnpm package:dir

if [[ ! -d "$BUILD" ]]; then
  echo "packaged app not found at $BUILD" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUILD/Contents/Info.plist")"
if [[ "$BUNDLE_ID" != "$APP_ID" ]]; then
  echo "refusing to install unexpected bundle id: $BUNDLE_ID" >&2
  exit 1
fi

codesign --verify --deep --strict "$BUILD"
if codesign -dv "$BUILD" 2>&1 | grep -q '^Signature=adhoc$'; then
  echo "refusing to install an ad-hoc signed build; configure a stable signing identity" >&2
  exit 1
fi

NEW_REQUIREMENT="$(requirement "$BUILD")"
if [[ -z "$NEW_REQUIREMENT" ]]; then
  echo "could not read the packaged app's designated requirement" >&2
  exit 1
fi

if [[ -d "$DEST" ]]; then
  OLD_REQUIREMENT="$(requirement "$DEST")"
  if [[ "$OLD_REQUIREMENT" != "$NEW_REQUIREMENT" && "${ASTROLABE_ALLOW_IDENTITY_CHANGE:-0}" != "1" ]]; then
    echo "refusing to replace Astrolabe with a different signing identity" >&2
    echo "old: $OLD_REQUIREMENT" >&2
    echo "new: $NEW_REQUIREMENT" >&2
    echo "Set ASTROLABE_ALLOW_IDENTITY_CHANGE=1 only for an intentional certificate migration." >&2
    echo "macOS permissions will need to be granted again after a migration." >&2
    exit 1
  fi
fi

mkdir -p "$INSTALL_ROOT"
if [[ ! -w "$INSTALL_ROOT" ]]; then
  echo "$INSTALL_ROOT is not writable" >&2
  echo "Use ASTROLABE_INSTALL_DIR=\"$HOME/Applications\" or fix directory permissions." >&2
  exit 1
fi

STAGE="$INSTALL_ROOT/.Astrolabe.app.stage.$$"
BACKUP="$INSTALL_ROOT/.Astrolabe.app.backup.$$"
trap 'rm -rf -- "$STAGE"' EXIT

rm -rf -- "$STAGE" "$BACKUP"
ditto "$BUILD" "$STAGE"
codesign --verify --deep --strict "$STAGE"

osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
for _ in {1..50}; do
  if ! pgrep -f "$DEST/Contents/MacOS/Astrolabe" >/dev/null; then
    break
  fi
  sleep 0.1
done
if pgrep -f "$DEST/Contents/MacOS/Astrolabe" >/dev/null; then
  echo "Astrolabe did not quit; close it and run the command again" >&2
  exit 1
fi

if [[ -d "$DEST" ]]; then
  mv "$DEST" "$BACKUP"
fi

if ! mv "$STAGE" "$DEST"; then
  [[ -d "$BACKUP" ]] && mv "$BACKUP" "$DEST"
  echo "failed to install the new app; restored the previous app" >&2
  exit 1
fi

if ! codesign --verify --deep --strict "$DEST"; then
  rm -rf -- "$DEST"
  [[ -d "$BACKUP" ]] && mv "$BACKUP" "$DEST"
  echo "installed app failed signature verification; restored the previous app" >&2
  exit 1
fi

rm -rf -- "$BACKUP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
open "$DEST"

echo "Installed and launched $DEST"
echo "Designated requirement: $NEW_REQUIREMENT"
