#!/usr/bin/env bash
# Renders Orca+'s app icons: the stock Orca icon with a small "+" badge, so the two apps
# stay apart in the Dock. Rerun after upstream changes resources/build/icon.png.
#
#   resources/icon-source/orca-plus/generate-orca-plus-icons.sh
#
# Writes resources/orca-plus/icon.icns (bundle icon) and icon.png (live Dock icon, 256 px).
# Needs rsvg-convert (brew install librsvg) and macOS iconutil.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
out=resources/orca-plus
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

stock_png=$(base64 <resources/build/icon.png | tr -d '\n')
cat >"$work/icon.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#c9c9c9"/>
    </linearGradient>
  </defs>
  <image width="1024" height="1024" xlink:href="data:image/png;base64,${stock_png}"/>
  <circle cx="812" cy="812" r="124" fill="#000" opacity="0.35"/>
  <circle cx="812" cy="808" r="112" fill="url(#silver)" stroke="#1a1a1a" stroke-width="8"/>
  <path d="M812 744 V872 M748 808 H876" stroke="#111" stroke-width="32" stroke-linecap="round"/>
</svg>
SVG

iconset="$work/icon.iconset"
mkdir "$iconset"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$work/icon.svg" -o "$iconset/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) "$work/icon.svg" -o "$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o "$out/icon.icns"
cp "$iconset/icon_256x256.png" "$out/icon.png"
echo "generate-orca-plus-icons: wrote $out/icon.icns and $out/icon.png"
