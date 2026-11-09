#!/usr/bin/env python3
"""Puts the Tanked artwork into Steam's library for the non-Steam shortcut.

Steam names custom artwork after the shortcut's AppId, which it picks itself when
the game is added, so this reads it from shortcuts.vdf and never writes to that file.
Usage:
    steam_artwork.py <artwork dir> <path to tanked.sh> [seconds to wait for the shortcut]
Prints what it did; exits 0 even when there's nothing to do.
"""
import glob
import os
import shutil
import struct
import sys
import time

ART = {"cover.png": "{}p.png", "wide.png": "{}.png", "hero.png": "{}_hero.png", "logo.png": "{}_logo.png",
       "icon.png": "{}_icon.png"}


def read_shortcuts(path):
    with open(path, "rb") as file:
        data = file.read()

    def read(i):
        out = {}
        while True:
            kind = data[i]
            i += 1
            if kind == 8:
                return out, i
            end = data.index(b"\0", i)
            key = data[i:end].decode("utf-8", "replace").lower()
            i = end + 1
            if kind == 0:
                out[key], i = read(i)
            elif kind == 1:
                end = data.index(b"\0", i)
                out[key] = data[i:end].decode("utf-8", "replace")
                i = end + 1
            elif kind == 2:
                out[key] = struct.unpack("<I", data[i:i + 4])[0]
                i += 4
            else:
                raise ValueError(f"unexpected type {kind}")

    return read(0)[0].get("shortcuts", {}).values()


def find(exe):
    found = []
    for path in glob.glob(os.path.expanduser("~/.local/share/Steam/userdata/*/config/shortcuts.vdf")):
        try:
            for shortcut in read_shortcuts(path):
                if exe in shortcut.get("exe", "") and shortcut.get("appid"):
                    found.append((os.path.dirname(path), shortcut["appid"]))
        except (OSError, ValueError, IndexError):
            continue
    return found


def main():
    art_dir, exe = sys.argv[1], sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 0
    deadline = time.time() + wait
    found = find(exe)
    while not found and time.time() < deadline:
        time.sleep(1)
        found = find(exe)
    if not found:
        print("Steam shortcut not found yet; artwork will be added next time you run install.sh.")
        return
    for config_dir, appid in found:
        grid = os.path.join(config_dir, "grid")
        os.makedirs(grid, exist_ok=True)
        for source, pattern in ART.items():
            shutil.copyfile(os.path.join(art_dir, source), os.path.join(grid, pattern.format(appid)))
        print(f"Added library artwork (shortcut {appid}); Steam shows it after it restarts.")


if __name__ == "__main__":
    main()
