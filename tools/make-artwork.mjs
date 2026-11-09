/**
 * Re-renders the Steam library artwork into steam/artwork/.
 *
 *   CHROME=/path/to/chrome-or-headless-shell node tools/make-artwork.mjs [image ...]
 *
 * Serves the repo over HTTP because ES modules refuse to load from file://,
 * and uses Chromium's own --screenshot so the repo gains no browser dependency.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ARTWORK_SIZES } from "./artwork-images.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "steam/artwork");
const TYPES = { ".html": "text/html", ".js": "text/javascript" };

const chrome = process.env.CHROME;
if (!chrome) throw new Error("Set CHROME to a Chromium or chrome-headless-shell binary");

const server = http.createServer((request, response) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});

server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ARTWORK_SIZES);
    fs.mkdirSync(OUT, { recursive: true });
    let remaining = names.length;
    for (const name of names) {
        const { width, height } = ARTWORK_SIZES[name];
        execFile(
            chrome,
            [
                "--headless",
                "--no-sandbox",
                "--hide-scrollbars",
                "--disable-gpu",
                "--force-device-scale-factor=1",
                "--default-background-color=00000000",
                "--virtual-time-budget=15000",
                `--window-size=${width},${height}`,
                `--screenshot=${path.join(OUT, `${name}.png`)}`,
                `http://127.0.0.1:${port}/tools/artwork.html?image=${name}`,
            ],
            (error) => {
                if (error) console.error(name, error.message);
                else console.log(`steam/artwork/${name}.png`);
                remaining -= 1;
                if (remaining === 0) server.close();
            },
        );
    }
});
