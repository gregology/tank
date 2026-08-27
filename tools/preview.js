/**
 * Offline map preview — renders a map region through the REAL tile
 * renderer (js/render/tiles.js) into a PNG, so visual generation changes
 * can be reviewed without a browser.  Zero deps: the canvas 2D calls the
 * tile renderer uses (polygon/ellipse/rect fills, polyline strokes) are
 * rasterized by hand into a pixel buffer and PNG-encoded with zlib.
 *
 * CLI: node tools/preview.js [seed] [size] [--out preview.png] [--cx N --cy N --r N]
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { GameMap } from "../js/map.js";
import { drawTile } from "../js/render/tiles.js";
import { TH, TW } from "../js/render/projection.js";

/* ── tiny rasterizer ──────────────────────────────────────── */

class Raster {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.px = new Uint8Array(w * h * 4);
        this.px.fill(0);
    }
    blend(x, y, r, g, b, a) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = ((y | 0) * this.w + (x | 0)) * 4;
        const sa = a / 255;
        this.px[i] = r * sa + this.px[i] * (1 - sa);
        this.px[i + 1] = g * sa + this.px[i + 1] * (1 - sa);
        this.px[i + 2] = b * sa + this.px[i + 2] * (1 - sa);
        this.px[i + 3] = Math.min(255, this.px[i + 3] + a);
    }
    fillPoly(pts, color) {
        const [r, g, b, a] = color;
        const ys = pts.map((p) => p[1]);
        const yMin = Math.max(0, Math.floor(Math.min(...ys)));
        const yMax = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
        for (let y = yMin; y <= yMax; y++) {
            const xs = [];
            for (let i = 0; i < pts.length; i++) {
                const [x1, y1] = pts[i];
                const [x2, y2] = pts[(i + 1) % pts.length];
                if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
                    xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
                }
            }
            xs.sort((p, q) => p - q);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                for (let x = Math.max(0, Math.floor(xs[k])); x <= Math.min(this.w - 1, Math.ceil(xs[k + 1])); x++) {
                    this.blend(x, y, r, g, b, a);
                }
            }
        }
    }
    fillEllipse(cx, cy, rx, ry, color) {
        const [r, g, b, a] = color;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                const dx = (x - cx) / rx,
                    dy = (y - cy) / ry;
                if (dx * dx + dy * dy <= 1) this.blend(x, y, r, g, b, a);
            }
        }
    }
    fillRect(x, y, w, h, color) {
        const [r, g, b, a] = color;
        for (let yy = Math.floor(y); yy < y + h; yy++) {
            for (let xx = Math.floor(x); xx < x + w; xx++) this.blend(xx, yy, r, g, b, a);
        }
    }
    strokeLine(x1, y1, x2, y2, width, color) {
        const [r, g, b, a] = color;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.ceil(len * 2) + 1;
        const hw = width / 2;
        for (let s = 0; s <= steps; s++) {
            const x = x1 + ((x2 - x1) * s) / steps,
                y = y1 + ((y2 - y1) * s) / steps;
            for (let oy = -hw; oy <= hw; oy += 0.5) {
                for (let ox = -hw; ox <= hw; ox += 0.5) {
                    if (ox * ox + oy * oy <= hw * hw) this.blend(Math.round(x + ox), Math.round(y + oy), r, g, b, a);
                }
            }
        }
    }
}

/** Parse the colour strings the renderer produces (rgb()/rgba()/hex). */
function parseColor(s) {
    if (typeof s !== "string") return [255, 0, 255, 255];
    let m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 255 : +m[4] * 255];
    m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255];
    return [255, 0, 255, 255];
}

/** The 2D-context shim: rasterizes each draw call into the buffer. */
function makeCtx(raster) {
    let path = [];
    let fill = [0, 0, 0, 255],
        stroke = [0, 0, 0, 255],
        lw = 1;
    return {
        globalAlpha: 1,
        set fillStyle(v) {
            fill = parseColor(v);
        },
        set strokeStyle(v) {
            stroke = parseColor(v);
        },
        set lineWidth(v) {
            lw = v;
        },
        beginPath() {
            path = [];
        },
        moveTo(x, y) {
            path = [[x, y]];
        },
        lineTo(x, y) {
            path.push([x, y]);
        },
        closePath() {},
        fill() {
            if (path.length >= 3) raster.fillPoly(path, fill);
        },
        stroke() {
            for (let i = 0; i + 1 < path.length; i++) {
                raster.strokeLine(path[i][0], path[i][1], path[i + 0 + 1][0], path[i + 1][1], lw, stroke);
            }
        },
        ellipse(cx, cy, rx, ry) {
            raster.fillEllipse(cx, cy, rx, ry, fill);
        },
        fillRect(x, y, w, h) {
            raster.fillRect(x, y, w, h, fill);
        },
        save() {},
        restore() {},
        translate() {},
    };
}

/* ── PNG encoding (no deps) ───────────────────────────────── */

function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
    return out;
}

function encodePng(raster) {
    const { w, h, px } = raster;
    const raw = Buffer.alloc(h * (w * 4 + 1));
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0; // filter: none
        Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/* ── trial prototypes (scene mode only) ────────────────────── */

import { TILES as PT, TILE_VISUALS as PV } from "../js/config.js";
import { PALETTE, rgb } from "../js/render/canvas-utils.js";

const protoVerge = { r: 122, g: 106, b: 84 };
const protoTarmac = { r: 58, g: 58, b: 64 };
const protoDash = { r: 226, g: 220, b: 190 };

// 8-way mask: 4 cardinal edge midpoints + 4 diagonal corner points
const LINKS8 = [
    { dx: 1, dy: 0, fx: TW / 4, fy: (TH * 3) / 4 },
    { dx: 0, dy: -1, fx: TW / 4, fy: TH / 4 },
    { dx: -1, dy: 0, fx: -TW / 4, fy: TH / 4 },
    { dx: 0, dy: 1, fx: -TW / 4, fy: (TH * 3) / 4 },
    { dx: 1, dy: 1, fx: TW / 4 + 4, fy: (TH * 3) / 4 + 2 }, // corner B-ish
    { dx: 1, dy: -1, fx: TW / 2 - 2, fy: TH / 2 }, // corner R
    { dx: -1, dy: 1, fx: -TW / 2 + 2, fy: TH / 2 }, // corner L
    { dx: -1, dy: -1, fx: -TW / 4 - 4, fy: TH / 4 - 2 }, // corner T-ish
];

function protoRoadMask(map, gx, gy) {
    return LINKS8.filter((e) => {
        const t = map.getTile(gx + e.dx, gy + e.dy);
        return map.isRoad(gx + e.dx, gy + e.dy) || t === PT.BRIDGE_STONE || t === PT.BRIDGE_WOOD;
    });
}

function band(ctx, x1, y1, x2, y2, width, color) {
    const ux = x2 - x1,
        uy = y2 - y1;
    const len = Math.hypot(ux, uy) || 1;
    const nx = (-uy / len) * (width / 2),
        ny = (ux / len) * (width / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 + nx, y1 + ny);
    ctx.lineTo(x2 + nx, y2 + ny);
    ctx.lineTo(x2 - nx, y2 - ny);
    ctx.lineTo(x1 - nx, y1 - ny);
    ctx.closePath();
    ctx.fill();
}

function diamond(ctx, sx, sy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + TW / 2, sy + TH / 2);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx - TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();
}

function prototypeDraw(ctx, map, gx, gy, tile, sx, sy) {
    const c = { x: sx, y: sy + TH / 2 };
    if (tile === 18) {
        // 8-way tarmac
        diamond(ctx, sx, sy, rgb(72, 124, 60, 1)); // grass base
        const links = protoRoadMask(map, gx, gy);
        if (links.length === 0) {
            ctx.fillStyle = rgb(protoTarmac.r, protoTarmac.g, protoTarmac.b, 1);
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, 7, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        for (const e of links) {
            const mx = sx + e.fx,
                my = sy + e.fy;
            band(ctx, c.x, c.y, mx, my, 16, rgb(protoVerge.r, protoVerge.g, protoVerge.b, 1));
            band(ctx, c.x, c.y, mx, my, 13, rgb(protoTarmac.r, protoTarmac.g, protoTarmac.b, 1));
            // centre dash
            const ux = mx - c.x,
                uy = my - c.y;
            const dmx = c.x + ux * 0.55,
                dmy = c.y + uy * 0.55;
            ctx.strokeStyle = rgb(protoDash.r, protoDash.g, protoDash.b, 1);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(dmx - ux * 0.16, dmy - uy * 0.16);
            ctx.lineTo(dmx + ux * 0.16, dmy + uy * 0.16);
            ctx.stroke();
        }
        // centre pad
        ctx.fillStyle = rgb(protoTarmac.r, protoTarmac.g, protoTarmac.b, 1);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // bridges: one road band along the crossing axis, deck margins visible
    const wooden = tile === 17;
    const deckC = wooden ? { r: 146, g: 112, b: 74 } : { r: 150, g: 145, b: 135 };
    const edgeC = wooden ? { r: 96, g: 72, b: 46 } : { r: 100, g: 95, b: 88 };
    diamond(ctx, sx, sy, rgb(deckC.r, deckC.g, deckC.b, 1));
    // kerb at water-facing edges
    const waterAt = (dx, dy) => map.isWaterTile(map.getTile(gx + dx, gy + dy));
    ctx.fillStyle = rgb(edgeC.r, edgeC.g, edgeC.b, 1);
    if (waterAt(0, -1)) ctx.fillRect(sx - TW / 2, sy - 2, TW, 3);
    if (waterAt(0, 1)) ctx.fillRect(sx - TW / 2, sy + TH - 1, TW, 3);
    if (waterAt(-1, 0)) {
        ctx.beginPath();
        ctx.moveTo(sx - TW / 2, sy + TH / 2 - 2);
        ctx.lineTo(sx, sy - 2);
        ctx.lineTo(sx, sy + 2);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 + 2);
        ctx.closePath();
        ctx.fill();
    }
    if (waterAt(1, 0)) {
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - 2);
        ctx.lineTo(sx, sy - 2);
        ctx.lineTo(sx, sy + 2);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 + 2);
        ctx.closePath();
        ctx.fill();
    }
    // the road band: along the CROSSING axis only — the axis with the
    // most water nearby is the channel's direction; the road crosses it
    const waterAlong = (dx, dy) => {
        let n = 0;
        for (let k = 1; k <= 3; k++) if (map.isWaterTile(map.getTile(gx + dx * k, gy + dy * k))) n++;
        return n;
    };
    const channelNS = waterAlong(0, 1) + waterAlong(0, -1) >= waterAlong(1, 0) + waterAlong(-1, 0);
    const roadLinks = LINKS8.slice(0, 4).filter((e) => (Math.abs(e.dy) > 0) === channelNS);
    for (const e of roadLinks) {
        const t = map.getTile(gx + e.dx, gy + e.dy);
        const isLink = t === 18 || t === 12 || t === 17;
        if (!isLink) continue;
        const mx = sx + e.fx,
            my = sy + e.fy;
        band(ctx, c.x, c.y, mx, my, 8, rgb(protoTarmac.r, protoTarmac.g, protoTarmac.b, 1));
        const ux = mx - c.x,
            uy = my - c.y;
        const dmx = c.x + ux * 0.55,
            dmy = c.y + uy * 0.55;
        ctx.strokeStyle = rgb(protoDash.r, protoDash.g, protoDash.b, 1);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(dmx - ux * 0.14, dmy - uy * 0.14);
        ctx.lineTo(dmx + ux * 0.14, dmy + uy * 0.14);
        ctx.stroke();
    }
    ctx.fillStyle = rgb(protoTarmac.r, protoTarmac.g, protoTarmac.b, 1);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
}

/* ── the preview itself ───────────────────────────────────── */

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--") && Number.isNaN(Number(a)) === false && args[args.indexOf(a) - 1]?.startsWith("--") === false);
const flag = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : dflt;
};
const seed = flag("--seed", Number(args[0]) || 4);
const size = flag("--size", Number(args[1]) || 128);
const outFlag = args.indexOf("--out");
const out = outFlag >= 0 ? args[outFlag + 1] : "/tmp/preview.png";
const cx = flag("--cx", size / 2);
const cy = flag("--cy", size / 2);
const r = flag("--r", 14);

const scene = flag("--scene", 0);
let map;
if (scene) {
    // Synthetic trial scene: flat grass + a vertical water channel +
    // hand-stamped bridges (widths 1/2/3, stone/wood) and an 8-way road.
    map = new GameMap(size, size, 1.0, undefined, seed, null);
    const { TILES } = await import("../js/config.js");
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) map.setTile(x, y, TILES.GRASS);
    const chanX = 14; // the channel
    for (let y = 8; y < 30; y++) for (let w = 0; w < 3; w++) map.setTile(chanX + w, y, TILES.DEEP_WATER);
    // bridges across the channel at different widths
    const mkBridge = (y0, width, kind) => {
        for (let b = 0; b < width; b++) for (let x = chanX - 1; x <= chanX + 3; x++) map.setTile(x, y0 + b, kind);
    };
    mkBridge(10, 1, TILES.BRIDGE_WOOD);
    mkBridge(14, 2, TILES.BRIDGE_WOOD);
    mkBridge(18, 3, TILES.BRIDGE_STONE);
    // an 8-way road: straight east, then grid-diagonal (1,1), then east again
    for (let x = 6; x < 14; x++) map.setTile(x, 24, TILES.TARMAC);
    for (let k = 0; k < 5; k++) map.setTile(20 + k, 24 - k, TILES.TARMAC); // diagonal NE
    for (let x = 25; x < 30; x++) map.setTile(x, 19, TILES.TARMAC);
    for (let y = 19; y < 24; y++) map.setTile(25, y, TILES.TARMAC); // down the middle
} else {
    map = new GameMap(size, size, 1.0, undefined, seed, "compound");
}
const ox = cx - r,
    oy = cy - r,
    dim = r * 2;

const W = dim * TW + TW * 2,
    H = dim * TH + TH * 2;
const raster = new Raster(W, H);
const ctx = makeCtx(raster);

// sky/void background stays black; draw tiles row by row (painter's order)
for (let gy = oy; gy < oy + dim; gy++) {
    for (let gx = ox; gx < ox + dim; gx++) {
        const tile = map.getTile(gx, gy);
        if (tile === undefined) continue;
        const sx = (gx - gy - (ox - oy)) * (TW / 2) + dim * (TW / 2); // centre the region's diamond
        const sy = (gx + gy - (ox + oy)) * (TH / 2);
        if (scene && (tile === 18 || tile === 12 || tile === 17)) {
            prototypeDraw(ctx, map, gx, gy, tile, sx, sy);
        } else {
            drawTile(ctx, { gx, gy, tile, sx, sy }, 0, map);
        }
    }
}

writeFileSync(out, encodePng(raster));
console.log(`wrote ${out} (${W}x${H}) — region ${cx - r}..${cx + r} x ${cy - r}..${cy + r} of seed ${seed} ${size}²`);

