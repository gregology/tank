#!/usr/bin/env bash
# Installs Tanked on the Steam Machine (or any Linux PC) and adds it to Steam.
# Run it from the unpacked folder:   ./install.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/Games/tanked"
DESKTOP_FILE="${HOME}/.local/share/applications/tanked.desktop"

if pgrep -f "${DEST}/electron/electron" >/dev/null 2>&1; then
	echo "Tanked is running. Quit it first (Steam button > Exit game), then run this again." >&2
	exit 1
fi

# Replace these folders rather than copy over them, so nothing from an old build
# survives. They hold no player data: that lives in ~/.local/share/tanked.
rm -rf "${DEST}/electron" "${DEST}/artwork"
mkdir -p "${DEST}"
cp -r "${HERE}/electron" "${HERE}/artwork" "${DEST}/"
cp "${HERE}/tanked.sh" "${HERE}/steam_artwork.py" "${HERE}/VERSION" "${DEST}/"
chmod +x "${DEST}/tanked.sh"

mkdir -p "$(dirname "${DESKTOP_FILE}")"
cat >"${DESKTOP_FILE}" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Tanked
Comment=Split-screen isometric tank battles
Exec=${DEST}/tanked.sh
Path=${DEST}
Icon=${DEST}/artwork/icon.png
Categories=Game;
DESKTOP

echo "Installed Tanked $(cat "${DEST}/VERSION") to ${DEST}"

# Steam takes a moment to record a newly added game, and the artwork needs its ID.
ARTWORK_WAIT_SECONDS=0

# SteamOS ships a helper that adds a non-Steam game to the library (Steam must be running).
if command -v steamos-add-to-steam >/dev/null 2>&1; then
	if grep -qs "${DEST}/tanked.sh" "${HOME}"/.local/share/Steam/userdata/*/config/shortcuts.vdf; then
		echo "Tanked is already in your Steam library."
	else
		steamos-add-to-steam "${DESKTOP_FILE}"
		echo "Added to Steam: look under Library > Non-Steam."
		ARTWORK_WAIT_SECONDS=20
	fi
else
	echo "Now add it to Steam: Steam > Games > Add a Non-Steam Game to My Library > Tanked"
fi

# Artwork is decoration: a problem with it must not fail the install.
python3 "${DEST}/steam_artwork.py" "${DEST}/artwork" "${DEST}/tanked.sh" "${ARTWORK_WAIT_SECONDS}" || true
