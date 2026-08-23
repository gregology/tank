/**
 * Ground and elevated tile drawing.
 *
 * Flat tiles are drawn first in the viewport (they can never occlude
 * entities); elevated tiles (hills, rocks) share the depth-sorted pass so
 * their side walls correctly occlude entities behind them.  See
 * `viewport.js` for the two-pass orchestration.
 */

import { TILE_VISUALS } from "../config.js";
import { drawBuilding } from "./buildings.js";
import { PALETTE, rgb } from "./canvas-utils.js";
import { drawDamageOverlay } from "./damage.js";
import { TH, TW } from "./projection.js";

/**
 * Draw functions per `TILE_VISUALS[].draw` kind — a registry, not an
 * `if/else` chain, so a new draw kind is one entry here.
 */
const DRAW_KINDS = {
    water(ctx, { sx, sy, gx, gy }, time, _map, visual, v) {
        const base = PALETTE[visual.color];
        const wave = Math.sin(time * 1.8 + gx * 1.3 + gy * 0.9) * 0.5 + 0.5;
        drawDiamond(
            ctx,
            sx,
            sy,
            rgb(base.r + v * 2 + wave * 12, base.g + v * 2 + wave * 16, base.b + v * 2 + wave * 22),
        );
        // subtle wave highlight
        if (wave > 0.7) {
            ctx.globalAlpha = (wave - 0.7) * 1.5;
            drawDiamond(ctx, sx, sy, "rgba(180,210,240,0.15)");
            ctx.globalAlpha = 1;
        }
    },
    flat(ctx, { sx, sy }, _time, _map, visual, v) {
        const c = PALETTE[visual.color];
        const m = visual.variation;
        drawDiamond(ctx, sx, sy, rgb(c.r + v * m.r, c.g + v * m.g, c.b + v * m.b));
    },
    elevated(ctx, { sx, sy, gx, gy, tile }, time, map, visual, v) {
        const frac = map.getDamageFraction(gx, gy);
        const h = Math.round(map.tileHeight(tile) * frac);
        drawElevatedTile(ctx, sx, sy, h, PALETTE[visual.top], PALETTE[visual.left], PALETTE[visual.right], v);
        if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
    },
    building(ctx, { sx, sy, gx, gy, tile }, time, map) {
        const frac = map.getDamageFraction(gx, gy);
        drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time);
    },
};

/**
 * Draw one tile at its projected screen position.
 * @param {{gx:number, gy:number, tile:number, sx:number, sy:number}} tilePos
 */
export function drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
    const visual = TILE_VISUALS[tile];
    if (!visual) return;

    // Colour variation per tile based on position.
    const v = ((gx * 7 + gy * 13) % 5) - 2; // −2 … +2

    DRAW_KINDS[visual.draw]?.(ctx, { gx, gy, tile, sx, sy }, time, map, visual, v);
    // "none" (base-structure tile) has no entry and draws nothing.
}

/** Draw a flat isometric diamond (top face of a ground-level tile). */
function drawDiamond(ctx, sx, sy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + TW / 2, sy + TH / 2);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx - TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();
}

/** Draw an elevated tile (top face + two visible side faces). */
function drawElevatedTile(ctx, sx, sy, h, topC, leftC, rightC, v) {
    // Left (SW) side
    ctx.fillStyle = rgb(leftC.r + v * 2, leftC.g + v * 2, leftC.b + v * 2);
    ctx.beginPath();
    ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx - TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();

    // Right (SE) side
    ctx.fillStyle = rgb(rightC.r + v * 2, rightC.g + v * 2, rightC.b + v * 2);
    ctx.beginPath();
    ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx + TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();

    // Top face
    ctx.fillStyle = rgb(topC.r + v * 3, topC.g + v * 3, topC.b + v * 3);
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
    ctx.closePath();
    ctx.fill();
}
