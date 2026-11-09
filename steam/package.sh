#!/usr/bin/env bash
# Builds build/tanked-<version>-linux-x64.tar.gz: Electron, the game and the installer.
# Usage: steam/package.sh [version]     (default: test-MMDD-HHMM)
set -euo pipefail

ELECTRON_VERSION="45.2.3"
ELECTRON_SHA256="a87fe741f6d121285117e574da6c9a2e65210d410123bbc04713b099add0263b"
ELECTRON_ZIP="electron-v${ELECTRON_VERSION}-linux-x64.zip"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-test-$(date +%m%d-%H%M)}"
CACHE="${XDG_CACHE_HOME:-${HOME}/.cache}/tanked-steam"
STAGE="${REPO}/build/stage/tanked"
ARCHIVE="${REPO}/build/tanked-${VERSION}-linux-x64.tar.gz"

mkdir -p "${CACHE}"
if [ ! -f "${CACHE}/${ELECTRON_ZIP}" ]; then
	curl -fL --retry 3 -o "${CACHE}/${ELECTRON_ZIP}.part" \
		"https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${ELECTRON_ZIP}"
	mv "${CACHE}/${ELECTRON_ZIP}.part" "${CACHE}/${ELECTRON_ZIP}"
fi
echo "${ELECTRON_SHA256}  ${CACHE}/${ELECTRON_ZIP}" | sha256sum -c --quiet -

rm -rf "${STAGE}"
mkdir -p "${STAGE}/electron"
python3 -m zipfile -e "${CACHE}/${ELECTRON_ZIP}" "${STAGE}/electron"
# Python's zipfile drops the executable bits Electron's files need.
find "${STAGE}/electron" -maxdepth 1 -type f -exec chmod +x {} +

APP="${STAGE}/electron/resources/app"
mkdir -p "${APP}"
cp -r "${REPO}/index.html" "${REPO}/css" "${REPO}/js" "${REPO}/electron" "${APP}/"
cat >"${APP}/package.json" <<JSON
{
  "name": "tanked",
  "productName": "Tanked",
  "version": "0.0.0-${VERSION}",
  "type": "module",
  "main": "electron/main.js"
}
JSON

cp "${REPO}/steam/tanked.sh" "${REPO}/steam/install.sh" "${REPO}/steam/steam_artwork.py" "${STAGE}/"
cp -r "${REPO}/steam/artwork" "${STAGE}/"
chmod +x "${STAGE}/tanked.sh" "${STAGE}/install.sh"
echo "${VERSION}" >"${STAGE}/VERSION"

tar -czf "${ARCHIVE}" -C "$(dirname "${STAGE}")" tanked
rm -rf "$(dirname "${STAGE}")"
echo "${ARCHIVE}"
