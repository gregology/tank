/**
 * Ground and elevated tile drawing.
 *
 * Flat tiles are drawn first in the viewport (they can never occlude
 * entities); elevated tiles (hills, rocks) share the depth-sorted pass so
 * their side walls correctly occlude entities behind them.  See
 * `viewport.js` for the two-pass orchestration.
 */

import { TILES as T } from "../config.js";
import { drawBuilding } from "./buildings.js";
import { PALETTE, rgb } from "./canvas-utils.js";
import { drawDamageOverlay } from "./damage.js";
import { TH, TW } from "./projection.js";

/**
 * Draw one tile at its projected screen position.
 * @param {{gx:number, gy:number, tile:number, sx:number, sy:number}} tilePos
 */
export function drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
    // Colour variation per tile based on position
    const v = ((gx * 7 + gy * 13) % 5) - 2; // −2 … +2

    switch (tile) {
        case T.DEEP_WATER:
        case T.SHALLOW_WATER: {
            const base = tile === T.DEEP_WATER ? PALETTE.deepWater : PALETTE.shallowWater;
            const wave = Math.sin(time * 1.8 + gx * 1.3 + gy * 0.9) * 0.5 + 0.5;
            const r = base.r + v * 2 + wave * 12;
            const g = base.g + v * 2 + wave * 16;
            const b = base.b + v * 2 + wave * 22;
            drawDiamond(ctx, sx, sy, rgb(r, g, b));
            // subtle wave highlight
            if (wave > 0.7) {
                ctx.globalAlpha = (wave - 0.7) * 1.5;
                drawDiamond(ctx, sx, sy, "rgba(180,210,240,0.15)");
                ctx.globalAlpha = 1;
            }
            break;
        }

        case T.SAND: {
            const c = PALETTE.sand;
            drawDiamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
            break;
        }

        case T.DIRT: {
            const c = PALETTE.dirt;
            drawDiamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
            break;
        }

        case T.PAVED: {
            const c = PALETTE.paved;
            drawDiamond(ctx, sx, sy, rgb(c.r + v * 2, c.g + v * 2, c.b + v * 2));
            break;
        }

        case T.GRASS: {
            const c = PALETTE.grass;
            drawDiamond(ctx, sx, sy, rgb(c.r + v * 4, c.g + v * 4, c.b + v * 3));
            break;
        }

        case T.DARK_GRASS: {
            const c = PALETTE.darkGrass;
            drawDiamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
            break;
        }

        case T.HILL: {
            const frac = map.getDamageFraction(gx, gy);
            const h = Math.round(map.tileHeight(T.HILL) * frac);
            drawElevatedTile(ctx, sx, sy, h, PALETTE.hillTop, PALETTE.hillLeft, PALETTE.hillRight, v);
            if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
            break;
        }

        case T.ROCK: {
            const frac = map.getDamageFraction(gx, gy);
            const h = Math.round(map.tileHeight(T.ROCK) * frac);
            drawElevatedTile(ctx, sx, sy, h, PALETTE.rockTop, PALETTE.rockLeft, PALETTE.rockRight, v);
            if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
            break;
        }

        case T.BLDG_SMALL:
        case T.BLDG_MEDIUM:
        case T.BLDG_LARGE: {
            const frac = map.getDamageFraction(gx, gy);
            drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time);
            break;
        }
    }
}

/** Draw a flat isometric diamond (top face of a ground-level tile). */
export function drawDiamond(ctx, sx, sy, color) {
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
export function drawElevatedTile(ctx, sx, sy, h, topC, leftC, rightC, v) {
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
