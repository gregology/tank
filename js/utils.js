/**
 * Shared math helpers and isometric projection utilities.
 */

import { CONFIG } from "./config.js";

const HALF_TW = CONFIG.TILE_WIDTH / 2;
const HALF_TH = CONFIG.TILE_HEIGHT / 2;

/* ── Isometric conversion ─────────────────────────────────── */

export function worldToScreen(wx, wy) {
    return {
        x: (wx - wy) * HALF_TW,
        y: (wx + wy) * HALF_TH,
    };
}

export function screenToWorld(sx, sy) {
    return {
        x: (sx / HALF_TW + sy / HALF_TH) / 2,
        y: (sy / HALF_TH - sx / HALF_TW) / 2,
    };
}

/**
 * Convert a world-space direction vector to screen-space.
 * Useful for barrels, bullet trails, etc.
 */
export function worldDirToScreen(dx, dy) {
    return {
        x: (dx - dy) * HALF_TW,
        y: (dx + dy) * HALF_TH,
    };
}

/* ── General math ─────────────────────────────────────────── */

export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function distance(x1, y1, x2, y2) {
    const dx = x2 - x1,
        dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

export function normalizeAngle(a) {
    a %= Math.PI * 2;
    if (a < 0) a += Math.PI * 2;
    return a;
}

export function randomInt(lo, hi) {
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function randomFloat(lo, hi) {
    return Math.random() * (hi - lo) + lo;
}
