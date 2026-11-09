/**
 * The Steam library artwork: Steam stretches an image of the wrong size, shows a
 * black box behind a logo with no transparency, and silently ignores a file whose
 * name doesn't match the shortcut's AppId.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ARTWORK_SIZES } from "../tools/artwork-images.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ART_DIR = path.join(ROOT, "steam/artwork");
const INSTALL_SCRIPT = path.join(ROOT, "steam/steam_artwork.py");
const PNG_COLOUR_RGB = 2;
const PNG_COLOUR_RGBA = 6;
const SEE_THROUGH_IMAGES = new Set(["logo", "icon"]);

function readPngHeader(file) {
    const header = fs.readFileSync(file).subarray(0, 26);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20), colourType: header[25] };
}

/** Steam's binary shortcuts.vdf, with one nested entry per shortcut. */
function shortcutsVdf(shortcuts) {
    const entries = shortcuts.map(({ appid, exe }, i) => {
        const id = Buffer.alloc(4);
        id.writeUInt32LE(appid);
        return Buffer.concat([
            Buffer.from(`\x00${i}\x00\x02appid\x00`, "latin1"),
            id,
            Buffer.from(`\x01Exe\x00"${exe}"\x00\x08`, "latin1"),
        ]);
    });
    return Buffer.concat([Buffer.from("\x00shortcuts\x00", "latin1"), ...entries, Buffer.from("\x08\x08", "latin1")]);
}

function withFakeSteam(shortcuts, check) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tanked-steam-"));
    try {
        const config = path.join(home, ".local/share/Steam/userdata/1234/config");
        fs.mkdirSync(config, { recursive: true });
        const vdf = path.join(config, "shortcuts.vdf");
        const bytes = shortcutsVdf(shortcuts);
        fs.writeFileSync(vdf, bytes);
        const run = spawnSync("python3", [INSTALL_SCRIPT, ART_DIR, "/home/me/Games/tanked/tanked.sh"], {
            env: { ...process.env, HOME: home },
            encoding: "utf8",
        });
        assert.equal(run.status, 0, run.stderr);
        check(path.join(config, "grid"));
        assert.deepEqual(fs.readFileSync(vdf), bytes, "shortcuts.vdf belongs to Steam and must never change");
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}

describe("Steam artwork files", () => {
    for (const [name, size] of Object.entries(ARTWORK_SIZES)) {
        it(`${name}.png has the size Steam displays it at`, () => {
            const { width, height, colourType } = readPngHeader(path.join(ART_DIR, `${name}.png`));
            assert.deepEqual({ width, height }, size);
            assert.equal(colourType, SEE_THROUGH_IMAGES.has(name) ? PNG_COLOUR_RGBA : PNG_COLOUR_RGB);
        });
    }
});

describe("steam_artwork.py", () => {
    it("names every image after the Tanked shortcut's AppId, and no other game's", () => {
        const shortcuts = [
            { appid: 111, exe: "/home/me/Games/other/other.sh" },
            { appid: 3810341640, exe: "/home/me/Games/tanked/tanked.sh" },
        ];
        withFakeSteam(shortcuts, (grid) => {
            assert.deepEqual(fs.readdirSync(grid).sort(), [
                "3810341640.png",
                "3810341640_hero.png",
                "3810341640_icon.png",
                "3810341640_logo.png",
                "3810341640p.png",
            ]);
            assert.deepEqual(
                fs.readFileSync(path.join(grid, "3810341640p.png")),
                fs.readFileSync(path.join(ART_DIR, "cover.png")),
                "the p suffix is Steam's portrait cover slot",
            );
        });
    });

    it("leaves Steam alone when Tanked isn't in the library yet", () => {
        withFakeSteam([{ appid: 111, exe: "/home/me/Games/other/other.sh" }], (grid) => {
            assert.equal(fs.existsSync(grid), false);
        });
    });
});
