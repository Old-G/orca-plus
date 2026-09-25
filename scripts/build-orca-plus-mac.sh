#!/usr/bin/env bash
# Builds Orca Plus.app (shown as "Orca+") for this Mac's architecture into dist/ (not notarized).
#
#   scripts/build-orca-plus-mac.sh          dist/mac-<arch>/Orca Plus.app only
#   scripts/build-orca-plus-mac.sh --dmg    also a .dmg next to it
#
# ORCA_PLUS_PACKAGING=1 switches electron-builder to Orca+'s identity (bundle id, name, URL
# scheme, release repo); without it the config builds stock Orca.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
target=dir
[ "${1:-}" = "--dmg" ] && target=dmg
arch=$(uname -m)
[ "$arch" = "x86_64" ] && arch=x64

# Why: older Node lacks node:sqlite in builtinModules, so the packaged-deps guard rejects the bundle late.
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 24 ]; then
  echo "build-orca-plus-mac: needs Node 24+ (package.json engines), found $(node --version) at $(command -v node)" >&2
  exit 1
fi

export ORCA_PLUS_PACKAGING=1
export CSC_IDENTITY_AUTO_DISCOVERY=false
# Why: an ad-hoc signature's designated requirement is its cdhash, so macOS drops every
# privacy grant (Desktop, Full Disk Access, Accessibility) on each rebuild. A stable local
# certificate keeps them. Create it once with scripts/orca-plus-signing-cert.sh.
signing_identity="Orca+ Local Signing"
if security find-identity -v -p codesigning | grep -qF "\"$signing_identity\""; then
  mac_identity="$signing_identity"
else
  echo "build-orca-plus-mac: no trusted \"$signing_identity\" certificate; signing ad hoc (privacy grants reset on every rebuild)" >&2
  mac_identity=-
fi
export ORCA_COMPUTER_MACOS_SIGN_IDENTITY="$mac_identity"
# Why: stock Orca's helper owns com.stablyai.orca.computer-use in TCC; sharing it would let
# Orca+'s grants and permission resets overwrite the stock helper's.
export ORCA_COMPUTER_MACOS_BUNDLE_ID=com.oldg.orca-plus.computer-use
export ORCA_COMPUTER_MACOS_DISPLAY_NAME="Orca+ Computer Use"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Why: upstream main never bumps package.json (release tags live on release branches), so About
# would claim a months-old version; number the build after the newest upstream release instead.
ORCA_LOCAL_BUILD_VERSION=$(node config/scripts/orca-plus-build-version.mjs)
export ORCA_LOCAL_BUILD_VERSION
echo "build-orca-plus-mac: version $ORCA_LOCAL_BUILD_VERSION"

# Why: build:desktop bundles the mobile web app, and mobile/ is its own pnpm project.
if [ ! -d mobile/node_modules/expo-router ]; then
  (cd mobile && corepack pnpm install --frozen-lockfile)
fi
corepack pnpm run build:desktop
corepack pnpm run build:computer-macos
corepack pnpm run build:keyboard-layout-macos
# Why: the helper answers notification-permission checks for the app's own bundle id.
node config/scripts/build-notification-status-macos.mjs --bundle-id com.oldg.orca-plus
corepack pnpm run ensure:electron-runtime
# Why electronDist: the installed Electron is the same version; skipping the download avoids
# flaky networks. Without a certificate, identity "-" still gives the bundle a valid signature.
# Why timestamp none: a local build needs no secure timestamp, and fetching one per file from
# Apple added ~10 minutes to every signed build.
corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac "$target" "--$arch" \
  -c.electronDist=node_modules/electron/dist "-c.mac.identity=$mac_identity" -c.mac.timestamp=none
echo "build-orca-plus-mac: $(ls -d dist/mac*/"Orca Plus.app" 2>/dev/null | head -1)"
