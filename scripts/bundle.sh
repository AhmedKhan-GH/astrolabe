#!/usr/bin/env bash
# Builds "Astrolabe.app" into ${CARGO_TARGET_DIR:-target}/bundle.
#
# Usage: scripts/bundle.sh [cargo build arguments...]
set -euo pipefail

cd "$(dirname "$0")/.."

icon_svg="docs-theme/assets/astrolabe-icon-minerals.svg"
if [[ ! -f "$icon_svg" ]]; then
  echo "error: icon source not found: $icon_svg" >&2
  exit 1
fi

version=$(awk -F'"' '/^\[workspace\.package\]/{p=1;next} /^\[/{p=0} p && /^[[:space:]]*version[[:space:]]*=/{print $2; exit}' Cargo.toml)
if [[ -z "$version" ]]; then
  echo "error: could not read [workspace.package] version from Cargo.toml" >&2
  exit 1
fi

nice -n 10 cargo build --release -j 8 -p astrolabe --bin astrolabe "$@"

target_dir="${CARGO_TARGET_DIR:-target}"
bundle_dir="$target_dir/bundle"
app="$bundle_dir/Astrolabe.app"
work_dir="$bundle_dir/.icon-work"

rm -rf "$app" "$work_dir"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$work_dir/scratch"
work_dir="$(cd "$work_dir" && pwd)"
trap 'rm -rf "$work_dir"' EXIT
export TMPDIR="$work_dir/scratch"

cp "$target_dir/release/astrolabe" "$app/Contents/MacOS/astrolabe"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.astrolabe</string>
  <key>CFBundleName</key><string>Astrolabe</string>
  <key>CFBundleDisplayName</key><string>Astrolabe</string>
  <key>CFBundleExecutable</key><string>astrolabe</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist"

# Icon: docs-theme/assets/astrolabe-icon-minerals.svg -> AppIcon.icns
master_png="$work_dir/AppIcon-1024.png"
if command -v resvg >/dev/null 2>&1; then
  resvg -w 1024 -h 1024 "$icon_svg" "$master_png"
elif command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1024 -h 1024 "$icon_svg" -o "$master_png"
else
  # sips preserves RGBA alpha transparency and all gradients cleanly; CoreSVG
  # logs a non-fatal warning for unsupported <feMerge> drop-shadow filters.
  # qlmanage renders <feMerge> but flattens onto an opaque white square.
  sips -s format png -z 1024 1024 "$icon_svg" --out "$master_png" >/dev/null 2>&1 || {
    sips -s format png -z 1024 1024 "$icon_svg" --out "$master_png"
    exit 1
  }
fi

iconset="$work_dir/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$master_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$master_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$app"
codesign --verify --verbose "$app"

echo "Built: $app"
