/**
 * Watch-tower sprite — twice wall height, with crenellations, a gun barrel
 * that rotates toward its target, and an HP bar.
 */

import { BASE_STRUCTURES } from "../../config.js";
import { darken } from "../canvas-utils.js";
import { drawDamageOverlay } from "../damage.js";
import { TH, TW } from "../projection.js";
import { drawIsoBlock } from "./block.js";

export function drawWatchTower(ctx, tower, sx, sy, time) {
    const frac = tower.damageFraction;
    const cfg = BASE_STRUCTURES.baseTower;
    const fullH = cfg.visHeight;
    const h = Math.max(3, Math.round(fullH * frac));

    const S = 0.45;
    const bw = S * TW;
    const bd = S * TH;
    const dmg = 1 - frac;

    const topCol = darken(tower.color, dmg);
    const leftCol = darken(tower.darkColor, dmg);
    const rightCol = darken(tower.darkColor, dmg * 0.7);

    drawIsoBlock(ctx, sx, sy, h, { top: topCol, left: leftCol, right: rightCol, bw, bd });

    // Platform edge (darker line around the top face).
    ctx.strokeStyle = leftCol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bd - h);
    ctx.lineTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx - bw, sy - h);
    ctx.closePath();
    ctx.stroke();

    // Crenellations at the top.
    if (frac > 0.3) {
        const mH = 4;
        const mw = bw * 0.25;
        ctx.fillStyle = leftCol;
        const merlons = [
            [sx, sy - bd - h - mH],
            [sx + bw * 0.7, sy - h - mH + 2],
            [sx - bw * 0.7, sy - h - mH + 2],
        ];
        for (const [mx, my] of merlons) {
            ctx.fillRect(mx - mw / 2, my, mw, mH);
        }
    }

    // Gun barrel (rotates toward the target).
    if (frac > 0.2) {
        const gunLen = 10;
        const gunY = sy - h - 2;
        const angle = tower.turretAngle;
        // Project the barrel tip through the isometric transform.
        const dx = Math.cos(angle) * gunLen;
        const dy = Math.sin(angle) * gunLen * 0.5; // iso squish
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sx, gunY);
        ctx.lineTo(sx + dx, gunY + dy);
        ctx.stroke();
        // Muzzle
        ctx.fillStyle = "#666";
        ctx.beginPath();
        ctx.arc(sx + dx, gunY + dy, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // HP bar
    const barW = 30,
        barH = 4;
    const barX = sx - barW / 2,
        barY = sy - h - 14;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = frac > 0.5 ? "#4a4" : frac > 0.25 ? "#da4" : "#d44";
    ctx.fillRect(barX, barY, barW * frac, barH);

    if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
}
