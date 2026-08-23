/**
 * Isometric projection helpers shared by every sprite in the render package.
 *
 * Every vehicle sprite projects local-space points through the same
 * transform, so the boilerplate (TW/TH halves, the P/PT closures) lives
 * here once instead of being re-declared per draw method.
 */

import { CONFIG } from "../config.js";

/** Tile dimensions in screen pixels (2:1 isometric). */
export const TW = CONFIG.TILE_WIDTH;
export const TH = CONFIG.TILE_HEIGHT;

/** Half-tile projection factors. */
export const HTW = TW / 2;
export const HTH = TH / 2;

/**
 * Build the isometric projection closures for one sprite.
 *
 * `P` projects local space rotated by `angle` (the hull), `PT` by
 * `turretAngle` (defaults to `angle` for fixed-gun vehicles).
 * Local space: +x = forward, +y = right.
 *
 * @returns {{ P: (lx:number, ly:number) => [number, number], PT: (lx:number, ly:number) => [number, number] }}
 */
export function makeProjection(sx, sy, angle, turretAngle = angle) {
    const ca = Math.cos(angle),
        sa = Math.sin(angle);
    const ta = Math.cos(turretAngle),
        tb = Math.sin(turretAngle);
    const P = (lx, ly) => {
        const wx = lx * ca - ly * sa;
        const wy = lx * sa + ly * ca;
        return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
    };
    const PT = (lx, ly) => {
        const wx = lx * ta - ly * tb;
        const wy = lx * tb + ly * ta;
        return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
    };
    return { P, PT };
}

/** True if a vehicle sprite should be drawn (alive and not flash-hidden). */
export function spriteVisible(tank) {
    if (!tank.alive) return false;
    if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return false;
    return true;
}
