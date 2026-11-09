#!/bin/sh
# Starts Tanked. Steam launches this through its shortcut.
#
# Steam preloads its overlay library into every launch. With it loaded, Chromium's
# zygote dies at startup ("Zygote process exited prematurely"). Dropping the preload
# keeps Chromium's sandbox on, which --no-sandbox would not.
unset LD_PRELOAD
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/.local/share/tanked"
mkdir -p "$DATA"
export ELECTRON_ENABLE_LOGGING=1
exec "$HERE/electron/electron" "$@" >"$DATA/last-run-output.log" 2>&1
