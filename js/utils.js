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

/** Wrap an angle to [-PI, PI]. */
export function normalizeAngleSigned(a) {
    let r = a % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    if (r < -Math.PI) r += Math.PI * 2;
    return r;
}

/** Shortest signed angle from `a` to `b`, wrapped to [-PI, PI]. */
export function angleDiff(a, b) {
    return normalizeAngleSigned(b - a);
}

export function randomInt(lo, hi) {
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function randomFloat(lo, hi) {
    return Math.random() * (hi - lo) + lo;
}

/* ── Chargeable-weapon range ───────────────────────────────── */

/** Current charged range of a hold-to-charge weapon (clamped to max). */
export function chargeRange(minRange, maxRange, chargeRate, chargeTime) {
    return Math.min(minRange + chargeTime * chargeRate, maxRange);
}

/** Charge progress (0..1) toward the weapon's maximum range. */
export function chargeFraction(minRange, maxRange, chargeRate, chargeTime) {
    const maxCharge = (maxRange - minRange) / chargeRate;
    return Math.min(1, chargeTime / maxCharge);
}
