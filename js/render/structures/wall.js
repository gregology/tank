/**
 * Base-wall sprite — a 1×1 fortification block, team-coloured and shrinking
 * with damage.
 */

import { BASE_STRUCTURES } from "../../config.js";
import { darken, mixGrey } from "../canvas-utils.js";
import { drawDamageOverlay } from "../damage.js";
import { TH, TW } from "../projection.js";
import { drawIsoBlock } from "./block.js";

export function drawBaseWall(ctx, wall, sx, sy, time) {
    const frac = wall.damageFraction;
    const cfg = BASE_STRUCTURES.baseWall;
    const fullH = cfg.visHeight;
    const h = Math.max(2, Math.round(fullH * frac));

    const S = 0.45;
    const bw = S * TW;
    const bd = S * TH;
    const dmg = 1 - frac;

    // Mix team colour with concrete grey, then darken with damage.
    const topCol = darken(mixGrey(wall.color, 160, 0.5), dmg);
    const leftCol = darken(mixGrey(wall.darkColor, 100, 0.5), dmg);
    const rightCol = darken(mixGrey(wall.darkColor, 120, 0.5), dmg * 0.7);

    drawIsoBlock(ctx, sx, sy, h, { top: topCol, left: leftCol, right: rightCol, bw, bd });

    // Horizontal mortar line on top.
    if (h >= 5) {
        ctx.strokeStyle = leftCol;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - bw * 0.6, sy - h + 1);
        ctx.lineTo(sx + bw * 0.6, sy - h + 1);
        ctx.stroke();
    }

    if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
}
