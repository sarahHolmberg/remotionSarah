#!/usr/bin/env bash
# setup.sh  (path: project root)
# NEW FILE (to be created)
#
# Installs everything the Remotion project needs on a fresh Linux machine / Codespace:
#   1. system packages (browser libraries for rendering, emoji font, ffmpeg)
#   2. npm packages (Remotion, the GUI, TypeScript), all Remotion packages on the SAME version
#   3. the browser Remotion renders with
# Run from the project folder:  bash setup.sh

set -euo pipefail
log() { echo "[setup] $*"; }

# --- 1. system packages ---
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"
log "installing system packages (needs the network, takes a minute)"
$SUDO apt-get update
ASOUND="libasound2" # newer Ubuntu (24.04) renamed it
apt-cache show libasound2t64 >/dev/null 2>&1 && ASOUND="libasound2t64"
log "sound library package: $ASOUND"
$SUDO apt-get install -y \
  libnss3 libdbus-1-3 libatk1.0-0 "$ASOUND" libxrandr2 libxkbcommon-dev \
  libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 \
  fonts-noto-color-emoji ffmpeg

# --- 2. npm packages ---
log "node $(node --version), npm $(npm --version)"
[ -f package.json ] || { log "no package.json here, creating one"; npm init -y >/dev/null; }

# newest 4.x (the code in this project is written for Remotion 4); --json gives one version or a list, the last one is the newest
REMOTION_VERSION="$(npm view 'remotion@^4' version --json | node -p "[].concat(JSON.parse(require('fs').readFileSync(0,'utf8'))).pop()")"
[[ "$REMOTION_VERSION" =~ ^4\.[0-9]+\.[0-9]+$ ]] || { log "could not read the Remotion version (got: $REMOTION_VERSION)"; exit 1; }
log "Remotion version used for every @remotion package: $REMOTION_VERSION"

npm install \
  "remotion@$REMOTION_VERSION" \
  "@remotion/cli@$REMOTION_VERSION" \
  "@remotion/player@$REMOTION_VERSION" \
  "@remotion/media-utils@$REMOTION_VERSION" \
  "@remotion/google-fonts@$REMOTION_VERSION" \
  react@^18.3.1 react-dom@^18.3.1

npm install --save-dev \
  typescript@^5.4.0 @types/react@^18.3.0 @types/react-dom@^18.3.0 \
  vite@^5.4.0 @vitejs/plugin-react@^4.3.0

# --- 3. the browser Remotion renders with ---
log "downloading the render browser"
npx remotion browser ensure

log "done. installed Remotion packages:"
npm ls remotion @remotion/cli @remotion/player @remotion/media-utils @remotion/google-fonts --depth=0 || true
log "next: npm start (Remotion Studio, port 3000) or npm run app (the two-tab GUI, port 5173)"